// Flight model for the flight simulator: a light single-engine plane (Cessna 172 numbers) flown as a point mass with an attitude.
// It runs in the browser and, as a UMD module, in the tests. Only the resulting position is ever shared with the server.
//
// Axes: x is east, y is up and z is north, in metres, with the origin at the airport reference point. Heading is measured
// clockwise from north. The stick sets the angle of attack (like a trimmed aeroplane), so pushing forward (W / Up) points the nose
// down and pulling back (S / Down) points it up, and pulling too far stalls the wing.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.FlightPhysics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const G = 9.81;
  const PLANE = {
    mass: 1100, wingArea: 16.2, rho: 1.15,
    cl0: 0.28, clAlpha: 5.1, stallAlpha: 0.262,       // lift slope per radian; the wing stalls at about 15 degrees
    cd0: 0.032, k: 0.055,
    power: 90000, staticThrust: 3200,                   // watts at the propeller and thrust at standstill
    trimAlpha: 0.09, elevatorRange: 0.2,                // the stick moves the angle of attack by up to 15 degrees
    maxBank: 0.9,                                       // radians of bank at full aileron
    rotateSpeed: 26, brakeDecel: 4.5, rollingDecel: 0.35, grassDecel: 1.6
  };
  const SAFE = { sinkRate: 4.2, bank: 0.3, nosePitch: -0.12, speedOffRunway: 20 };

  function create(overrides = {}) {
    return Object.assign({
      x: 0, y: 0, z: 0, heading: Math.PI / 2, pitch: 0, roll: 0, gamma: 0, speed: 0, throttle: 0,
      elevator: 0, aileron: 0, rudder: 0, brake: false, flaps: 0,
      onGround: true, crashed: null, stalled: false, aoa: 0, verticalSpeed: 0, time: 0, surface: 'runway'
    }, overrides);
  }

  // A plane established on final approach, `distance` metres from the touchdown point along the runway, on a `glide` radian slope.
  function approach({ x, z, heading, distance = 5200, glide = 3 * Math.PI / 180, crossing = 15, speed = 40 }) {
    const back = distance, sx = x - Math.sin(heading) * back, sz = z - Math.cos(heading) * back;
    return create({ x: sx, z: sz, y: crossing + Math.tan(glide) * back, heading, speed, gamma: -glide, pitch: -glide + PLANE.trimAlpha, throttle: 0.17, onGround: false });
  }

  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

  // Advance the plane by `dt` seconds (keep dt small, 0.05 s or less). `world` answers questions about the ground:
  //   world.surface(x, z) -> 'runway' | 'land' | 'water'     world.obstacle(x, y, z) -> a building the point is inside, or null
  function step(plane, input, dt, world) {
    if (plane.crashed) return plane;
    plane.time += dt;
    // Controls ramp towards the stick position and spring back to centre: elevator +1 is stick back (nose up).
    const ramp = (value, target, rate) => value + clamp(target - value, -rate * dt, rate * dt);
    plane.elevator = ramp(plane.elevator, clamp(input.elevator || 0, -1, 1), 1.6);
    plane.aileron = ramp(plane.aileron, clamp(input.aileron || 0, -1, 1), 2.4);
    plane.rudder = ramp(plane.rudder, clamp(input.rudder || 0, -1, 1), 3);
    plane.throttle = clamp(plane.throttle + (input.throttleRate || 0) * dt, 0, 1);
    plane.brake = Boolean(input.brake);

    const speed = Math.max(plane.speed, 0.5), q = 0.5 * PLANE.rho * speed * speed;
    const thrust = plane.throttle * Math.min(PLANE.staticThrust, PLANE.power / Math.max(speed, 12));
    if (plane.onGround) return groundRun(plane, thrust, q, dt, world);

    // Angle of attack follows the stick; the nose follows the angle of attack plus the flight path.
    const alphaCommand = PLANE.trimAlpha + plane.elevator * PLANE.elevatorRange;
    const pitchTarget = plane.gamma + alphaCommand;
    plane.pitch += (pitchTarget - plane.pitch) * Math.min(1, dt / 0.35);
    plane.roll += (plane.aileron * PLANE.maxBank - plane.roll) * Math.min(1, dt / 0.5);
    plane.aoa = plane.pitch - plane.gamma;
    // Flaps (0 to 3 notches: up, 10, 20 and 30 degrees) add lift and drag, as on the Cessna 172.
    const flaps = clamp(plane.flaps || 0, 0, 3), cl0 = PLANE.cl0 + flaps * 0.1;
    let cl = cl0 + PLANE.clAlpha * clamp(plane.aoa, -0.4, 0.6);
    plane.stalled = plane.aoa > PLANE.stallAlpha;
    if (plane.stalled) cl = cl0 + PLANE.clAlpha * PLANE.stallAlpha - 3.2 * (plane.aoa - PLANE.stallAlpha); // the lift falls away past the stall
    const lift = q * PLANE.wingArea * cl, drag = q * PLANE.wingArea * (PLANE.cd0 + flaps * 0.012 + PLANE.k * cl * cl);
    const cosRoll = Math.max(0.2, Math.cos(plane.roll));
    const dSpeed = (thrust * Math.cos(plane.aoa) - drag) / PLANE.mass - G * Math.sin(plane.gamma);
    const dGamma = (lift * cosRoll + thrust * Math.sin(plane.aoa)) / (PLANE.mass * speed) - G * Math.cos(plane.gamma) / speed;
    const dHeading = lift * Math.sin(plane.roll) / (PLANE.mass * speed * Math.max(0.2, Math.cos(plane.gamma))) + plane.rudder * 0.12 * Math.min(1, speed / 35);
    plane.speed = clamp(plane.speed + dSpeed * dt, 5, 110);
    plane.gamma = clamp(plane.gamma + dGamma * dt, -1.2, 1.2);
    plane.heading += dHeading * dt;
    const horizontal = plane.speed * Math.cos(plane.gamma);
    plane.x += Math.sin(plane.heading) * horizontal * dt;
    plane.z += Math.cos(plane.heading) * horizontal * dt;
    plane.verticalSpeed = plane.speed * Math.sin(plane.gamma);
    plane.y += plane.verticalSpeed * dt;
    return contact(plane, world);
  }

  // Touching down, hitting a building or the water. Returns the plane, possibly marked as crashed.
  function contact(plane, world) {
    if (!world) return plane;
    const building = world.obstacle(plane.x, plane.y, plane.z);
    if (building) { plane.crashed = 'You flew into a building.'; plane.speed = 0; return plane; }
    if (plane.y > 0.6) return plane;
    const surface = world.surface(plane.x, plane.z);
    if (surface === 'water') { if (plane.y <= -0.2) { plane.crashed = 'You ditched in the water.'; plane.speed = 0; } return plane; }
    if (plane.y > 0) return plane;
    const sink = -plane.verticalSpeed;
    if (sink > SAFE.sinkRate) plane.crashed = 'Hard landing: you came down too fast.';
    else if (Math.abs(plane.roll) > SAFE.bank) plane.crashed = 'You touched down with a wing low.';
    else if (plane.pitch < SAFE.nosePitch) plane.crashed = 'You touched down nose first.';
    else if (surface === 'land' && plane.speed > SAFE.speedOffRunway + 10) plane.crashed = 'You hit the ground off the runway too fast.';
    if (plane.crashed) { plane.speed = 0; return plane; }
    plane.y = 0; plane.onGround = true; plane.gamma = 0; plane.verticalSpeed = 0; plane.roll = 0; plane.surface = surface;
    return plane;
  }

  // Rolling on the ground: friction, brakes, nose wheel steering, and lifting off once there is enough lift.
  function groundRun(plane, thrust, q, dt, world) {
    plane.surface = world ? world.surface(plane.x, plane.z) : 'runway';
    if (plane.surface === 'water') { plane.crashed = 'You rolled into the water.'; plane.speed = 0; return plane; }
    const friction = plane.surface === 'runway' ? PLANE.rollingDecel : PLANE.grassDecel;
    const decel = (plane.brake ? PLANE.brakeDecel : 0) + friction + q * PLANE.wingArea * PLANE.cd0 / PLANE.mass;
    plane.speed = Math.max(0, plane.speed + (thrust / PLANE.mass - (plane.speed > 0.2 ? decel : 0)) * dt);
    plane.heading += (plane.rudder + plane.aileron * 0.6) * Math.min(plane.speed, 20) * 0.025 * dt * 6;
    const wantPitch = plane.speed > PLANE.rotateSpeed ? Math.max(0, plane.elevator) * 0.3 : 0;
    plane.pitch += (wantPitch - plane.pitch) * Math.min(1, dt / 0.4); plane.roll = 0; plane.gamma = 0; plane.aoa = plane.pitch; plane.stalled = false;
    plane.x += Math.sin(plane.heading) * plane.speed * dt; plane.z += Math.cos(plane.heading) * plane.speed * dt; plane.y = 0; plane.verticalSpeed = 0;
    const liftNow = q * PLANE.wingArea * (PLANE.cl0 + PLANE.clAlpha * plane.pitch);
    if (plane.pitch > 0.06 && liftNow > PLANE.mass * G) { plane.onGround = false; plane.gamma = 0.02; }
    if (world && world.obstacle(plane.x, 1, plane.z)) { plane.crashed = 'You drove into a building.'; plane.speed = 0; }
    return plane;
  }

  // Run the plane for `seconds` of simulated time (the time-scale buttons call this with scaled frame times), in small steps.
  function advance(plane, input, seconds, world, maxStep = 0.025) {
    const steps = Math.max(1, Math.ceil(seconds / maxStep)), dt = seconds / steps;
    for (let i = 0; i < steps && !plane.crashed; i++) step(plane, input, dt, world);
    return plane;
  }

  const KNOTS = 1.943844, FEET = 3.28084;
  const readout = plane => ({ knots: plane.speed * KNOTS, feet: plane.y * FEET, fpm: plane.verticalSpeed * FEET * 60, degrees: (plane.heading * 180 / Math.PI % 360 + 360) % 360, pitch: plane.pitch * 180 / Math.PI, bank: plane.roll * 180 / Math.PI });

  return { PLANE, SAFE, G, create, approach, step, advance, contact, readout, clamp };
});

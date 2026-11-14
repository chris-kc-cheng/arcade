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
  // Each airliner or light plane is a set of numbers. The Cessna 172 first, then an Airbus A320 (64 t, 122.6 m2 wing, two 107 kN engines).
  const PLANE = {
    mass: 1100, wingArea: 16.2, rho: 1.15,
    cl0: 0.28, clAlpha: 5.1, stallAlpha: 0.262,       // lift slope per radian; the wing stalls at about 15 degrees
    cd0: 0.032, k: 0.055,
    power: 90000, staticThrust: 3200,                   // watts at the propeller and thrust at standstill
    trimAlpha: 0.09, elevatorRange: 0.2,                // the stick moves the angle of attack by up to 15 degrees
    maxBank: 0.9,                                       // radians of bank at full aileron
    rotateSpeed: 26, brakeDecel: 4.5, rollingDecel: 0.35, grassDecel: 1.6,
    maxSpeed: 110, flapCl: 0.1, flapCd: 0.012, maxFlaps: 3, pitchLag: 0.35, rollLag: 0.5, elevRate: 1.6, ailRate: 2.4,
    approachSpeed: 40, approachFlaps: 0, approachThrottle: 0.17, approachCrossing: 15, gearCd: 0, gearTravel: 0
  };
  const AIRBUS = {
    mass: 64000, wingArea: 122.6, rho: 1.15,
    cl0: 0.32, clAlpha: 5.0, stallAlpha: 0.3,
    cd0: 0.024, k: 0.042,
    power: 22e6, staticThrust: 215000,                  // two engines: about 215 kN at standstill, falling off with speed
    trimAlpha: 0.1, elevatorRange: 0.13, maxBank: 0.6,
    rotateSpeed: 78, brakeDecel: 3.2, rollingDecel: 0.25, grassDecel: 1.2,
    maxSpeed: 260, flapCl: 0.24, flapCd: 0.018, maxFlaps: 4, pitchLag: 0.9, rollLag: 1.1, elevRate: 0.9, ailRate: 1.2,
    approachSpeed: 76, approachFlaps: 3, approachThrottle: 0.21, approachCrossing: 20, gearCd: 0.016, gearTravel: 8
  };
  const SAFE = { sinkRate: 4.2, bank: 0.3, nosePitch: -0.12, speedOffRunway: 20 };
  AIRBUS.safe = { sinkRate: 4.6, bank: 0.14, nosePitch: -0.07, speedOffRunway: 30 }; PLANE.safe = SAFE;
  const SPECS = { airbus: AIRBUS };
  const specOf = plane => SPECS[plane.mode] || PLANE;

  function create(overrides = {}) {
    return Object.assign({
      x: 0, y: 0, z: 0, heading: Math.PI / 2, pitch: 0, roll: 0, gamma: 0, speed: 0, throttle: 0,
      elevator: 0, aileron: 0, rudder: 0, brake: false, flaps: 0, gear: 1, gearDown: true, mode: 'plane', axes: null, vel: null,
      onGround: true, crashed: null, stalled: false, aoa: 0, verticalSpeed: 0, time: 0, surface: 'runway'
    }, overrides);
  }

  // A plane established on final approach, `distance` metres from the touchdown point along the runway, on a `glide` radian slope.
  function approach({ x, z, heading, distance = 5200, glide = 3 * Math.PI / 180, mode = 'plane', crossing, speed, throttle, flaps }) {
    const S = SPECS[mode] || PLANE, back = distance, sx = x - Math.sin(heading) * back, sz = z - Math.cos(heading) * back;
    crossing = crossing ?? S.approachCrossing; speed = speed ?? S.approachSpeed;
    return create({ x: sx, z: sz, y: crossing + Math.tan(glide) * back, heading, speed, gamma: -glide, pitch: -glide + S.trimAlpha, throttle: throttle ?? S.approachThrottle, flaps: flaps ?? S.approachFlaps, mode, onGround: false });
  }

  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

  // ---- jet: a fighter-class aircraft flown with a full orientation ------------------------------------------------------------------
  // The aircraft keeps nose, up and right vectors, so loops, rolls and inverted flight work, but it flies on real forces: thrust along
  // the nose (military power up to 75% of the throttle, afterburner above it, both falling with air density), drag (including wave
  // drag near Mach 1 and an air brake), and lift perpendicular to the flight path from the angle of attack, which stalls past about 23
  // degrees. The stick is progressive: it ramps in and out, and a flight control computer turns it into an angle of attack between
  // "hold the flight path" (stick released holds a 1 g path, so the nose does not drop) and the limit of 9 g (or -3 g pushing); the
  // wing's own stall and the speed decide the rest. Pitch and roll authority fall at low speed, the nose falls through below about
  // 60 m/s, and turns cost speed. Mass 9.5 t, wing 27.9 m2, thrust 78 kN (130 kN with afterburner).
  const JETSPEC = { mass: 9500, wing: 27.9, clAlpha: 4.2, alphaStall: 0.40, cd0: 0.022, k: 0.12, brakeCd: 0.05, thrustMil: 78000, thrustAb: 130000, maxG: 9, minG: -3, rollRate: 4.4, yawRate: 0.45 };
  const JET = JETSPEC;
  const vlen = v => Math.hypot(v[0], v[1], v[2]);
  const vnorm = v => { const l = vlen(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const vcomb = (a, x, b, y) => [a[0] * x + b[0] * y, a[1] * x + b[1] * y, a[2] * x + b[2] * y];

  // Nose, up and right vectors for a heading, pitch and roll (the same convention the renderer uses).
  function axesFrom(heading, pitch, roll) {
    const sh = Math.sin(heading), ch = Math.cos(heading), sp = Math.sin(pitch), cp = Math.cos(pitch), sr = Math.sin(roll), cr = Math.cos(roll);
    const f = [cp * sh, sp, cp * ch], u0 = [-sp * sh, cp, -sp * ch], r0 = [ch, 0, -sh];
    return { f, u: vcomb(u0, cr, r0, sr), r: vcomb(r0, cr, u0, -sr) };
  }
  function orthonormalize(a) {
    a.f = vnorm(a.f); a.r = vnorm(vcomb(a.r, 1, a.f, -vdot(a.r, a.f)));
    a.u = vnorm(vcomb(vcomb(a.u, 1, a.f, -vdot(a.u, a.f)), 1, a.r, -vdot(a.u, a.r))); return a;
  }
  // Heading, pitch and roll (what is drawn and shared) from the orientation.
  function anglesOf(a) { return { heading: Math.atan2(a.f[0], a.f[2]), pitch: Math.asin(clamp(a.f[1], -1, 1)), roll: Math.atan2(-a.r[1], a.u[1]) }; }
  // Make a flying plane a jet: orientation and velocity from its heading, pitch and flight path.
  function startJet(plane) {
    plane.mode = 'jet'; plane.axes = axesFrom(plane.heading, plane.pitch, plane.roll);
    const along = axesFrom(plane.heading, plane.gamma, 0).f; plane.vel = [along[0] * plane.speed, along[1] * plane.speed, along[2] * plane.speed]; return plane;
  }
  function stepJet(plane, input, dt, world, move = dt) {
    const J = JETSPEC, W = J.mass * G;
    // The sticks ramp in and spring back: a key press is not an instant full deflection.
    const stick = (value, target, rise, fall) => { const rate = Math.abs(target) > Math.abs(value) ? rise : fall; return value + clamp(target - value, -rate * dt, rate * dt); };
    plane.elevator = stick(plane.elevator, clamp(input.elevator || 0, -1, 1), 2.2, 3.5);
    plane.aileron = stick(plane.aileron, clamp(input.aileron || 0, -1, 1), 3.2, 5);
    plane.rudder = stick(plane.rudder, clamp(input.rudder || 0, -1, 1), 3, 4);
    plane.throttle = clamp(plane.throttle + (input.throttleRate || 0) * dt, 0, 1);
    plane.brake = Boolean(input.brake);
    const a = plane.axes; let v = plane.vel, speed = vlen(v);
    const rho = 1.225 * Math.exp(-Math.max(0, plane.y) / 8500), q = 0.5 * rho * speed * speed, qS = Math.max(q * J.wing, 1);
    const alphaOf = () => Math.atan2(-vdot(v, a.u), vdot(v, a.f)), betaOf = () => Math.atan2(vdot(v, a.r), Math.max(Math.abs(vdot(v, a.f)), 0.01));
    const alpha = speed > 1 ? alphaOf() : 0, beta = speed > 1 ? betaOf() : 0, gamma = speed > 1 ? Math.asin(clamp(v[1] / speed, -1, 1)) : 0;
    // The control computer: the angle of attack that holds the flight path (1 g) at this speed, and the limits for 9 g and -3 g.
    const alphaFor = n => n * W / (qS * J.clAlpha), cap = J.alphaStall * 0.95;
    const bankFactor = a.u[1] / Math.max(a.u[1] * a.u[1], 0.1225);   // in a banked turn the wing must lift more (1/cos of the bank) to keep the vertical component; inverted it lifts the other way
    const hold = clamp(alphaFor(Math.max(Math.cos(gamma), 0)) * bankFactor, -0.25, cap), top = Math.min(cap, alphaFor(J.maxG)), bottom = Math.max(-0.25, alphaFor(J.minG));
    const e = plane.elevator, lowSpeed = clamp((60 - speed) / 40, 0, 1);
    const command = (e >= 0 ? hold + e * (top - hold) : hold + e * (hold - bottom)) - lowSpeed * 0.9;   // the nose falls through when too slow
    const authority = clamp(speed / 110, 0.12, 1.2);
    const pitch = clamp((command - alpha) * Math.min(1, dt * 5 * authority), -3 * dt, 3 * dt), roll = plane.aileron * J.rollRate * authority * dt;
    const yaw = plane.rudder * J.yawRate * Math.min(1, authority) * dt + (speed > 1 ? clamp(beta, -0.5, 0.5) * Math.min(1, dt * 4 * authority) : 0);   // and the nose follows the airflow sideways
    let c = Math.cos(pitch), s = Math.sin(pitch); [a.f, a.u] = [vcomb(a.f, c, a.u, s), vcomb(a.u, c, a.f, -s)];
    c = Math.cos(roll); s = Math.sin(roll); [a.r, a.u] = [vcomb(a.r, c, a.u, -s), vcomb(a.u, c, a.r, s)];
    c = Math.cos(yaw); s = Math.sin(yaw); [a.f, a.r] = [vcomb(a.f, c, a.r, s), vcomb(a.r, c, a.f, -s)];
    orthonormalize(a);
    // Forces: thrust along the nose, lift perpendicular to the flight path, drag against it, and gravity.
    const dir = speed > 1 ? vnorm(v) : a.f, now = speed > 1 ? alphaOf() : 0, stalled = Math.abs(now) > J.alphaStall;
    const cl = Math.abs(now) <= J.alphaStall ? J.clAlpha * now : Math.abs(now) < 1.2 ? Math.sign(now) * Math.max(0.4, J.clAlpha * J.alphaStall - 1.8 * (Math.abs(now) - J.alphaStall)) : 1.0 * Math.sin(2 * now);
    const mach = speed / Math.max(295, 340 - 0.004 * plane.y), wave = 0.035 * clamp((mach - 0.9) / 0.35, 0, 1);
    const cd = J.cd0 + wave + J.k * cl * cl + 0.9 * Math.sin(now) ** 2 + (plane.brake ? J.brakeCd : 0) + 0.018 * (plane.gear ?? 1);
    const lift = qS * cl, drag = qS * cd, t = plane.throttle, base = t <= 0.75 ? J.thrustMil * t / 0.75 : J.thrustMil + (t - 0.75) / 0.25 * (J.thrustAb - J.thrustMil), thrust = base * Math.pow(rho / 1.225, 0.7);
    let lhat = vcomb(a.u, 1, dir, -vdot(a.u, dir)); lhat = vlen(lhat) > 1e-6 ? vnorm(lhat) : a.u;
    const force = [a.f[0] * thrust + lhat[0] * lift - dir[0] * drag, a.f[1] * thrust + lhat[1] * lift - dir[1] * drag, a.f[2] * thrust + lhat[2] * lift - dir[2] * drag];
    v = [v[0] + force[0] / J.mass * dt, v[1] + (force[1] / J.mass - G) * dt, v[2] + force[2] / J.mass * dt]; speed = Math.min(700, vlen(v)); if (speed >= 700) v = mul(vnorm(v), 700);
    plane.g = vdot(force, a.u) / W;
    plane.vel = v; plane.speed = speed; plane.x += v[0] * move; plane.y += v[1] * move; plane.z += v[2] * move; plane.verticalSpeed = v[1];
    plane.gamma = speed > 0.5 ? Math.asin(clamp(v[1] / speed, -1, 1)) : 0;
    Object.assign(plane, anglesOf(a)); plane.aoa = now; plane.stalled = stalled; plane.mach = mach;
    return jetContact(plane, world);
  }
  // A jet crashes into buildings, the water and the ground, unless it comes down gently and level, when it rolls on its wheels.
  function jetContact(plane, world) {
    if (!world) return plane;
    if (world.obstacle(plane.x, plane.y, plane.z)) { plane.crashed = 'You flew into a building.'; plane.speed = 0; return plane; }
    if (plane.y > 0.6) return plane;
    const surface = world.surface(plane.x, plane.z);
    if (surface === 'water') { if (plane.y <= -0.2) { plane.crashed = 'You ditched in the water.'; plane.speed = 0; } return plane; }
    if (plane.y > 0) return plane;
    const level = Math.abs(plane.roll) < 0.35 && plane.pitch > -0.12 && plane.pitch < 0.4, gentle = -plane.verticalSpeed < 6;
    if (gearUpLanding(plane)) { plane.crashed = 'You landed with the landing gear up.'; plane.speed = 0; return plane; }
    if (!(level && gentle) || (surface === 'land' && plane.speed > 45)) { plane.crashed = level && gentle ? 'You hit the ground off the runway too fast.' : 'You hit the ground.'; plane.speed = 0; return plane; }
    plane.y = 0; plane.onGround = true; plane.axes = null; plane.vel = null; plane.gamma = 0; plane.verticalSpeed = 0; plane.roll = 0; plane.surface = surface; return plane;
  }

  // ---- drone: it cannot crash -------------------------------------------------------------------------------------------------
  // Climb and descend, turn, slide sideways, and fly forward at the throttle's speed; the camera gimbal tilts up and down. Buildings
  // stop it (it slides along them) and the ground holds it up; nothing damages it.
  const DRONE = { climb: 12, strafe: 16, forward: 20, backward: 12, yawRate: 1.2, gimbalRate: 1.2, floor: 1.2 };   // no throttle: it hovers where it is, W flies forward (20 m/s), S backward (12 m/s)
  function stepDrone(plane, input, dt, world, move = dt) {
    const ramp = (value, target, tau) => value + (target - value) * Math.min(1, dt / tau);
    plane.throttle = 0;   // a drone has no throttle: it stays where it is unless a key is held
    const push = clamp(input.forward || 0, -1, 1); plane.vf = ramp(plane.vf || 0, push > 0 ? push * DRONE.forward : push * DRONE.backward, 0.35); plane.vs = ramp(plane.vs || 0, clamp(input.strafe || 0, -1, 1) * DRONE.strafe, 0.35); plane.vz = ramp(plane.vz || 0, clamp(input.climb || 0, -1, 1) * DRONE.climb, 0.35);
    plane.heading += clamp(input.yaw || 0, -1, 1) * DRONE.yawRate * dt; plane.view = clamp((plane.view ?? -0.15) + (input.view || 0) * DRONE.gimbalRate * dt, -1.5, 1.5);
    const sh = Math.sin(plane.heading), ch = Math.cos(plane.heading), dx = (sh * plane.vf + ch * plane.vs) * move, dz = (ch * plane.vf - sh * plane.vs) * move;
    const blocked = (x, z) => world && world.obstacle(x, plane.y, z);
    if (!blocked(plane.x + dx, plane.z + dz)) { plane.x += dx; plane.z += dz; } else if (!blocked(plane.x + dx, plane.z)) plane.x += dx; else if (!blocked(plane.x, plane.z + dz)) plane.z += dz; else { plane.vf = 0; plane.vs = 0; }
    plane.y = clamp(plane.y + plane.vz * move, DRONE.floor, 6000);
    if (plane.y === DRONE.floor && plane.vz < 0) plane.vz = 0;
    plane.speed = Math.hypot(plane.vf, plane.vs); plane.verticalSpeed = plane.vz; plane.pitch = clamp(-plane.vf * 0.008, -0.3, 0.3); plane.roll = clamp(plane.vs * 0.012, -0.25, 0.25);
    plane.gamma = 0; plane.aoa = 0; plane.stalled = false; plane.onGround = false; plane.crashed = null; plane.surface = world ? world.surface(plane.x, plane.z) : 'land';
    return plane;
  }

  // Advance the plane by `dt` seconds (keep dt small, 0.05 s or less). `world` answers questions about the ground:
  //   world.surface(x, z) -> 'runway' | 'land' | 'water'     world.obstacle(x, y, z) -> a building the point is inside, or null
  // Retractable gear (the Airbus and the jet; the Cessna 172's is fixed): it takes `gearTravel` seconds to go up or down (1 = down and locked, 0 = up),
  // adds drag while it is out, cannot be raised while the aircraft is on the ground, and landing with it up is a crash.
  const GEAR_TRAVEL = { airbus: 8, jet: 5 };
  const retractable = plane => Boolean(GEAR_TRAVEL[plane.mode]);
  function moveGear(plane, dt) {
    if (!retractable(plane)) { plane.gear = 1; plane.gearDown = true; return; }
    if (plane.onGround) plane.gearDown = true;
    const step = dt / GEAR_TRAVEL[plane.mode]; plane.gear = clamp((plane.gear ?? 1) + (plane.gearDown === false ? -step : step), 0, 1);
  }
  const gearUpLanding = plane => retractable(plane) && (plane.gear ?? 1) < 0.9;
  // `scale` is the simulation speed: it makes the plane cover `scale` times the distance in the same time, but turning, pitching, rolling
  // and accelerating happen at their normal rates, so the plane handles the same at 100x as at 1x.
  function step(plane, input, dt, world, scale = 1) {
    if (plane.crashed) return plane;
    const S = specOf(plane);
    plane.time += dt; const move = dt * scale;
    moveGear(plane, dt);
    if (plane.mode === 'drone') return stepDrone(plane, input, dt, world, move);
    if (plane.mode === 'jet' && !plane.onGround) return stepJet(plane, input, dt, world, move);
    // Controls ramp towards the stick position and spring back to centre: elevator +1 is stick back (nose up).
    const ramp = (value, target, rate) => value + clamp(target - value, -rate * dt, rate * dt);
    plane.elevator = ramp(plane.elevator, clamp(input.elevator || 0, -1, 1), S.elevRate);
    plane.aileron = ramp(plane.aileron, clamp(input.aileron || 0, -1, 1), S.ailRate);
    plane.rudder = ramp(plane.rudder, clamp(input.rudder || 0, -1, 1), 3);
    plane.throttle = clamp(plane.throttle + (input.throttleRate || 0) * dt, 0, 1);
    plane.brake = Boolean(input.brake);

    const speed = Math.max(plane.speed, 0.5), q = 0.5 * S.rho * speed * speed;
    const thrust = plane.mode === 'jet' ? plane.throttle * S.mass * 14 : plane.throttle * Math.min(S.staticThrust, S.power / Math.max(speed, 12));
    if (plane.onGround) return groundRun(plane, thrust, q, dt, world, move);

    // Angle of attack follows the stick; the nose follows the angle of attack plus the flight path.
    const alphaCommand = S.trimAlpha + plane.elevator * S.elevatorRange;
    const pitchTarget = plane.gamma + alphaCommand;
    plane.pitch += (pitchTarget - plane.pitch) * Math.min(1, dt / S.pitchLag);
    plane.roll += (plane.aileron * S.maxBank - plane.roll) * Math.min(1, dt / S.rollLag);
    plane.aoa = plane.pitch - plane.gamma;
    // Flaps (0 to 3 notches: up, 10, 20 and 30 degrees) add lift and drag, as on the Cessna 172.
    const flaps = clamp(plane.flaps || 0, 0, S.maxFlaps), cl0 = S.cl0 + flaps * S.flapCl;
    let cl = cl0 + S.clAlpha * clamp(plane.aoa, -0.4, 0.6);
    plane.stalled = plane.aoa > S.stallAlpha;
    if (plane.stalled) cl = cl0 + S.clAlpha * S.stallAlpha - 3.2 * (plane.aoa - S.stallAlpha); // the lift falls away past the stall
    const lift = q * S.wingArea * cl, drag = q * S.wingArea * (S.cd0 + flaps * S.flapCd + (S.gearCd || 0) * (plane.gear ?? 1) + S.k * cl * cl);
    const cosRoll = Math.max(0.2, Math.cos(plane.roll));
    const dSpeed = (thrust * Math.cos(plane.aoa) - drag) / S.mass - G * Math.sin(plane.gamma);
    const dGamma = (lift * cosRoll + thrust * Math.sin(plane.aoa)) / (S.mass * speed) - G * Math.cos(plane.gamma) / speed;
    const dHeading = lift * Math.sin(plane.roll) / (S.mass * speed * Math.max(0.2, Math.cos(plane.gamma))) + plane.rudder * 0.12 * Math.min(1, speed / 35);
    plane.speed = clamp(plane.speed + dSpeed * dt, 5, S.maxSpeed);
    plane.gamma = clamp(plane.gamma + dGamma * dt, -1.2, 1.2);
    plane.heading += dHeading * dt;
    const horizontal = plane.speed * Math.cos(plane.gamma);
    plane.x += Math.sin(plane.heading) * horizontal * move;
    plane.z += Math.cos(plane.heading) * horizontal * move;
    plane.verticalSpeed = plane.speed * Math.sin(plane.gamma);
    plane.y += plane.verticalSpeed * move;
    return contact(plane, world);
  }

  // Touching down, hitting a building or the water. Returns the plane, possibly marked as crashed.
  function contact(plane, world) {
    if (!world) return plane;
    const S = specOf(plane);
    const building = world.obstacle(plane.x, plane.y, plane.z);
    if (building) { plane.crashed = 'You flew into a building.'; plane.speed = 0; return plane; }
    if (plane.y > 0.6) return plane;
    const surface = world.surface(plane.x, plane.z);
    if (surface === 'water') { if (plane.y <= -0.2) { plane.crashed = 'You ditched in the water.'; plane.speed = 0; } return plane; }
    if (plane.y > 0) return plane;
    const sink = -plane.verticalSpeed;
    if (gearUpLanding(plane)) plane.crashed = 'You landed with the landing gear up.';
    else if (sink > S.safe.sinkRate) plane.crashed = 'Hard landing: you came down too fast.';
    else if (Math.abs(plane.roll) > S.safe.bank) plane.crashed = 'You touched down with a wing low.';
    else if (plane.pitch < S.safe.nosePitch) plane.crashed = 'You touched down nose first.';
    else if (surface === 'land' && plane.speed > S.safe.speedOffRunway + 10) plane.crashed = 'You hit the ground off the runway too fast.';
    if (plane.crashed) { plane.speed = 0; return plane; }
    plane.y = 0; plane.onGround = true; plane.gamma = 0; plane.verticalSpeed = 0; plane.roll = 0; plane.surface = surface;
    return plane;
  }

  // Rolling on the ground: friction, brakes, nose wheel steering, and lifting off once there is enough lift.
  function groundRun(plane, thrust, q, dt, world, move = dt) {
    const S = specOf(plane);
    plane.surface = world ? world.surface(plane.x, plane.z) : 'runway';
    if (plane.surface === 'water') { plane.crashed = 'You rolled into the water.'; plane.speed = 0; return plane; }
    const friction = plane.surface === 'runway' ? S.rollingDecel : S.grassDecel;
    const decel = (plane.brake ? S.brakeDecel : 0) + friction + q * S.wingArea * S.cd0 / S.mass;
    plane.speed = Math.max(0, plane.speed + (thrust / S.mass - (plane.speed > 0.2 ? decel : 0)) * dt);
    plane.heading += (plane.rudder + plane.aileron * 0.6) * Math.min(plane.speed, 20) * 0.025 * dt * 6;
    const wantPitch = plane.speed > S.rotateSpeed ? Math.max(0, plane.elevator) * 0.3 : 0;
    plane.pitch += (wantPitch - plane.pitch) * Math.min(1, dt / 0.4); plane.roll = 0; plane.gamma = 0; plane.aoa = plane.pitch; plane.stalled = false;
    plane.x += Math.sin(plane.heading) * plane.speed * move; plane.z += Math.cos(plane.heading) * plane.speed * move; plane.y = 0; plane.verticalSpeed = 0;
    const liftNow = q * S.wingArea * (S.cl0 + (plane.flaps || 0) * S.flapCl + S.clAlpha * plane.pitch);
    if (plane.mode === 'jet') { if (plane.speed > 50 && plane.elevator > 0.15) { plane.onGround = false; plane.gamma = 0.05; plane.pitch = Math.max(plane.pitch, 0.1); startJet(plane); } }
    else if (plane.pitch > 0.06 && liftNow > S.mass * G) { plane.onGround = false; plane.gamma = 0.02; }
    if (world && world.obstacle(plane.x, 1, plane.z)) { plane.crashed = 'You drove into a building.'; plane.speed = 0; }
    return plane;
  }

  // Run the plane for `seconds` of simulated time (the time-scale buttons call this with scaled frame times), in small steps.
  // `seconds` is real time; `scale` is the simulation speed (distance only). A step never moves the plane more than about 8 m, so
  // buildings and the ground are not skipped at 100x.
  function advance(plane, input, seconds, world, maxStep = 0.025, scale = 1) {
    const steps = Math.min(4000, Math.max(1, Math.ceil(seconds / maxStep), Math.ceil(Math.max(plane.speed, 1) * seconds * scale / 8))), dt = seconds / steps;
    for (let i = 0; i < steps && !plane.crashed; i++) step(plane, input, dt, world, scale);
    return plane;
  }

  const KNOTS = 1.943844, FEET = 3.28084;
  const readout = plane => ({ knots: plane.speed * KNOTS, feet: plane.y * FEET, fpm: plane.verticalSpeed * FEET * 60, degrees: (plane.heading * 180 / Math.PI % 360 + 360) % 360, pitch: plane.pitch * 180 / Math.PI, bank: plane.roll * 180 / Math.PI });

  // Change vehicle without moving: the position, heading, speed and throttle carry over, so you can switch in mid-air. Going to a
  // plane or jet from a drone gives it flying speed (and some height to fly away with); going to a drone keeps the forward motion.
  function switchMode(plane, mode) {
    if (plane.mode === mode || plane.crashed) return plane;
    const flying = !plane.onGround, speed = plane.speed, heading = plane.heading;
    if (plane.mode === 'jet' && plane.axes) { plane.gamma = plane.speed > 0.5 ? Math.asin(clamp(plane.vel[1] / plane.speed, -1, 1)) : 0; }
    if (mode === 'drone') {
      Object.assign(plane, { mode: 'drone', axes: null, vel: null, heading, pitch: 0, roll: 0, gamma: 0, speed: 0, vf: 0, vs: 0, vz: 0, throttle: 0, view: -0.15, onGround: false, stalled: false, y: Math.max(plane.y, DRONE.floor), elevator: 0, aileron: 0, rudder: 0 });   // it hovers
      return plane;
    }
    if (plane.mode === 'drone') {            // a drone has no flying speed: give the new vehicle some, and a little height
      Object.assign(plane, { mode, axes: null, vel: null, speed: mode === 'jet' ? 110 : mode === 'airbus' ? 85 : 45, y: Math.max(plane.y, 25), gamma: 0, pitch: 0.05, roll: 0, throttle: Math.max(plane.throttle, 0.5), onGround: false, elevator: 0, aileron: 0, rudder: 0, flaps: 0 });
      return mode === 'jet' ? startJet(plane) : plane;
    }
    if (mode === 'jet') { plane.mode = 'jet'; return flying ? startJet(plane) : plane; }
    // jet to Cessna: keep the attitude as far as a Cessna can (it settles to level wings and a normal angle of attack)
    if (plane.axes) { Object.assign(plane, anglesOf(plane.axes)); plane.pitch = clamp(plane.pitch, -1.2, 1.2); plane.roll = clamp(plane.roll, -0.9, 0.9); }
    Object.assign(plane, { mode, axes: null, vel: null, elevator: 0, aileron: 0, rudder: 0 });
    const S = SPECS[mode] || PLANE; plane.flaps = Math.min(plane.flaps || 0, S.maxFlaps);
    if (mode === 'airbus' && !plane.onGround) plane.speed = Math.max(plane.speed, 85);   // an airliner needs more speed than a light plane
    plane.speed = Math.min(plane.speed, S.maxSpeed);
    return plane;
  }

  // After a crash: the same vehicle, in the same place and heading but at `altitude` metres, flying level at a safe speed.
  function recover(plane, altitude = 300) {
    const mode = plane.mode, heading = plane.heading;
    Object.assign(plane, { crashed: null, onGround: false, stalled: false, y: altitude, gamma: 0, pitch: 0.05, roll: 0, speed: mode === 'jet' ? 110 : mode === 'drone' ? 0 : mode === 'airbus' ? 95 : 45, throttle: mode === 'jet' ? 0.5 : mode === 'drone' ? 0 : mode === 'airbus' ? 0.5 : 0.55, flaps: 0, elevator: 0, aileron: 0, rudder: 0, brake: false, verticalSpeed: 0, axes: null, vel: null, heading, gear: altitude < 150 ? 1 : 0, gearDown: altitude < 150 });
    if (mode === 'drone') Object.assign(plane, { vf: 0, vs: 0, vz: 0, pitch: 0, view: -0.15 });
    return mode === 'jet' ? startJet(plane) : plane;
  }

  // ---- autopilot -------------------------------------------------------------------------------------------------------------------
  // Holds a heading and an altitude. It steers by banking towards the heading (a gentle bank for the Cessna and the Airbus, a steeper one for
  // the jet) and adjusts the angle of the flight path: the climb or descent rate is proportional to the altitude error and limited, and the
  // stick is the one that holds that path, worked out from the aircraft's own lift (the same maths as the landing advice) plus feedback. The
  // throttle is not touched. `target` is { heading (radians), alt (metres) }. Returns the stick (or, for the drone, climb and yaw) or null.
  const wrapAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
  const AUTOPILOT = { plane: { maxBank: 0.45, climb: 3.5, descent: 4 }, airbus: { maxBank: 0.4, climb: 9, descent: 8 }, jet: { maxBank: 1.0, climb: 30, descent: 15 } };
  function autopilot(plane, target) {
    if (plane.crashed || plane.onGround) return null;
    const headingError = wrapAngle(target.heading - plane.heading);
    if (plane.mode === 'drone') return { climb: clamp((target.alt - plane.y) * 0.5, -1, 1), yaw: clamp(headingError * 1.6, -1, 1) };
    const mode = plane.mode, limits = AUTOPILOT[mode] || AUTOPILOT.plane, speed = Math.max(plane.speed, 20), bank = clamp(headingError * 2.2, -(target.maxBank ?? limits.maxBank), target.maxBank ?? limits.maxBank);
    const climbRate = clamp((target.alt - plane.y) * 0.08, -limits.descent, limits.climb), gammaTarget = target.gamma ?? Math.asin(clamp(climbRate / speed, -0.5, 0.5)), gamma = plane.gamma || 0;   // `gamma`: fly this path angle instead of an altitude
    if (mode === 'jet') {
      const need = Math.cos(gamma) + 1.2 * (gammaTarget - gamma) * speed / G;                          // the load factor that bends the path towards the target
      const base = Math.cos(gamma), elevator = need >= base ? (need - base) / (JETSPEC.maxG - base) : (need - base) / (base - JETSPEC.minG);
      return { elevator: clamp(elevator, -1, 1), aileron: clamp((bank - plane.roll) * 3, -1, 1) };
    }
    const S = SPECS[mode] || PLANE, q = 0.5 * S.rho * speed * speed, cl0 = S.cl0 + clamp(plane.flaps || 0, 0, S.maxFlaps) * S.flapCl;
    const cl = S.mass * G * Math.cos(gamma) / (Math.max(q * S.wingArea, 1) * Math.max(Math.cos(bank), 0.5)), alphaNeeded = (cl - cl0) / S.clAlpha;
    const elevator = (alphaNeeded - S.trimAlpha) / S.elevatorRange + 4 * (gammaTarget - gamma), top = (S.stallAlpha * 0.85 - S.trimAlpha) / S.elevatorRange;
    return { elevator: clamp(elevator, -1, Math.min(1, top)), aileron: clamp(bank / S.maxBank, -1, 1) };
  }

  // ---- auto land -------------------------------------------------------------------------------------------------------------------
  // Flies the aircraft to a runway and lands it. `runway` is { x, z (the landing threshold), heading (the landing direction), length, width,
  // glide (degrees) }. In the runway's own axes (s along the landing direction from the threshold, c to the right of the centreline):
  //   NAV      not lined up: fly to a point on the extended centreline 6.5 km (9 km for the Airbus and the jet) before the threshold, at the
  //            height of the glide path there, with the landing schedule's flaps and speed;
  //   FINAL    lined up (inside a funnel round the centreline, pointing roughly the right way): track the centreline with a heading that
  //            corrects the cross-track error, and fly the glide path with a flight path angle that corrects the height error;
  //   FLARE    in the last few metres: sink at a rate that falls with height so it touches down softly, throttle idle;
  //   ROLLOUT  on the ground: steer along the centreline with the rudder, throttle idle, brakes, until it has almost stopped (done).
  // A long landing or an overshoot (past the threshold and still high) turns into NAV again, which is a go-around. It returns the stick,
  // rudder, the throttle and flap setting to go to, the brake and the phase, or null when there is nothing to do.
  function autoland(plane, runway, state = {}) {
    if (plane.crashed || plane.mode === 'drone' || plane.mode === 'jet') return null;   // the Cessna and the Airbus land themselves
    const mode = plane.mode, h = runway.heading, d = [Math.sin(h), Math.cos(h)], r = [Math.cos(h), -Math.sin(h)], dx = plane.x - runway.x, dz = plane.z - runway.z;
    const s = dx * d[0] + dz * d[1], c = dx * r[0] + dz * r[1], g = runway.glide * Math.PI / 180, height = plane.y, speed = Math.max(plane.speed, 1), kt = speed * KNOTS;
    const slopeAlt = along => 15 + Math.tan(g) * Math.max(0, -along);
    if (plane.onGround) {
      return { phase: 'ROLLOUT', elevator: 0, aileron: 0, rudder: clamp(2.2 * wrapAngle(h - plane.heading) - 0.02 * c, -1, 1), throttle: 0, flaps: 0, gear: true, brake: true, done: plane.speed < 2.5, s, c };
    }
    const distance = Math.hypot(s, c), jet = mode === 'jet', join = jet || mode === 'airbus' ? 9000 : 6500, flareAt = mode === 'airbus' ? 14 : jet ? 11 : 9;
    // Once lined up it stays lined up unless it is well outside the funnel (no flip-flopping at the edge).
    const funnel = (state.phase === 'FINAL' ? 1.8 : 1) * (0.12 * Math.max(0, -s) + 120), lined = Math.abs(c) < funnel && s < -150 && s > -12000 && Math.abs(wrapAngle(plane.heading - h)) < (state.phase === 'FINAL' ? 1.4 : 1.0) && Math.abs(height - slopeAlt(s)) < (state.phase === 'FINAL' ? 260 : 120 + 0.02 * Math.max(0, -s));   // and near the glide path
    let phase, target;
    if (lined || (s >= -150 && s < runway.length * 0.6 && Math.abs(c) < runway.width && height < 80)) {
      const lateral = clamp(-c / Math.max(400, -s * 0.5), -0.5, 0.5), error = slopeAlt(s) - height;
      phase = 'FINAL'; target = { maxBank: 0.5, heading: h + (s < -150 ? lateral : clamp(-c * 0.01, -0.1, 0.1)), alt: height, gamma: -g + clamp(error * 0.005, -0.07, 0.07) };
      if (height < flareAt && s > -600) { phase = 'FLARE'; target.gamma = -Math.max(0.3, 0.14 * height) / speed; }
    } else if (state.nav === 'intercept' ? s < -1500 : s < -3000) {
      state.nav = 'intercept';
      // On the approach side but not lined up: intercept the extended centreline at an angle that shrinks as the error does.
      phase = 'NAV'; target = { heading: h + clamp(-c / 2500, -1.0, 1.0), alt: slopeAlt(Math.min(-s, join)) + 60, maxBank: jet ? 0.6 : undefined };
    } else {
      // Beside, over or past the runway: fly out to a point on the extended centreline, then turn in.
      phase = 'NAV'; state.nav = 'join';
      const jx = runway.x - d[0] * join, jz = runway.z - d[1] * join;
      target = { heading: Math.atan2(jx - plane.x, jz - plane.z), alt: slopeAlt(-join) + 60, maxBank: jet ? 0.6 : undefined };
    }
    state.phase = phase;
    const control = autopilot(plane, target) || { elevator: 0, aileron: 0 };
    let flaps = 0, throttle, targetKt;
    if (jet) { targetKt = distance > 12000 ? 300 : distance > 7000 ? 230 : distance > 3500 ? 190 : 170; throttle = clamp(0.3 + 0.012 * (targetKt - kt), 0, 0.75); }
    else { const advice = PHASES[mode] ? advicePhase(mode, distance, runway.glide) : null; flaps = advice.flaps; targetKt = advice.kt; throttle = clamp(advice.throttle + 0.012 * (advice.kt - kt), 0, 1); }
    if (phase === 'FLARE' || (height < 12 && s > -300)) throttle = 0;
    return { phase, elevator: control.elevator, aileron: control.aileron, rudder: 0, throttle, flaps, gear: phase !== 'NAV' || distance < 12000, brake: false, done: false, kt: targetKt, s, c };
  }
  // The landing schedule at a distance from the runway: flaps, speed and the throttle that holds the speed on the path.
  function advicePhase(mode, distance, glide) {
    const S = SPECS[mode] || PLANE; let phase = PHASES[mode][0]; for (const candidate of PHASES[mode]) if (distance <= candidate.upTo) phase = candidate;
    const path = phase.glide <= -3 ? -glide : phase.glide;
    return { flaps: Math.min(phase.flaps, S.maxFlaps), kt: phase.kt, throttle: throttleFor(mode, phase.kt / KNOTS, Math.min(phase.flaps, S.maxFlaps), path) };
  }

  // ---- automatic flights: takeoff, climb, cruise ----------------------------------------------------------------------------------
  // For a flight from one airport to another with the autopilot on (the Cessna and the Airbus): `autotakeoff` takes off from the runway (full
  // throttle, rudder on the centreline, rotate at the right speed), `enroute` climbs to a cruise altitude, flies to a heading and holds the
  // speed and then `autoland` (above) flies the approach and landing at the other end. Each returns the stick, the throttle and flap setting
  // to go to, whether the gear should be down, and the phase, like `autoland`.
  const CRUISE = { plane: { climbKt: 76, cruiseKt: 100, maxAlt: 1800, rotate: 29 }, airbus: { climbKt: 200, cruiseKt: 230, maxAlt: 6000, rotate: 72 } };
  function spawnTakeoff(mode, { x, z, heading }) {
    return create({ mode, x, z, y: mode === 'drone' ? 1.2 : 0, heading, onGround: mode !== 'drone', speed: 0, throttle: 0, flaps: mode === 'plane' || mode === 'airbus' ? 1 : 0, pitch: 0, roll: 0, gamma: 0, gear: 1, gearDown: true });
  }
  // The cruise altitude for a route of `distance` metres (short routes do not climb as high), and the distance from the destination at
  // which the descent begins: down a 3 degree path to the point where the approach starts.
  function routePlan(mode, distance, glide = 3) {
    const spec = CRUISE[mode] || CRUISE.plane, cruise = clamp(distance * 0.025, 500, spec.maxAlt), join = mode === 'airbus' ? 9000 : 6500;
    return { cruise, descentAt: (cruise - 450) / Math.tan(glide * Math.PI / 180) + join, swapAt: (cruise - 450) / Math.tan(glide * Math.PI / 180) + join + 20000 };
  }
  function autotakeoff(plane, runway) {
    if (plane.crashed || !CRUISE[plane.mode]) return null;
    const spec = CRUISE[plane.mode], h = runway.heading, dx = plane.x - runway.x, dz = plane.z - runway.z, c = dx * Math.cos(h) - dz * Math.sin(h);
    return { phase: 'TAKEOFF', elevator: plane.speed > spec.rotate ? 1 : 0, aileron: 0, rudder: clamp(2.2 * wrapAngle(h - plane.heading) - 0.02 * c, -1, 1), throttle: 1, flaps: 1, gear: true, brake: false };
  }
  function enroute(plane, plan) {
    const mode = plane.mode, spec = CRUISE[mode]; if (plane.crashed || !spec) return null;
    const climbing = plane.y < plan.alt - 100, kt = plane.speed * KNOTS, targetKt = climbing ? spec.climbKt : spec.cruiseKt;
    const control = autopilot(plane, { heading: plan.heading, alt: plan.alt, maxBank: 0.4 }) || { elevator: 0, aileron: 0 };
    const level = throttleFor(mode, targetKt / KNOTS, 0, 0, 0), throttle = climbing ? clamp(0.98 + 0.01 * (targetKt - kt), 0.6, 1) : clamp(level + 0.02 * (targetKt - kt), 0, 1);
    return { phase: climbing ? 'CLIMB' : 'CRUISE', elevator: control.elevator, aileron: control.aileron, rudder: 0, throttle, flaps: plane.y < 300 ? 1 : 0, gear: plane.y < 80, brake: false };
  }

  // ---- landing advice -------------------------------------------------------------------------------------------------------------
  // For a Cessna or the Airbus near an airport: the phase of the approach from the distance to the runway, and the flaps, speed and
  // throttle that go with it. The throttle is not a guess: it is the thrust that holds the target speed on the phase's flight path,
  // worked out from the aircraft's own lift and drag, divided by the thrust the engines have at that speed.
  const PHASES = {
    plane: [{ name: 'Cruise', upTo: Infinity, flaps: 0, kt: 95, glide: 0 }, { name: 'Slow down', upTo: 9000, flaps: 1, kt: 85, glide: -1.5 }, { name: 'Approach', upTo: 5000, flaps: 2, kt: 75, glide: -3 }, { name: 'Final', upTo: 2800, flaps: 3, kt: 68, glide: -3 }],
    airbus: [{ name: 'Cruise', upTo: Infinity, flaps: 0, kt: 230, glide: 0 }, { name: 'Slow down', upTo: 14000, flaps: 1, kt: 190, glide: -2 }, { name: 'Approach', upTo: 8000, flaps: 2, kt: 165, glide: -3, gear: true }, { name: 'Final', upTo: 4500, flaps: 3, kt: 148, glide: -3, gear: true }, { name: 'Short final', upTo: 2000, flaps: 4, kt: 138, glide: -3, gear: true }]
  };
  // The throttle (0 to 1) that holds `speed` (m/s) on a path of `glide` degrees with the given flaps.
  function throttleFor(mode, speed, flaps, glideDegrees, gear = 0) {
    const S = SPECS[mode] || PLANE, gamma = glideDegrees * Math.PI / 180, weight = S.mass * G, q = 0.5 * S.rho * speed * speed;
    const cl = weight * Math.cos(gamma) / (q * S.wingArea), drag = q * S.wingArea * (S.cd0 + flaps * S.flapCd + (S.gearCd || 0) * gear + S.k * cl * cl);
    return clamp((drag + weight * Math.sin(gamma)) / Math.min(S.staticThrust, S.power / Math.max(speed, 12)), 0, 1);
  }
  // distance: metres to the landing threshold (along the approach); height: metres above the runway; departing: the aircraft is
  // heading away from the runway.
  function advice(plane, { distance, height = plane.y, departing = false, glide = 3 }) {
    const mode = plane.mode; if (!PHASES[mode]) return null;
    const S = SPECS[mode] || PLANE, kt = v => v / KNOTS;
    if (plane.onGround) {
      if (plane.speed < 5) return { phase: 'Takeoff', flaps: 1, gear: S.gearTravel ? true : null, throttle: 1, kt: Math.round(S.rotateSpeed * KNOTS), note: 'Full throttle, rotate at the speed shown.' };
      return { phase: 'Rollout', flaps: 0, gear: S.gearTravel ? true : null, throttle: 0, kt: 0, note: 'Throttle idle, flaps up, brakes (Space).' };
    }
    if (departing && distance < 15000) return { phase: 'Departure', flaps: height < 150 ? 1 : 0, gear: S.gearTravel ? height < 60 : null, throttle: Math.min(1, throttleFor(mode, S.approachSpeed * 1.15, 0, 4)), kt: Math.round(S.approachSpeed * 1.15 * KNOTS), note: S.gearTravel ? 'Climb away, then gear and flaps up.' : 'Climb away, then flaps up.' };
    const list = PHASES[mode]; let phase = list[0]; for (const candidate of list) if (distance <= candidate.upTo) phase = candidate;
    if (height < 14 && distance < 1800) return { phase: 'Flare', flaps: phase.flaps, gear: S.gearTravel ? true : null, throttle: 0, kt: phase.kt, note: 'Throttle idle and raise the nose gently.' };
    const path = phase.glide <= -3 ? -glide : phase.glide;   // the approach path of this airport (London City is 5.5 degrees)
    const flaps = Math.min(phase.flaps, S.maxFlaps), gearDown = Boolean(phase.gear), throttle = throttleFor(mode, phase.kt / KNOTS, flaps, path, gearDown ? 1 : 0);
    return { phase: phase.name, flaps, gear: S.gearTravel ? gearDown : null, throttle, kt: phase.kt, glide: path, note: '' };
  }

  // Start for each mode on the same final approach: a Cessna, a jet (faster, no limits) or a drone hovering over the approach path.
  function spawn(mode, options) {
    const plane = approach({ ...options, mode: mode === 'airbus' ? 'airbus' : 'plane' });
    if (mode === 'jet') { plane.speed = 100; plane.throttle = 0.5; plane.pitch = plane.gamma + 0.05; return startJet(plane); }
    if (mode === 'drone') { Object.assign(plane, { mode: 'drone', speed: 0, throttle: 0, y: 80, gamma: 0, pitch: 0, roll: 0, view: -0.15, vf: 0, vs: 0, vz: 0 }); plane.x = options.x - Math.sin(options.heading) * 600; plane.z = options.z - Math.cos(options.heading) * 600; }
    return plane;
  }

  return { spawnTakeoff, routePlan, autotakeoff, enroute, CRUISE, moveGear, retractable, GEAR_TRAVEL, autoland, autopilot, wrapAngle, AUTOPILOT, advice, throttleFor, PHASES, PLANE, AIRBUS, SPECS, SAFE, JET, DRONE, G, create, approach, spawn, switchMode, recover, startJet, axesFrom, anglesOf, step, advance, contact, readout, clamp };
});

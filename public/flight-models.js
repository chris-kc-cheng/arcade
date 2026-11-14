// Aircraft and drone models for the flight simulator, built from smooth surfaces instead of boxes: fuselages are lofted through
// elliptical cross-sections, wings and tails are tapered, swept airfoils (a NACA-style thickness curve), engines, gear legs and
// propellers are tubes, and canopies are ellipsoids. Normals are averaged across neighbouring faces so curved parts shade smoothly.
// The nose points along +z, up is +y and the right wing is +x. Output is interleaved: position, normal, colour (9 floats a vertex).
// A UMD module: used by the page and by the tests, which check the real dimensions.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.FlightModels = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = a => Math.hypot(a[0], a[1], a[2]), unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  // Collects triangles. `surface` takes rings of points (each ring the same length, closed around) and joins neighbouring rings.
  function Builder() { this.data = []; }
  Builder.prototype.triangle = function (points, normals, colors) { for (let i = 0; i < 3; i++) this.data.push(...points[i], ...normals[i], ...colors[i]); };
  // rings: arrays of [x, y, z]; color: [r, g, b] or a function (ringIndex, pointIndex) -> colour; caps: colours for the first / last ring (or null).
  Builder.prototype.surface = function (rings, color, caps = {}) {
    const rows = rings.length, n = rings[0].length, at = (i, j) => rings[i][((j % n) + n) % n], paint = typeof color === 'function' ? color : () => color;
    const normals = rings.map(ring => ring.map(() => [0, 0, 0])), quads = [];
    const accumulate = (i, j, normal) => { const target = normals[i][((j % n) + n) % n]; target[0] += normal[0]; target[1] += normal[1]; target[2] += normal[2]; };
    for (let i = 0; i + 1 < rows; i++) for (let j = 0; j < n; j++) {
      const a = at(i, j), b = at(i, j + 1), c = at(i + 1, j + 1), d = at(i + 1, j), face = cross(sub(b, a), sub(c, a)), face2 = cross(sub(c, a), sub(d, a));
      for (const [ii, jj] of [[i, j], [i, j + 1], [i + 1, j + 1]]) accumulate(ii, jj, face);
      for (const [ii, jj] of [[i, j], [i + 1, j + 1], [i + 1, j]]) accumulate(ii, jj, face2);
      quads.push([i, j]);
    }
    // Normals point away from the middle of their ring (face culling is off, so winding does not matter).
    const centres = rings.map(ring => mul(ring.reduce((sum, p) => add(sum, p), [0, 0, 0]), 1 / n));
    const finished = normals.map((ring, i) => ring.map((normal, j) => { let u = unit(normal); if (dot(u, sub(at(i, j), centres[i])) < 0) u = mul(u, -1); return u; }));
    const fin = (i, j) => finished[i][((j % n) + n) % n], col = (i, j) => paint(i, ((j % n) + n) % n);
    for (const [i, j] of quads) {
      const corners = [[i, j], [i, j + 1], [i + 1, j + 1], [i + 1, j]];
      for (const tri of [[0, 1, 2], [0, 2, 3]]) this.triangle(tri.map(k => at(corners[k][0], corners[k][1])), tri.map(k => fin(corners[k][0], corners[k][1])), tri.map(k => col(corners[k][0], corners[k][1])));
    }
    const cap = (ringIndex, other, colour) => {
      if (!colour) return;
      const centre = centres[ringIndex], out = unit(sub(centre, centres[other]));
      for (let j = 0; j < n; j++) this.triangle([centre, at(ringIndex, j), at(ringIndex, j + 1)], [out, out, out], [colour, colour, colour]);
    };
    cap(0, Math.min(1, rows - 1), caps.start); cap(rows - 1, Math.max(0, rows - 2), caps.end);
  };

  // A body of revolution-like loft: sections { z, rx, ry, cy, cx } are ellipses; `around` points on each; colour (section, point) -> rgb.
  function fuselage(builder, sections, around, color, caps) {
    const rings = sections.map(s => Array.from({ length: around }, (_, j) => { const t = 2 * Math.PI * j / around; return [(s.cx || 0) + s.rx * Math.cos(t), s.cy + s.ry * Math.sin(t), s.z]; }));
    builder.surface(rings, color, caps);
  }
  // An ellipsoid centred on c with the given half sizes.
  function ellipsoid(builder, c, rx, ry, rz, color, around = 12, rows = 8, caps) {
    const sections = []; for (let i = 0; i <= rows; i++) { const t = Math.PI * i / rows, k = Math.sin(t); sections.push({ z: c[2] + rz * Math.cos(t), rx: Math.max(rx * k, 1e-4), ry: Math.max(ry * k, 1e-4), cx: c[0], cy: c[1] }); }
    fuselage(builder, sections, around, color, caps);
  }
  // A tube (or cone) between two points.
  function tube(builder, p0, p1, r0, r1, color, around = 8, caps = true) {
    const axis = unit(sub(p1, p0)), ref = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u = unit(cross(axis, ref)), v = cross(axis, u);
    const ring = (p, r) => Array.from({ length: around }, (_, j) => { const t = 2 * Math.PI * j / around; return add(p, add(mul(u, r * Math.cos(t)), mul(v, r * Math.sin(t)))); });
    builder.surface([ring(p0, r0), ring(p1, r1)], color, caps ? { start: color, end: color } : {});
  }
  // A wheel: a short cylinder along the x axis.
  const wheel = (builder, c, r, width, color) => tube(builder, [c[0] - width / 2, c[1], c[2]], [c[0] + width / 2, c[1], c[2]], r, r, color, 12);

  // A tapered, swept wing or tail. `le0` and `le1` are the leading-edge points at the root and the tip, `chord0` / `chord1` the chords
  // (measured along `back`, usually -z), `thick` the thickness as a fraction of the chord and `up` the direction thickness is measured in
  // (y for wings, x for fins). `stripes` lists [fraction of span, colour] steps along the span.
  function airfoil(n) {
    const points = [], thickness = x => 5 * 0.12 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    for (let k = 0; k <= n; k++) { const x = 0.5 * (1 - Math.cos(Math.PI * k / n)); points.push([x, thickness(x)]); }
    for (let k = n - 1; k >= 1; k--) { const x = 0.5 * (1 - Math.cos(Math.PI * k / n)); points.push([x, -thickness(x)]); }
    return points;
  }
  const PROFILE = airfoil(8);
  function wing(builder, { le0, le1, chord0, chord1, thick = 1, up = [0, 1, 0], back = [0, 0, -1], color, stripes, tip }) {
    const stations = stripes ? stripes.flatMap(([t, c]) => [[t, c]]) : [[0, color], [1, color]];
    const rings = [], colours = [];
    const at = (t) => ({ le: add(le0, mul(sub(le1, le0), t)), chord: chord0 + (chord1 - chord0) * t });
    const list = []; for (const [t, c] of stations) { list.push([t, c]); }
    // Each stripe boundary is made of two rings a hair apart so the colour changes sharply.
    const expanded = []; list.forEach(([t, c], i) => { if (i > 0 && c !== list[i - 1][1]) expanded.push([t - 1e-4, list[i - 1][1]]); expanded.push([t, c]); });
    for (const [t, c] of expanded) { const { le, chord } = at(t); rings.push(PROFILE.map(([x, y]) => add(add(le, mul(back, x * chord)), mul(up, y * chord * thick)))); colours.push(c); }
    builder.surface(rings, (i) => colours[i], { start: colours[0], end: tip || colours.at(-1) });
  }

  // ---- the vehicles --------------------------------------------------------------------------------------------------------------
  const WHITE = [0.94, 0.95, 0.96], GLASS = [0.1, 0.15, 0.22], DARK = [0.14, 0.15, 0.17], GREY = [0.56, 0.58, 0.63], LIGHT = [0.82, 0.84, 0.88];
  const sideBand = (t, lo, hi) => Math.abs(Math.cos(t)) > 0.55 && Math.sin(t) > lo && Math.sin(t) < hi;

  // Cessna 172: 8.2 m long, 11 m span, high strutted wing, tricycle gear with wheel pants.
  function cessna(body, accent) {
    const b = new Builder(), around = 20;
    const sections = [[-4.25, .04, .07, .55], [-3.95, .14, .2, .5], [-3.2, .28, .4, .4], [-2.0, .42, .52, .28], [-1.0, .56, .68, .12], [0.2, .6, .72, .07], [1.2, .6, .7, 0], [1.8, .56, .6, -.06], [2.4, .54, .5, -.1], [3.1, .5, .46, -.1], [3.4, .42, .4, -.1], [3.48, .1, .1, -.1]];
    fuselage(b, sections.map(([z, rx, ry, cy]) => ({ z, rx, ry, cy })), around, (i, j) => {
      const t = 2 * Math.PI * j / around, z = sections[i][0];
      if (z > -1.9 && z < 1.9 && sideBand(t, 0.18, 0.85)) return GLASS;                 // cabin windows
      if (z > 0.8 && z < 1.9 && Math.sin(t) > 0.6) return GLASS;                         // windscreen
      if (z > -3.6 && z < 3.3 && Math.abs(Math.cos(t)) > 0.8 && Math.abs(Math.sin(t) + 0.02) < 0.28) return body;   // cheat line
      return z > 3.3 ? accent : WHITE;
    });
    tube(b, [0, -0.1, 3.4], [0, -0.1, 3.85], 0.25, 0.02, accent, 12);                                                                   // spinner
    for (const side of [1, -1]) {
      wing(b, { le0: [0, 0.8, 1.0], le1: [side * 5.5, 1.1, 0.7], chord0: 1.72, chord1: 1.05, thick: 0.9, stripes: [[0, WHITE], [0.95, WHITE], [0.95, body], [1, body]] });   // high wing
      wing(b, { le0: [0, 0.4, -3.4], le1: [side * 1.9, 0.5, -3.8], chord0: 1.0, chord1: 0.55, thick: 0.8, color: WHITE });                                          // tailplane
      tube(b, [side * 0.4, -0.3, 0.8], [side * 2.7, 1.05, 0.75], 0.045, 0.04, WHITE, 6);                                                                                      // wing strut
      tube(b, [side * 0.3, -0.1, 0.4], [side * 1.2, -0.78, 0.3], 0.05, 0.045, GREY, 6);                                                                                       // main gear leg
      ellipsoid(b, [side * 1.25, -0.86, 0.3], 0.13, 0.24, 0.46, WHITE, 12, 8);                                                                                                 // wheel pant
      wheel(b, [side * 1.25, -0.88, 0.3], 0.22, 0.2, DARK);
    }
    wing(b, { le0: [0, 0.5, -2.85], le1: [0, 1.95, -3.8], chord0: 1.4, chord1: 0.65, thick: 0.75, up: [1, 0, 0], stripes: [[0, WHITE], [0.8, WHITE], [0.8, body], [1, body]] });   // fin
    tube(b, [0, -0.2, 1.6], [0, -0.85, 1.68], 0.05, 0.045, GREY, 6); wheel(b, [0, -0.9, 1.68], 0.2, 0.14, DARK);                          // nose gear
    return b.data;
  }

  // The Cessna's two propeller blades, a separate part so the page can spin it about the nose axis through (0, -0.1, 3.8).
  function cessnaPropeller() {
    const b = new Builder();
    wing(b, { le0: [0, -0.1, 3.8], le1: [0, 0.96, 3.8], chord0: 0.13, chord1: 0.09, thick: 1.2, up: [0, 0, 1], back: [1, 0, 0], color: DARK });
    wing(b, { le0: [0, -0.1, 3.8], le1: [0, -1.16, 3.8], chord0: 0.13, chord1: 0.09, thick: 1.2, up: [0, 0, 1], back: [-1, 0, 0], color: DARK });
    return b.data;
  }


  // Airbus A320: 37.6 m long, 35.8 m span with 25 degree swept wings and sharklets, fin top 11.8 m above the ground, CFM engines.
  function airbus(_pilotColour, _accent, withGear = true) {
    // Cathay Pacific colours whatever the pilot's colour: white body, light grey belly, a dark green tail fin with the "brushwing" strokes,
    // green sharklets and a green stripe along the windows.
    const body = [0.74, 0.76, 0.79], green = [0.0, 0.4, 0.34], leaf = [0.86, 0.93, 0.9], b = new Builder(), around = 28;
    const z = [18.8, 18.4, 17.8, 17.0, 16.0, 14.6, 12, 9.5, 7, 4.5, 2, -0.5, -3, -5.5, -8, -10.5, -12.5, -14.5, -16.5, -17.8, -18.8];
    const shape = { 18.8: [.1, .1, -.3], 18.4: [.62, .68, -.28], 17.8: [1.1, 1.2, -.22], 17.0: [1.55, 1.7, -.12], 16.0: [1.82, 1.92, -.04], 14.6: [1.96, 2.0, 0], 12: [2, 2, 0], 9.5: [2, 2, 0], 7: [2, 2, 0], 4.5: [2, 2, 0], 2: [2, 2, 0], '-0.5': [2, 2, 0], '-3': [2, 2, 0], '-5.5': [2, 2, 0], '-8': [2, 2, 0], '-10.5': [1.99, 2, .02], '-12.5': [1.9, 1.95, .12], '-14.5': [1.62, 1.7, .4], '-16.5': [1.2, 1.28, .75], '-17.8': [.75, .82, 1.05], '-18.8': [.3, .36, 1.25] };
    const sections = z.map(zz => { const [rx, ry, cy] = shape[zz]; return { z: zz, rx, ry, cy }; });
    fuselage(b, sections, around, (i, j) => {
      const t = 2 * Math.PI * j / around, zz = z[i];
      if (zz > 16.4 && zz < 18.3 && Math.sin(t) > 0.32 && Math.sin(t) < 0.82 && Math.abs(Math.cos(t)) < 0.78) return GLASS;      // cockpit windows
      if (zz < 15 && zz > -11 && Math.abs(Math.cos(t)) > 0.9 && Math.sin(t) > 0.12 && Math.sin(t) < 0.32) return GLASS;         // cabin windows
      if (Math.sin(t) < -0.35 && zz > -17 && zz < 13) return body;                                                              // light grey belly
      if (zz < -15.5) return green;                                                                                                // tail cone in the tail colour
      if (Math.abs(Math.cos(t)) > 0.9 && Math.sin(t) > 0.34 && Math.sin(t) < 0.5 && zz > -11 && zz < 15) return green;       // thin green stripe above the windows
      return WHITE;
    }, { start: DARK, end: LIGHT });
    for (const side of [1, -1]) {
      wing(b, { le0: [0, -1.3, 3.4], le1: [side * 17.8, -0.4, -3.6], chord0: 6.4, chord1: 1.6, thick: 0.85, color: WHITE });                       // swept wing
      wing(b, { le0: [side * 17.8, -0.4, -3.2], le1: [side * 18.0, 1.5, -4.5], chord0: 1.6, chord1: 0.55, thick: 0.9, up: [1, 0, 0], color: green });          // sharklet
      wing(b, { le0: [0, 0.85, -14.0], le1: [side * 6.3, 1.5, -17.5], chord0: 3.9, chord1: 1.3, thick: 0.7, color: WHITE });                         // tailplane
      // engine: nacelle with a dark inlet lip and a core cone behind, on a pylon
      const ex = side * 5.7, ey = -2.5;
      fuselage(b, [{ z: 4.35, rx: .8, ry: .8, cx: ex, cy: ey }, { z: 4.1, rx: .98, ry: .98, cx: ex, cy: ey }, { z: 3.0, rx: 1.05, ry: 1.05, cx: ex, cy: ey }, { z: 1.0, rx: 1.0, ry: 1.0, cx: ex, cy: ey }, { z: -0.6, rx: .86, ry: .86, cx: ex, cy: ey }], 20, (i) => i === 0 ? DARK : WHITE, { start: DARK, end: GREY });
      tube(b, [ex, ey, -0.5], [ex, ey, -1.7], 0.6, 0.12, GREY, 12);
      wing(b, { le0: [ex, -1.05, 2.8], le1: [ex, -1.75, 3.3], chord0: 3.6, chord1: 3.0, thick: 0.9, up: [1, 0, 0], color: WHITE });                              // pylon
      if (withGear) { tube(b, [side * 2.6, -1.4, -0.5], [side * 2.7, -3.0, -0.8], 0.16, 0.14, GREY, 8); wheel(b, [side * 2.7, -3.25, -0.8], 0.55, 0.55, DARK); }   // main gear
    }
    wing(b, { le0: [0, 1.5, -10.6], le1: [0, 8.0, -16.2], chord0: 6.6, chord1: 2.6, thick: 0.75, up: [1, 0, 0], color: body });                                 // fin
    for (const side of [1, -1]) for (let i = 0; i < 4; i++) wing(b, { le0: [side * 0.24, 2.4 + i * 0.35, -11.6 - i * 0.6], le1: [side * 0.24, 6.6 + i * 0.3, -15.8 - i * 0.2], chord0: 0.55, chord1: 0.3, thick: 0.25, up: [1, 0, 0], color: leaf });   // brushwing strokes
    if (withGear) { tube(b, [0, -1.6, 13], [0, -3.1, 13], 0.12, 0.1, GREY, 8); wheel(b, [0, -3.45, 13], 0.35, 0.5, DARK); }   // nose gear
    return b.data;
  }

  // A fighter-style jet: 15 m long, 9.6 m span, swept wings, twin fins, bubble canopy and side intakes.
  function jet(body, accent, withGear = true) {
    const b = new Builder();
    const sections = [[7.6, .05, .05, .1], [7.0, .26, .22, .1], [5.6, .5, .44, .15], [3.6, .75, .68, .2], [0.5, .9, .82, .2], [-4, .95, .78, .2], [-6.8, .85, .7, .15], [-7.5, .68, .58, .15]];
    fuselage(b, sections.map(([zz, rx, ry, cy]) => ({ z: zz, rx, ry, cy })), 20, (i, j) => { const t = 2 * Math.PI * j / 20; return i >= 7 ? DARK : (Math.sin(t) < -0.5 && i > 1 ? [0.55, 0.58, 0.64] : [0.62, 0.65, 0.7]); }, { end: DARK });
    ellipsoid(b, [0, 0.95, 3.4], 0.5, 0.5, 1.7, [0.12, 0.2, 0.3], 14, 10);                                                                               // canopy
    tube(b, [0, 0.2, -7.4], [0, 0.2, -8.1], 0.62, 0.52, accent, 16);                                                                                        // afterburner ring
    for (const side of [1, -1]) {
      wing(b, { le0: [0, 0.05, 1.2], le1: [side * 4.8, 0.2, -3.2], chord0: 5.2, chord1: 1.4, thick: 0.6, color: [0.62, 0.65, 0.7] });
      wing(b, { le0: [0, 0.1, -4.4], le1: [side * 3.6, 0.15, -6.9], chord0: 3.0, chord1: 1.1, thick: 0.5, color: [0.62, 0.65, 0.7] });
      wing(b, { le0: [side * 1.0, 0.7, -3.4], le1: [side * 1.35, 3.5, -6.5], chord0: 3.4, chord1: 1.5, thick: 0.6, up: [1, 0, 0], color: body });
      fuselage(b, [{ z: 4.4, rx: .55, ry: .6, cx: side * 1.15, cy: -0.2 }, { z: 4.2, rx: .66, ry: .7, cx: side * 1.15, cy: -0.2 }, { z: 1.5, rx: .75, ry: .78, cx: side * 1.1, cy: -0.1 }, { z: -1.5, rx: .6, ry: .62, cx: side * 1.0, cy: 0 }], 14, (i) => i === 0 ? DARK : [0.58, 0.61, 0.67], { start: DARK });
      if (withGear) { tube(b, [side * 0.8, -0.2, -0.6], [side * 1.05, -1.1, -0.6], 0.07, 0.06, GREY, 6); wheel(b, [side * 1.05, -1.3, -0.6], 0.3, 0.2, DARK); }
    }
    if (withGear) { tube(b, [0, -0.4, 4.4], [0, -1.2, 4.5], 0.06, 0.05, GREY, 6); wheel(b, [0, -1.4, 4.5], 0.25, 0.16, DARK); }
    return b.data;
  }

  // A minimal FPV drone in real size (about 0.2 m across): a small grey body, four thin arms with a motor each, a camera at the nose and no
  // prop guards. The rotors are a separate translucent part (see PROPELLERS) that spins; the body is grey whatever colour the pilot has,
  // with a small LED in the pilot's colour.
  const DUCTS = [[0.085, 0.085], [-0.085, 0.085], [0.085, -0.085], [-0.085, -0.085]];   // where the four rotors are
  function drone(body, accent) {
    const b = new Builder(), grey = [0.52, 0.54, 0.58], dark = [0.24, 0.25, 0.28];
    ellipsoid(b, [0, 0, 0], 0.034, 0.017, 0.062, grey, 14, 8);                               // body
    ellipsoid(b, [0, 0.004, -0.05], 0.028, 0.02, 0.034, dark, 12, 6);                        // battery
    ellipsoid(b, [0, -0.003, 0.06], 0.017, 0.015, 0.02, dark, 10, 6);                        // camera
    ellipsoid(b, [0, 0, 0.078], 0.008, 0.008, 0.005, [0.15, 0.3, 0.55], 8, 4);               // lens
    ellipsoid(b, [0, 0.02, -0.06], 0.005, 0.003, 0.009, accent, 8, 4);                       // LED in the pilot's colour
    for (const [x, z] of DUCTS) {
      tube(b, [x * 0.2, 0, z * 0.2], [x, 0.006, z], 0.006, 0.005, grey, 6);                  // arm
      tube(b, [x, 0.0, z], [x, 0.014, z], 0.01, 0.01, dark, 10);                             // motor
    }
    return b.data;
  }
  // One rotor, drawn at the origin: two thin blades (no disc: the spinning blades are enough). The page draws it four times, translucent and spinning.
  function droneRotor() {
    const b = new Builder();
    ellipsoid(b, [0, 0, 0], 0.05, 0.0012, 0.0055, [0.2, 0.21, 0.23], 10, 6); ellipsoid(b, [0, 0, 0], 0.0055, 0.0012, 0.05, [0.2, 0.21, 0.23], 10, 6);
    return b.data;
  }

  // Spinning parts: the geometry (at the origin), where each copy sits, which axis it turns about, and how see-through it is.
  const PROPELLERS = {
    plane: { build: cessnaPropeller, alpha: 1, rotors: [{ pivot: [0, -0.1, 3.8], axis: 'z', dir: 1 }] },
    drone: { build: droneRotor, alpha: 0.4, rotors: DUCTS.map(([x, z], i) => ({ pivot: [x, 0.016, z], axis: 'y', dir: i % 2 ? -1 : 1 })) }
  };
  const MODELS = { plane: cessna, airbus, jet, drone };
  // `withGear` false leaves the retractable gear out (the page draws it separately, folding it up and down); the Cessna's gear is fixed.
  function build(model, body, accent, withGear = true) { return new Float32Array((MODELS[model] || cessna)(body, accent, withGear)); }
  // The gear that can retract: its geometry in the model's own place and the height it folds up to.
  const GEARS = { airbus: { fold: -1.3 }, jet: { fold: -0.2 } };
  function gearPart(model, body = [1, 0, 0], accent = [0, 0, 1]) {
    if (!GEARS[model]) return null;
    const all = MODELS[model](body, accent, true), bare = MODELS[model](body, accent, false), key = (data, i) => data.slice(i, i + 9).join(',');
    const have = new Set(); for (let i = 0; i < bare.length; i += 9) have.add(key(bare, i));
    const out = []; for (let i = 0; i < all.length; i += 9) if (!have.has(key(all, i))) for (let k = 0; k < 9; k++) out.push(all[i + k]);
    return { data: new Float32Array(out), fold: GEARS[model].fold };
  }
  // The size of a model: [width, height, length] in model units.
  function extent(data) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.length; i += 9) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], data[i + k]); hi[k] = Math.max(hi[k], data[i + k]); }
    return { min: lo, max: hi, size: hi.map((v, k) => v - lo[k]) };
  }
  // Navigation lights of each vehicle (model coordinates): red on the left wingtip, green on the right, white at the tail, a white strobe and a
  // red beacon. [position, colour, period, offset, duty, size in metres]; period 0 is steady.
  const NAV_RED = [1, 0.1, 0.08], NAV_GREEN = [0.15, 1, 0.3], NAV_WHITE = [1, 0.97, 0.9];
  const NAV = {
    plane: [[[-5.5, 1.12, 0.7], NAV_RED, 0, 0, 1, 0.35], [[5.5, 1.12, 0.7], NAV_GREEN, 0, 0, 1, 0.35], [[0, 1.2, -4.4], NAV_WHITE, 0, 0, 1, 0.3], [[0, 1.98, -3.8], NAV_WHITE, 1.4, 0, 0.07, 0.6], [[0, 0.95, 0.2], NAV_RED, 1.2, 0.4, 0.45, 0.4]],
    airbus: [[[-17.9, 1.6, -4.4], NAV_RED, 0, 0, 1, 0.7], [[17.9, 1.6, -4.4], NAV_GREEN, 0, 0, 1, 0.7], [[0, 1.2, -18.8], NAV_WHITE, 0, 0, 1, 0.6], [[-17.8, -0.2, -5.4], NAV_WHITE, 1.1, 0, 0.06, 1.2], [[17.8, -0.2, -5.4], NAV_WHITE, 1.1, 0.5, 0.06, 1.2], [[0, 2.1, 3], NAV_RED, 1.3, 0, 0.45, 0.8], [[0, -2.1, 3], NAV_RED, 1.3, 0.6, 0.45, 0.8], [[-4.5, -1.2, 2.5], NAV_WHITE, 0, 0, 1, 0.9], [[4.5, -1.2, 2.5], NAV_WHITE, 0, 0, 1, 0.9]],
    jet: [[[-4.8, 0.2, -3.2], NAV_RED, 0, 0, 1, 0.4], [[4.8, 0.2, -3.2], NAV_GREEN, 0, 0, 1, 0.4], [[0, 0.3, -7.6], [1, 0.5, 0.15], 0, 0, 1, 1.4], [[0, 3.4, -6.5], NAV_WHITE, 1.2, 0, 0.07, 0.6]],
    drone: [[[-0.085, 0.02, 0.085], NAV_RED, 0, 0, 1, 0.025], [[0.085, 0.02, 0.085], NAV_GREEN, 0, 0, 1, 0.025], [[0, 0.025, -0.07], NAV_WHITE, 0.9, 0, 0.12, 0.04]]
  };
  const navLights = model => NAV[model] || NAV.plane;

  // Flaps, drawn on the wing: slotted Fowler panels that slide back and tilt down at the trailing edge as the flaps are lowered. Each panel is
  // a unit slab (1 long along +x, 1 deep along -z, hinged along its front edge) that the renderer places, stretches and turns about its hinge.
  // The angles are the deflection at each flap notch (the Cessna's 0, 10, 20 and 30 degrees; the Airbus's UP, 1, 2, 3 and FULL).
  const lerp = (a, b, t) => a + (b - a) * t;
  function flapPanels(wingAt, ranges, depth) {          // wingAt(t) -> { y, zLeading, chord } for t = fraction of the half span
    const panels = [];
    for (const side of [1, -1]) for (const [t1, t2] of ranges) {
      const a = wingAt(t1), b = wingAt(t2), hinge = w => ({ y: w.y - 0.02, z: w.zLeading - 0.74 * w.chord }), ha = hinge(a), hb = hinge(b);
      const half = [side * a.x, side * b.x], lo = half[0] < half[1] ? 0 : 1, p = [[side * a.x, ha.y, ha.z], [side * b.x, hb.y, hb.z]], from = p[lo], to = p[1 - lo];
      const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      panels.push({ origin: from, axis: [(to[0] - from[0]) / length, (to[1] - from[1]) / length, (to[2] - from[2]) / length], length, chord: depth * (a.chord + b.chord) / 2 });
    }
    return panels;
  }
  const FLAPS = {
    plane: { angles: [0, 10, 20, 30], panels: () => flapPanels(t => ({ x: 5.5 * t, y: 0.8 + 0.3 * t, zLeading: 1.0 - 0.3 * t, chord: 1.72 - 0.67 * t }), [[0.16, 0.6]], 0.3) },
    airbus: { angles: [0, 8, 15, 20, 35], panels: () => flapPanels(t => ({ x: 17.8 * t, y: -1.3 + 0.9 * t, zLeading: 3.4 - 7.0 * t, chord: 6.4 - 4.8 * t }), [[0.14, 0.46], [0.52, 0.86]], 0.32) }
  };
  function flapPart(model) {
    const spec = FLAPS[model]; if (!spec) return null;
    const b = new Builder(); wing(b, { le0: [0, 0, 0], le1: [1, 0, 0], chord0: 1, chord1: 1, thick: 1, color: [0.93, 0.94, 0.96] });
    return { data: new Float32Array(b.data), panels: spec.panels(), angles: spec.angles };
  }

  // The part of a model that spins: { data, rotors: [{ pivot, axis, dir }], alpha } or null. The Cessna's blades are modelled in place, so
  // its pivot is where they are; the drone's rotor is modelled at the origin and placed at each pivot.
  function propeller(model) { const part = PROPELLERS[model]; return part ? { data: new Float32Array(part.build()), rotors: part.rotors, alpha: part.alpha, atOrigin: model === 'drone' } : null; }
  return { build, flapPart, gearPart, propeller, navLights, extent, MODELS: Object.keys(MODELS) };
});

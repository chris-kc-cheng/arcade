// A small WebGL renderer for the flight simulator (no libraries). It draws one big static mesh (ground, water, runways, buildings),
// a gradient sky, and low-poly planes. Vertices are interleaved: position, normal and colour, nine floats each.
(function (root) {
  const VERTEX = `
    attribute vec3 aPos; attribute vec3 aNormal; attribute vec3 aColor;
    uniform mat4 uViewProj; uniform mat4 uModel; uniform mat3 uNormal;
    varying vec3 vNormal; varying vec3 vColor; varying vec3 vWorld;
    void main() { vec4 world = uModel * vec4(aPos, 1.0); vWorld = world.xyz; vNormal = uNormal * aNormal; vColor = aColor; gl_Position = uViewProj * world; }`;
  const FRAGMENT = `
    precision mediump float;
    varying vec3 vNormal; varying vec3 vColor; varying vec3 vWorld;
    uniform vec3 uSun; uniform vec3 uFog; uniform vec3 uCamera; uniform float uDensity; uniform float uAlpha; uniform float uNight; uniform float uWindows;
    void main() {
      vec3 n = normalize(vNormal); float diffuse = max(dot(n, uSun), 0.0); float sky = 0.5 + 0.5 * n.y;
      float day = 1.0 - 0.87 * uNight;                                  // at night only a little moonlight is left
      vec3 lit = vColor * (0.5 * sky + 0.62 * diffuse) * day + vColor * 0.03 * uNight;
      float d = distance(vWorld, uCamera);
      // Windows: on the walls of buildings, a grid of cells, some of them lit; far away they average out to a faint city glow.
      float wallMask = (1.0 - step(0.3, abs(n.y))) * uWindows * uNight;
      if (wallMask > 0.0) {
        vec2 uv = vec2(dot(vWorld.xz, vec2(-n.z, n.x)) / 3.4, vWorld.y / 3.2); vec2 cell = floor(uv); vec2 f = fract(uv);
        float h = fract(sin(dot(cell + floor(vWorld.xz / 50.0) * 7.0, vec2(12.9898, 78.233))) * 43758.5453);
        float rect = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.78);
        vec3 warm = mix(vec3(1.0, 0.8, 0.45), vec3(0.7, 0.85, 1.0), step(0.93, fract(h * 7.31)));
        lit += warm * wallMask * mix(step(0.6, h) * rect, 0.13, smoothstep(500.0, 2200.0, d)) * 0.95;
      }
      float fog = 1.0 - exp(-d * uDensity * d * uDensity * 0.6);
      gl_FragColor = vec4(mix(lit, uFog, clamp(fog, 0.0, 1.0)), uAlpha);
    }`;
  // Lights are round glowing points: position, colour and blinking (period, offset, duty, size in metres). Stars are the same at infinity.
  const LIGHT_VERTEX = `
    attribute vec3 aPos; attribute vec3 aColor; attribute vec4 aBlink;
    uniform mat4 uViewProj; uniform vec3 uCamera; uniform float uTime; uniform float uPx; uniform float uStars;
    varying vec3 vColor; varying float vOn;
    void main() {
      vec3 world = uStars > 0.5 ? uCamera + aPos * 30000.0 : aPos;
      float d = distance(world, uCamera);
      float on = aBlink.x > 0.0 ? step(fract((uTime + aBlink.y) / aBlink.x), aBlink.z) : 1.0;
      vOn = on * (uStars > 0.5 ? 1.0 : exp(-d * 0.00004)); vColor = aColor;
      gl_Position = uViewProj * vec4(world, 1.0);
      gl_PointSize = uStars > 0.5 ? aBlink.w : clamp(aBlink.w * uPx / max(d, 1.0), 2.5, 44.0);
    }`;
  const LIGHT_FRAGMENT = `
    precision mediump float; varying vec3 vColor; varying float vOn; uniform float uGain;
    void main() { float r = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(1.0 - r, 0.0), 1.6); if (vOn < 0.02 || a < 0.01) discard; gl_FragColor = vec4(vColor * (0.55 + a), a * vOn * uGain); }`;
  const SKY_VERTEX = 'attribute vec2 aPos; varying float vY; void main() { vY = aPos.y * 0.5 + 0.5; gl_Position = vec4(aPos, 0.999, 1.0); }';
  const SKY_FRAGMENT = 'precision mediump float; varying float vY; uniform vec3 uTop; uniform vec3 uHorizon; uniform float uHorizonLine; void main() { float t = clamp((vY - uHorizonLine) * 2.2, 0.0, 1.0); gl_FragColor = vec4(mix(uHorizon, uTop, pow(t, 0.7)), 1.0); }';

  // 4x4 column-major matrices.
  const mat = {
    identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    multiply(a, b) { const out = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; out[c * 4 + r] = s; } return out; },
    perspective(fov, aspect, near, far) { const f = 1 / Math.tan(fov / 2), m = new Float32Array(16); m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = 2 * far * near / (near - far); return m; },
    // View matrix from an eye, its forward and up vectors.
    look(eye, forward, up) {
      // The world is (east, up, north), which is left handed, so the camera's right vector is up x forward: east is on the right
      // when looking north. (The usual right-handed formula would mirror the whole picture.)
      const f = norm(forward), s = norm(cross(up, f)), u = cross(f, s), m = new Float32Array(16);
      m[0] = s[0]; m[4] = s[1]; m[8] = s[2]; m[1] = u[0]; m[5] = u[1]; m[9] = u[2]; m[2] = -f[0]; m[6] = -f[1]; m[10] = -f[2];
      m[12] = -dot(s, eye); m[13] = -dot(u, eye); m[14] = dot(f, eye); m[15] = 1; return m;
    },
    translate: (x, y, z) => { const m = mat.identity(); m[12] = x; m[13] = y; m[14] = z; return m; },
    rotateX: a => { const m = mat.identity(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; },
    rotateY: a => { const m = mat.identity(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; },
    rotateZ: a => { const m = mat.identity(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; },
    scale: (x, y, z) => { const m = mat.identity(); m[0] = x; m[5] = y; m[10] = z; return m; }
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

  function Renderer(canvas) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false }) || canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('WebGL is not available in this browser.');
    this.canvas = canvas; this.gl = gl;
    const program = (vs, fs) => {
      const compile = (type, source) => { const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)); return shader; };
      const p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p;
    };
    this.world = program(VERTEX, FRAGMENT); this.sky = program(SKY_VERTEX, SKY_FRAGMENT); this.lightProgram = program(LIGHT_VERTEX, LIGHT_FRAGMENT);
    this.uniforms = Object.fromEntries(['uViewProj', 'uModel', 'uNormal', 'uSun', 'uFog', 'uCamera', 'uDensity', 'uAlpha', 'uNight', 'uWindows'].map(name => [name, gl.getUniformLocation(this.world, name)]));
    this.skyUniforms = Object.fromEntries(['uTop', 'uHorizon', 'uHorizonLine'].map(name => [name, gl.getUniformLocation(this.sky, name)]));
    this.skyBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    this.lightUniforms = Object.fromEntries(['uViewProj', 'uCamera', 'uTime', 'uPx', 'uStars', 'uGain'].map(name => [name, gl.getUniformLocation(this.lightProgram, name)]));
    this.home = null; this.tiles = new Map(); this.dayFog = [0.72, 0.8, 0.88]; this.nightFog = [0.025, 0.04, 0.09]; this.fog = [...this.dayFog]; this.sun = norm([0.45, 0.8, 0.35]);
    this.nightTarget = 0; this.nightLevel = 0; this.lastTime = null; this.lights = new Map(); this.dynamicLights = null; this.dynamicBuffer = gl.createBuffer();
    { const stars = [], seed = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();   // 600 fixed stars on a far sphere
      for (let i = 0; i < 600; i++) { const y = 0.03 + 0.97 * seed(), t = 2 * Math.PI * seed(), r = Math.sqrt(1 - y * y), tint = 0.75 + 0.25 * seed(); stars.push(r * Math.cos(t), y, r * Math.sin(t), tint, tint, 1, 0, 0, 1, 1.4 + 2 * seed() * seed()); }
      this.starBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(stars), gl.STATIC_DRAW); this.starCount = 600; }
    gl.enable(gl.DEPTH_TEST); gl.clearColor(...this.fog, 1);
    this.planeCache = new Map();
  }
  // Map pieces are two buffers each: flat ground (painted in order, no depth test, so layers never flicker) and solids (buildings).
  const upload = (gl, data) => { if (!data.length) return null; const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return { buffer, count: data.length / 9 }; };
  const release = (gl, piece) => { if (piece) { if (piece.ground) gl.deleteBuffer(piece.ground.buffer); if (piece.solid) gl.deleteBuffer(piece.solid.buffer); } };
  // `base` is the land everywhere, drawn before any streamed tile so it can never cover the sea of a tile.
  Renderer.prototype.setScene = function (ground, solid, base) { release(this.gl, this.home); if (this.base) this.gl.deleteBuffer(this.base.buffer); this.base = base ? upload(this.gl, base) : null; this.home = { ground: upload(this.gl, ground), solid: upload(this.gl, solid) }; };
  // Streamed map tiles (more ground and buildings as the plane flies on) come and go.
  Renderer.prototype.setTile = function (key, ground, solid) { this.removeTile(key); this.tiles.set(key, { ground: upload(this.gl, ground), solid: upload(this.gl, solid) }); };
  Renderer.prototype.removeTile = function (key) { release(this.gl, this.tiles.get(key)); this.tiles.delete(key); };
  Renderer.prototype.clearTiles = function () { for (const key of [...this.tiles.keys()]) this.removeTile(key); };
  // Night: the sky, haze and ground darken, building windows light up, and lights glow. `setNight` fades it in or out.
  Renderer.prototype.setNight = function (on) { this.nightTarget = on ? 1 : 0; };
  // Static lights of one piece of map (airport lights, obstruction lights on towers): 10 floats per light, see LIGHT_VERTEX.
  Renderer.prototype.setLights = function (key, data) {
    const gl = this.gl; this.removeLights(key); if (!data || !data.length) return;
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); this.lights.set(key, { buffer, count: data.length / 10 });
  };
  Renderer.prototype.removeLights = function (key) { const entry = this.lights.get(key); if (entry) { this.gl.deleteBuffer(entry.buffer); this.lights.delete(key); } };
  Renderer.prototype.clearLights = function () { for (const key of [...this.lights.keys()]) this.removeLights(key); this.dynamicLights = null; };
  // Lights that change every frame (aircraft lights, the PAPI): replaced as a whole.
  Renderer.prototype.setDynamicLights = function (data) { this.dynamicLights = data && data.length ? data : null; };
  Renderer.prototype.drawLights = function (viewProj, camera, time, aspectHeight) {
    const gl = this.gl, u = this.lightUniforms; gl.useProgram(this.lightProgram);
    gl.uniformMatrix4fv(u.uViewProj, false, viewProj); gl.uniform3fv(u.uCamera, camera.position); gl.uniform1f(u.uTime, time); gl.uniform1f(u.uPx, aspectHeight / (2 * Math.tan((camera.fov || 1) / 2))); gl.uniform1f(u.uGain, Math.min(1, this.nightLevel * 1.2));
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false);
    const draw = (buffer, count, stars) => {
      gl.uniform1f(u.uStars, stars ? 1 : 0); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (const [name, size, offset] of [['aPos', 3, 0], ['aColor', 3, 12], ['aBlink', 4, 24]]) { const at = gl.getAttribLocation(this.lightProgram, name); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, size, gl.FLOAT, false, 40, offset); }
      gl.drawArrays(gl.POINTS, 0, count);
    };
    draw(this.starBuffer, this.starCount, true);
    for (const entry of this.lights.values()) draw(entry.buffer, entry.count, false);
    if (this.dynamicLights) { gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicBuffer); gl.bufferData(gl.ARRAY_BUFFER, this.dynamicLights, gl.DYNAMIC_DRAW); draw(this.dynamicBuffer, this.dynamicLights.length / 10, false); }
    gl.depthMask(true); gl.disable(gl.BLEND);
  };
  Renderer.prototype.resize = function () {
    const ratio = Math.min(2, window.devicePixelRatio || 1), w = Math.max(2, Math.floor(this.canvas.clientWidth * ratio)), h = Math.max(2, Math.floor(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.gl.viewport(0, 0, w, h); return w / h;
  };
  // Vertex data for one plane colour scheme, built once.
  Renderer.prototype.planeBuffer = function (key, body, accent, model) {
    if (this.planeCache.has(key)) return this.planeCache.get(key);
    const gl = this.gl, data = FlightModels.build(model || 'plane', body, accent);   // smooth lofted models: see flight-models.js
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const entry = { buffer, count: data.length / 9, prop: null }, prop = FlightModels.propeller(model || 'plane');
    if (prop) { const propBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, propBuffer); gl.bufferData(gl.ARRAY_BUFFER, prop.data, gl.STATIC_DRAW); entry.prop = { buffer: propBuffer, count: prop.data.length / 9, rotors: prop.rotors, alpha: prop.alpha, atOrigin: prop.atOrigin }; }
    this.planeCache.set(key, entry); return entry;
  };
  // Draw a model's rotors: one copy per pivot, turned about its axis (alternate directions on the drone).
  Renderer.prototype.drawRotors = function (entry, plane, model, rotation, alpha) {
    const gl = this.gl, prop = entry.prop; gl.uniform1f(this.uniforms.uAlpha, alpha); this.bindAttributes(prop.buffer);
    for (const rotor of prop.rotors) {
      const [px, py, pz] = rotor.pivot, angle = (plane.spin || 0) * rotor.dir, turn = rotor.axis === 'y' ? mat.rotateY(angle) : mat.rotateZ(angle);
      const place = prop.atOrigin ? mat.multiply(mat.translate(px, py, pz), turn) : mat.multiply(mat.translate(px, py, pz), mat.multiply(turn, mat.translate(-px, -py, -pz)));
      const r = mat.multiply(rotation, turn);
      gl.uniformMatrix4fv(this.uniforms.uModel, false, mat.multiply(model, place));
      gl.uniformMatrix3fv(this.uniforms.uNormal, false, new Float32Array([r[0], r[1], r[2], r[4], r[5], r[6], r[8], r[9], r[10]]));
      gl.drawArrays(gl.TRIANGLES, 0, prop.count);
    }
  };
  Renderer.prototype.bindAttributes = function (buffer) {
    const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (const [name, size, offset] of [['aPos', 3, 0], ['aNormal', 3, 12], ['aColor', 3, 24]]) { const at = gl.getAttribLocation(this.world, name); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, size, gl.FLOAT, false, 36, offset); }
  };
  // camera: { position: [x, y, z], forward: [x, y, z], up: [x, y, z], fov }. planes: [{ x, y, z, heading, pitch, roll, body, accent }].
  Renderer.prototype.draw = function (camera, planes, options = {}) {
    const gl = this.gl, aspect = this.resize(), altitude = Math.max(0, camera.position[1]);
    // The haze thins and the sky gets darker with height; more fog on a hazy day.
    const time = options.time ?? performance.now() / 1000, step = this.lastTime === null ? 1 : Math.min(0.2, Math.max(0, time - this.lastTime)); this.lastTime = time;
    this.nightLevel += (this.nightTarget - this.nightLevel) * Math.min(1, step * 2.5); if (Math.abs(this.nightTarget - this.nightLevel) < 0.002) this.nightLevel = this.nightTarget;
    const night = this.nightLevel; this.fog = this.dayFog.map((v, i) => v + (this.nightFog[i] - v) * night);
    const day = [0.22 - Math.min(0.1, altitude / 9000), 0.44 - Math.min(0.2, altitude / 9000), 0.78], nightTop = [0.008, 0.016, 0.06];
    const horizon = this.fog, top = day.map((v, i) => v + (nightTop[i] - v) * night), density = options.fog ?? 0.00011;
    gl.clearColor(horizon[0], horizon[1], horizon[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // Sky: a gradient behind everything, with the horizon line following the camera's pitch.
    const pitchUp = Math.asin(Math.max(-1, Math.min(1, camera.forward[1]))), horizonLine = 0.5 - 0.5 * Math.tan(Math.max(-1.4, Math.min(1.4, pitchUp))) / Math.tan((camera.fov || 1) / 2);
    gl.disable(gl.DEPTH_TEST); gl.useProgram(this.sky);
    gl.uniform3fv(this.skyUniforms.uTop, top); gl.uniform3fv(this.skyUniforms.uHorizon, horizon); gl.uniform1f(this.skyUniforms.uHorizonLine, horizonLine);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuffer); const sa = gl.getAttribLocation(this.sky, 'aPos'); gl.enableVertexAttribArray(sa); gl.vertexAttribPointer(sa, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.enable(gl.DEPTH_TEST); gl.useProgram(this.world);
    const view = mat.look(camera.position, camera.forward, camera.up), viewProj = mat.multiply(mat.perspective(camera.fov || 1, aspect, camera.near ?? Math.min(12, 3 + altitude * 0.04), 50000), view);
    gl.uniformMatrix4fv(this.uniforms.uViewProj, false, viewProj); gl.uniform3fv(this.uniforms.uSun, this.sun); gl.uniform3fv(this.uniforms.uFog, this.fog); gl.uniform1f(this.uniforms.uNight, night); gl.uniform1f(this.uniforms.uWindows, 1); gl.uniform3fv(this.uniforms.uCamera, camera.position); gl.uniform1f(this.uniforms.uDensity, density);
    const identity = mat.identity(), normalIdentity = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const pieces = [...this.tiles.values(), ...(this.home ? [this.home] : [])];   // the first region last, so the airport lies on top
    gl.uniformMatrix4fv(this.uniforms.uModel, false, identity); gl.uniformMatrix3fv(this.uniforms.uNormal, false, normalIdentity);
    gl.disable(gl.DEPTH_TEST); if (this.base) { this.bindAttributes(this.base.buffer); gl.drawArrays(gl.TRIANGLES, 0, this.base.count); }
    for (const piece of pieces) if (piece.ground) { this.bindAttributes(piece.ground.buffer); gl.drawArrays(gl.TRIANGLES, 0, piece.ground.count); }
    gl.enable(gl.DEPTH_TEST); for (const piece of pieces) if (piece.solid) { this.bindAttributes(piece.solid.buffer); gl.drawArrays(gl.TRIANGLES, 0, piece.solid.count); }
    const see = [];
    gl.uniform1f(this.uniforms.uAlpha, 1); gl.uniform1f(this.uniforms.uWindows, 0);   // aircraft have no building windows
    for (const plane of planes) {
      const entry = this.planeBuffer(`${plane.model || 'plane'}|${plane.body}|${plane.accent}`, plane.body, plane.accent, plane.model);
      // Heading about the vertical, then the nose up by the pitch, then roll about the nose (positive roll is right wing down).
      // A jet carries its full orientation (so loops and inverted flight draw right); the others are drawn from the three angles.
      let rotation = mat.multiply(mat.rotateY(plane.heading), mat.multiply(mat.rotateX(-plane.pitch), mat.rotateZ(-plane.roll)));
      if (plane.axes) { rotation = mat.identity(); rotation.set([...plane.axes.r, 0, ...plane.axes.u, 0, ...plane.axes.f, 0], 0); }
      const model = mat.multiply(mat.translate(plane.x, plane.y + (plane.baseY ?? 1.1), plane.z), mat.multiply(rotation, mat.scale(plane.scale || 1, plane.scale || 1, plane.scale || 1)));
      gl.uniformMatrix4fv(this.uniforms.uModel, false, model);
      gl.uniformMatrix3fv(this.uniforms.uNormal, false, new Float32Array([rotation[0], rotation[1], rotation[2], rotation[4], rotation[5], rotation[6], rotation[8], rotation[9], rotation[10]]));
      this.bindAttributes(entry.buffer); gl.drawArrays(gl.TRIANGLES, 0, entry.count);
      if (entry.prop) {   // rotors turn about their own axis; `spin` is the angle in radians. See-through ones are drawn after everything else.
        if (entry.prop.alpha < 1) { see.push({ entry, plane, model, rotation }); continue; }
        this.drawRotors(entry, plane, model, rotation, 1);
      }
    }
    if (see.length) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      for (const { entry, plane, model, rotation } of see) this.drawRotors(entry, plane, model, rotation, entry.prop.alpha);
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    gl.uniform1f(this.uniforms.uAlpha, 1);
    if (night > 0.01) this.drawLights(viewProj, camera, time, this.canvas.height);
    return viewProj;
  };
  // World point to canvas CSS pixels, for name tags; null when behind the camera.
  Renderer.prototype.project = function (viewProj, x, y, z) {
    const w = viewProj[3] * x + viewProj[7] * y + viewProj[11] * z + viewProj[15]; if (w <= 0) return null;
    const cx = (viewProj[0] * x + viewProj[4] * y + viewProj[8] * z + viewProj[12]) / w, cy = (viewProj[1] * x + viewProj[5] * y + viewProj[9] * z + viewProj[13]) / w;
    return [(cx * 0.5 + 0.5) * this.canvas.clientWidth, (1 - (cy * 0.5 + 0.5)) * this.canvas.clientHeight, w];
  };
  root.FlightRender = { Renderer, mat, norm, cross, dot };
})(typeof self !== 'undefined' ? self : this);

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
    uniform vec3 uSun; uniform vec3 uFog; uniform vec3 uCamera; uniform float uDensity;
    void main() {
      vec3 n = normalize(vNormal); float diffuse = max(dot(n, uSun), 0.0); float sky = 0.5 + 0.5 * n.y;
      vec3 lit = vColor * (0.5 * sky + 0.62 * diffuse);
      float d = distance(vWorld, uCamera); float fog = 1.0 - exp(-d * uDensity * d * uDensity * 0.6);
      gl_FragColor = vec4(mix(lit, uFog, clamp(fog, 0.0, 1.0)), 1.0);
    }`;
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
    this.world = program(VERTEX, FRAGMENT); this.sky = program(SKY_VERTEX, SKY_FRAGMENT);
    this.uniforms = Object.fromEntries(['uViewProj', 'uModel', 'uNormal', 'uSun', 'uFog', 'uCamera', 'uDensity'].map(name => [name, gl.getUniformLocation(this.world, name)]));
    this.skyUniforms = Object.fromEntries(['uTop', 'uHorizon', 'uHorizonLine'].map(name => [name, gl.getUniformLocation(this.sky, name)]));
    this.skyBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    this.home = null; this.tiles = new Map(); this.fog = [0.72, 0.8, 0.88]; this.sun = norm([0.45, 0.8, 0.35]);
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
    if (prop) { const propBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, propBuffer); gl.bufferData(gl.ARRAY_BUFFER, prop.data, gl.STATIC_DRAW); entry.prop = { buffer: propBuffer, count: prop.data.length / 9, pivot: prop.pivot }; }
    this.planeCache.set(key, entry); return entry;
  };
  Renderer.prototype.bindAttributes = function (buffer) {
    const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (const [name, size, offset] of [['aPos', 3, 0], ['aNormal', 3, 12], ['aColor', 3, 24]]) { const at = gl.getAttribLocation(this.world, name); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, size, gl.FLOAT, false, 36, offset); }
  };
  // camera: { position: [x, y, z], forward: [x, y, z], up: [x, y, z], fov }. planes: [{ x, y, z, heading, pitch, roll, body, accent }].
  Renderer.prototype.draw = function (camera, planes, options = {}) {
    const gl = this.gl, aspect = this.resize(), altitude = Math.max(0, camera.position[1]);
    // The haze thins and the sky gets darker with height; more fog on a hazy day.
    const horizon = this.fog, top = [0.22 - Math.min(0.1, altitude / 9000), 0.44 - Math.min(0.2, altitude / 9000), 0.78], density = options.fog ?? 0.00011;
    gl.clearColor(horizon[0], horizon[1], horizon[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // Sky: a gradient behind everything, with the horizon line following the camera's pitch.
    const pitchUp = Math.asin(Math.max(-1, Math.min(1, camera.forward[1]))), horizonLine = 0.5 - 0.5 * Math.tan(Math.max(-1.4, Math.min(1.4, pitchUp))) / Math.tan((camera.fov || 1) / 2);
    gl.disable(gl.DEPTH_TEST); gl.useProgram(this.sky);
    gl.uniform3fv(this.skyUniforms.uTop, top); gl.uniform3fv(this.skyUniforms.uHorizon, horizon); gl.uniform1f(this.skyUniforms.uHorizonLine, horizonLine);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuffer); const sa = gl.getAttribLocation(this.sky, 'aPos'); gl.enableVertexAttribArray(sa); gl.vertexAttribPointer(sa, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.enable(gl.DEPTH_TEST); gl.useProgram(this.world);
    const view = mat.look(camera.position, camera.forward, camera.up), viewProj = mat.multiply(mat.perspective(camera.fov || 1, aspect, camera.near ?? Math.min(12, 3 + altitude * 0.04), 50000), view);
    gl.uniformMatrix4fv(this.uniforms.uViewProj, false, viewProj); gl.uniform3fv(this.uniforms.uSun, this.sun); gl.uniform3fv(this.uniforms.uFog, this.fog); gl.uniform3fv(this.uniforms.uCamera, camera.position); gl.uniform1f(this.uniforms.uDensity, density);
    const identity = mat.identity(), normalIdentity = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const pieces = [...this.tiles.values(), ...(this.home ? [this.home] : [])];   // the first region last, so the airport lies on top
    gl.uniformMatrix4fv(this.uniforms.uModel, false, identity); gl.uniformMatrix3fv(this.uniforms.uNormal, false, normalIdentity);
    gl.disable(gl.DEPTH_TEST); if (this.base) { this.bindAttributes(this.base.buffer); gl.drawArrays(gl.TRIANGLES, 0, this.base.count); }
    for (const piece of pieces) if (piece.ground) { this.bindAttributes(piece.ground.buffer); gl.drawArrays(gl.TRIANGLES, 0, piece.ground.count); }
    gl.enable(gl.DEPTH_TEST); for (const piece of pieces) if (piece.solid) { this.bindAttributes(piece.solid.buffer); gl.drawArrays(gl.TRIANGLES, 0, piece.solid.count); }
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
      if (entry.prop) {   // the propeller turns about the nose axis; `spin` is its angle in radians
        const [px, py, pz] = entry.prop.pivot, turn = mat.rotateZ(plane.spin || 0), spun = mat.multiply(model, mat.multiply(mat.translate(px, py, pz), mat.multiply(turn, mat.translate(-px, -py, -pz)))), r = mat.multiply(rotation, turn);
        gl.uniformMatrix4fv(this.uniforms.uModel, false, spun);
        gl.uniformMatrix3fv(this.uniforms.uNormal, false, new Float32Array([r[0], r[1], r[2], r[4], r[5], r[6], r[8], r[9], r[10]]));
        this.bindAttributes(entry.prop.buffer); gl.drawArrays(gl.TRIANGLES, 0, entry.prop.count);
      }
    }
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

// Minimal WebGL equirectangular panorama viewer with touch drag + pinch zoom.
const VS = `attribute vec2 p; varying vec2 uv; void main(){ uv=p; gl_Position=vec4(p,0.,1.); }`;
const FS = `precision highp float;
uniform sampler2D tex; uniform float yaw, pitch, tanHalf, aspect;
varying vec2 uv;
const float PI = 3.14159265359;
void main(){
  vec3 d = normalize(vec3(uv.x*tanHalf*aspect, uv.y*tanHalf, 1.0));
  float cp=cos(pitch), sp=sin(pitch);
  d = vec3(d.x, d.y*cp + d.z*sp, -d.y*sp + d.z*cp);
  float cy=cos(yaw), sy=sin(yaw);
  d = vec3(d.x*cy + d.z*sy, d.y, -d.x*sy + d.z*cy);
  float lon = atan(d.x, d.z);
  float lat = asin(clamp(d.y,-1.0,1.0));
  gl_FragColor = texture2D(tex, vec2(lon/(2.0*PI)+0.5, 0.5 - lat/PI));
}`;

export class PanoViewer {
  constructor(canvas, onChange) {
    this.canvas = canvas;
    this.onChange = onChange || (() => {});
    this.yaw = 0; // radians, relative to image centre
    this.pitch = 0;
    this.fov = 1.6; // vertical-ish fov in radians
    const gl = (this.gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false }));
    if (!gl) throw new Error('WebGL not available');
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    this.u = {};
    for (const n of ['yaw', 'pitch', 'tanHalf', 'aspect', 'tex']) this.u[n] = gl.getUniformLocation(prog, n);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.texture = gl.createTexture();
    this._bindInput();
    this._resizeObs = new ResizeObserver(() => this.draw());
    this._resizeObs.observe(canvas);
  }

  async setImage(blob) {
    const bmp = await createImageBitmap(blob);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, bmp);
    const pot = (n) => (n & (n - 1)) === 0;
    if (pot(bmp.width) && pot(bmp.height)) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    bmp.close && bmp.close();
    this.draw();
  }

  draw() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const gl = this.gl;
    gl.viewport(0, 0, w, h);
    gl.uniform1f(this.u.yaw, this.yaw);
    gl.uniform1f(this.u.pitch, this.pitch);
    gl.uniform1f(this.u.tanHalf, Math.tan(this.fov / 2));
    gl.uniform1f(this.u.aspect, w / h);
    gl.uniform1i(this.u.tex, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.onChange(this);
  }

  _bindInput() {
    const c = this.canvas;
    const pts = new Map();
    let pinchStart = null;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: this.fov };
      }
    });
    c.addEventListener('pointermove', (e) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pts.set(e.pointerId, cur);
      if (pts.size === 1) {
        const k = (2 * Math.tan(this.fov / 2)) / c.clientHeight; // radians per pixel (approx)
        this.yaw -= (cur.x - prev.x) * k;
        this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + (cur.y - prev.y) * k));
        this.draw();
      } else if (pts.size === 2 && pinchStart) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.setFov(pinchStart.fov * (pinchStart.d / d));
      }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinchStart = null; };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.setFov(this.fov * Math.exp(e.deltaY * 0.001)); }, { passive: false });
  }

  setFov(f) { this.fov = Math.max(0.35, Math.min(2.0, f)); this.draw(); }
}

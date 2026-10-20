// WebGL post-process. R.frame draws the world into an offscreen 2D canvas; this uploads it as a texture and renders
// bloom (1/4 res, 2 separable blur iterations), a per-biome colour grade, vignette, film grain and FX-driven chromatic
// aberration to a WebGL canvas that sits beneath the transparent HUD canvas. Any failure leaves Post.ready false and
// Render falls back to the plain 2D path.
(function (ED) {
  'use strict';
  const U = ED.U;
  const Post = ED.Post = { ready: false, wanted: false, canvas: null, lost: false, error: '', ms: 0, frames: 0 };
  const syncBuf = new Uint8Array(4);
  let gl = null, glc = null, quad = null, tex = null, texW = 0, texH = 0, fb = [], qW = 1, qH = 1, P = {};
  const grades = {};

  const VS = 'attribute vec2 a;varying vec2 uv;void main(){uv=a*.5+.5;gl_Position=vec4(a,0.,1.);}';
  const HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\nvarying vec2 uv;\n';
  // 4x4 box downsample of the world, keeping only what exceeds the soft threshold
  const FS_BRIGHT = HEAD + `uniform sampler2D tex;uniform vec2 texel;uniform vec2 thr;
vec3 s(vec2 o){return texture2D(tex,vec2(uv.x,1.-uv.y)+o*texel).rgb;}
void main(){
  vec3 c=(s(vec2(-1.,-1.))+s(vec2(1.,-1.))+s(vec2(-1.,1.))+s(vec2(1.,1.)))*.25;
  float b=max(c.r,max(c.g,c.b));
  float rq=clamp(b-thr.x+thr.y,0.,2.*thr.y);rq=rq*rq/(4.*thr.y+1e-4);
  float w=max(rq,b-thr.x)/max(b,1e-4);
  gl_FragColor=vec4(c*w,1.);
}`;
  const FS_BLUR = HEAD + `uniform sampler2D tex;uniform vec2 dir;
void main(){
  vec3 c=texture2D(tex,uv).rgb*.227027;
  c+=(texture2D(tex,uv+dir*1.3846).rgb+texture2D(tex,uv-dir*1.3846).rgb)*.3162162;
  c+=(texture2D(tex,uv+dir*3.2308).rgb+texture2D(tex,uv-dir*3.2308).rgb)*.0702703;
  gl_FragColor=vec4(c,1.);
}`;
  const FS_COMP = HEAD + `uniform sampler2D tex;uniform sampler2D bloom;
uniform vec2 res;uniform float time,aberr,bloomK,gamma,sat,contrast,grain;
uniform vec3 lift,gain,shadowT,highT;uniform vec2 vig;uniform vec4 flash;
float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
void main(){
  vec2 p=uv-.5;
  vec2 o=p*(aberr*(.35+dot(p,p)*3.));
  vec2 fu=vec2(uv.x,1.-uv.y),fo=vec2(o.x,-o.y);
  vec3 c=vec3(texture2D(tex,fu+fo).r,texture2D(tex,fu).g,texture2D(tex,fu-fo).b);
  c+=texture2D(bloom,uv).rgb*bloomK;
  c=c*gain+lift;
  float l=dot(c,vec3(.299,.587,.114));
  c=mix(vec3(l),c,sat);
  c+=shadowT*(1.-smoothstep(0.,.45,l))+highT*smoothstep(.45,1.,l);
  c=pow(max(c,0.),vec3(1./gamma));
  c=clamp(c,0.,1.);
  c=mix(c,c*c*(3.-2.*c),contrast);
  float d=length(p*vec2(res.x/res.y,1.));
  c*=1.-vig.x*smoothstep(vig.y,vig.y+.6,d);
  c+=flash.rgb*flash.a;
  c+=(hash(gl_FragCoord.xy+fract(time)*vec2(131.,71.))-.5)*grain;
  gl_FragColor=vec4(c,1.);
}`;

  function compile(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
    return s;
  }
  function program(fs, names) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const u = {}; for (const n of names) u[n] = gl.getUniformLocation(p, n);
    return { p, u };
  }
  function makeTex(w, h) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (w) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }

  function setup() {
    P = {
      bright: program(FS_BRIGHT, ['tex', 'texel', 'thr']),
      blur: program(FS_BLUR, ['tex', 'dir']),
      comp: program(FS_COMP, ['tex', 'bloom', 'res', 'time', 'aberr', 'bloomK', 'gamma', 'sat', 'contrast', 'grain', 'lift', 'gain', 'shadowT', 'highT', 'vig', 'flash']),
    };
    quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    tex = makeTex(0, 0); texW = texH = 0; fb = [];
    if (glc.width) allocate(glc.width, glc.height);
  }

  function allocate(w, h) {
    for (const f of fb) { gl.deleteFramebuffer(f.fbo); gl.deleteTexture(f.tex); }
    fb = [];
    qW = Math.max(1, Math.ceil(w / 4)); qH = Math.max(1, Math.ceil(h / 4));
    for (let i = 0; i < 2; i++) {
      const t = makeTex(qW, qH), f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      fb.push({ tex: t, fbo: f });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    texW = texH = 0;
  }

  // Creates the WebGL canvas right beneath `hud` (the visible 2D canvas). Returns true when post-processing is usable.
  Post.init = (hud) => {
    Post.wanted = true;
    if (glc) return Post.ready;
    try {
      glc = document.createElement('canvas'); glc.id = 'post'; glc.setAttribute('aria-hidden', 'true');
      glc.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:none;pointer-events:none';
      gl = glc.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
      if (!gl) throw new Error('webgl unavailable');
      hud.parentNode.insertBefore(glc, hud);
      Post.canvas = glc;
      glc.addEventListener('webglcontextlost', (e) => { e.preventDefault(); Post.ready = false; Post.lost = true; glc.style.display = 'none'; });
      glc.addEventListener('webglcontextrestored', () => {
        try { setup(); Post.lost = false; Post.ready = Post.wanted; glc.style.display = Post.ready ? 'block' : 'none'; } catch (err) { Post.fail(err); }
      });
      setup();
      Post.ready = true; glc.style.display = 'block';
    } catch (err) { Post.fail(err); }
    return Post.ready;
  };

  Post.fail = (err) => { Post.ready = false; Post.error = String(err && err.message || err); if (glc) glc.style.display = 'none'; };

  Post.resize = (w, h) => {
    if (!glc || !gl || gl.isContextLost()) return;
    if (glc.width === w && glc.height === h) return;
    glc.width = w; glc.height = h;
    try { allocate(w, h); } catch (err) { Post.fail(err); }
  };

  Post.setVisible = (v) => { Post.wanted = v; if (glc) glc.style.display = v && Post.ready ? 'block' : 'none'; };

  const rgb = (hex) => U.hexToRgb(hex).map(v => v / 255);
  const mixv = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  // Colour grade derived from the biome palette: tinted lift/gain, split toning, saturation and bloom threshold.
  const TWEAK = {
    ossuary: { sat: 1.08, gain: [1.03, 1.0, 0.98], bloom: 0.45, thr: 0.68 },
    glowmire: { sat: 1.16, gain: [0.98, 1.02, 1.04], bloom: 0.55, thr: 0.62 },
    rimefrost: { sat: 1.04, gain: [0.97, 1.0, 1.05], bloom: 0.34, thr: 0.84 },
    cinderforge: { sat: 1.06, gain: [1.03, 1.0, 0.96], bloom: 0.48, thr: 0.64 },
    sanctum: { sat: 1.12, gain: [0.97, 1.02, 1.02], bloom: 0.5, thr: 0.64 },
    abyss: { sat: 1.14, gain: [1.0, 0.97, 1.06], bloom: 0.6, thr: 0.58 },
  };
  Post.grade = (biome) => {
    if (grades[biome.id]) return grades[biome.id];
    const p = biome.pal, tw = TWEAK[biome.id] || {}, acc = rgb(p.accent), lt = rgb(p.light), cold = [0.35, 0.5, 1];
    const g = {
      lift: mixv([0.004, 0.005, 0.012], acc, 0.012),
      gain: tw.gain || [1.04, 1, 0.95],
      shadowT: mixv(cold, acc, 0.45).map(v => v * 0.05),
      highT: lt.map(v => v * 0.035),
      gamma: 1.1, sat: tw.sat || 1.15, contrast: 0.42, bloom: tw.bloom || 0.55, thr: tw.thr || 0.6, vig: 0.42,
    };
    grades[biome.id] = g;
    return g;
  };

  // o: { biome, t, aberr, flash:[r,g,b,a], lightLevel, bloom, vig, camp }
  Post.render = (src, o) => {
    if (!Post.ready || !gl) return false;
    if (gl.isContextLost()) { Post.ready = false; Post.lost = true; return false; }
    const t0 = performance.now();
    try {
      const w = glc.width, h = glc.height;
      if (src.width !== w || src.height !== h) return false;
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      if (texW !== w || texH !== h) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); texW = w; texH = h; }
      else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
      const g = Post.grade(o.biome), ll = o.lightLevel === undefined ? 1 : o.lightLevel;
      // bright pass -> blur x2 (ping-pong at 1/4 res)
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb[0].fbo); gl.viewport(0, 0, qW, qH);
      gl.useProgram(P.bright.p); gl.uniform1i(P.bright.u.tex, 0); gl.uniform2f(P.bright.u.texel, 1 / w, 1 / h); gl.uniform2f(P.bright.u.thr, g.thr, 0.22);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.useProgram(P.blur.p); gl.uniform1i(P.blur.u.tex, 0);
      for (let i = 0; i < 2; i++) {
        const k = i ? 1.7 : 1;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb[1].fbo); gl.bindTexture(gl.TEXTURE_2D, fb[0].tex); gl.uniform2f(P.blur.u.dir, k / qW, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb[0].fbo); gl.bindTexture(gl.TEXTURE_2D, fb[1].tex); gl.uniform2f(P.blur.u.dir, 0, k / qH); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      // composite
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fb[0].tex);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      const u = P.comp.u, f = o.flash || [0, 0, 0, 0];
      gl.useProgram(P.comp.p);
      gl.uniform1i(u.tex, 0); gl.uniform1i(u.bloom, 1); gl.uniform2f(u.res, w, h); gl.uniform1f(u.time, o.t || 0);
      gl.uniform1f(u.aberr, 0.0007 + (o.aberr || 0) * 0.003);
      gl.uniform1f(u.bloomK, (o.bloom !== undefined ? o.bloom : g.bloom) * (1.25 - 0.25 * ll));
      gl.uniform3fv(u.lift, g.lift); gl.uniform3fv(u.gain, g.gain); gl.uniform3fv(u.shadowT, g.shadowT); gl.uniform3fv(u.highT, g.highT);
      gl.uniform1f(u.gamma, g.gamma); gl.uniform1f(u.sat, g.sat * (0.72 + 0.28 * ll)); gl.uniform1f(u.contrast, g.contrast);
      gl.uniform1f(u.grain, 0.035);
      gl.uniform2f(u.vig, (o.vig !== undefined ? o.vig : g.vig) + (1 - ll) * 0.25, 0.28);
      gl.uniform4f(u.flash, f[0], f[1], f[2], f[3]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null); gl.activeTexture(gl.TEXTURE0);
      if (Post.sync) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncBuf); // benchmarking: block until the GPU is done
      Post.ms += performance.now() - t0; Post.frames++;
      return true;
    } catch (err) { Post.fail(err); return false; }
  };
})(globalThis.ED || (globalThis.ED = {}));

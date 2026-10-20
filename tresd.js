// Giro 3D do produto a partir de uma foto: a IA estima a profundidade de cada
// ponto (Depth Anything V2, roda no navegador) e a placa de vídeo desloca os
// pontos próximos mais que os distantes, como uma câmera girando em volta.
// Sem a IA (sem internet ou erro), usa uma profundidade calculada pelo formato
// da peça (mais alta no meio, mais baixa nas bordas).
const DEPTH_MODEL = 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx';
const ORT_DIR = new URL('./vendor/ort/', import.meta.url).href;
const SIDE = 518;            // lado do modelo (múltiplo de 14)
const PAD = 0.08;            // margem para a peça não sair do quadro ao girar

let depthSession = null;

async function cachedFetch(url, onStatus) {
  let cache = null;
  try { cache = await caches.open('gerador-modelos'); } catch {}
  const hit = await cache?.match(url);
  if (hit) return hit.arrayBuffer();
  onStatus?.('Baixando a IA de profundidade 3D (só na primeira vez)...');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = await res.arrayBuffer();
  cache?.put(url, new Response(buf.slice(0))).catch(() => {});
  return buf;
}

async function loadDepth(onStatus) {
  if (!depthSession) {
    depthSession = (async () => {
      const ort = await import('./vendor/ort/ort.webgpu.min.mjs');
      ort.env.wasm.wasmPaths = ORT_DIR;
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
      const model = await cachedFetch(DEPTH_MODEL, onStatus);
      const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
      return { ort, session };
    })();
    depthSession.catch(() => { depthSession = null; });
  }
  return depthSession;
}

function padded(layer) {
  const px = Math.round(layer.width * PAD), py = Math.round(layer.height * PAD);
  const c = new OffscreenCanvas(layer.width + 2 * px, layer.height + 2 * py);
  c.getContext('2d').drawImage(layer, px, py);
  c.pad = { px, py };
  return c;
}

// profundidade pelo formato: distância até a borda da peça (abaulado)
function shapeDepth(alpha, w, h) {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = alpha[i] > 0.5 ? INF : 0;
  // chanfro em duas passadas
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!d[i]) continue;
    let v = d[i];
    if (x) v = Math.min(v, d[i - 1] + 1);
    if (y) v = Math.min(v, d[i - w] + 1);
    if (x && y) v = Math.min(v, d[i - w - 1] + 1.414);
    if (y && x < w - 1) v = Math.min(v, d[i - w + 1] + 1.414);
    d[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (!d[i]) continue;
    let v = d[i];
    if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
    if (y < h - 1) v = Math.min(v, d[i + w] + 1);
    if (x < w - 1 && y < h - 1) v = Math.min(v, d[i + w + 1] + 1.414);
    if (y < h - 1 && x) v = Math.min(v, d[i + w - 1] + 1.414);
    d[i] = v;
  }
  let max = 1;
  for (const v of d) if (v > max) max = v;
  for (let i = 0; i < d.length; i++) d[i] = Math.sqrt(d[i] / max);
  return d;
}

async function aiDepth(src, w, h, onStatus) {
  const { ort, session } = await loadDepth(onStatus);
  onStatus?.('A IA está calculando a profundidade 3D...');
  const s = new OffscreenCanvas(SIDE, SIDE);
  const sc = s.getContext('2d');
  sc.fillStyle = '#fff';
  sc.fillRect(0, 0, SIDE, SIDE);
  sc.drawImage(src, 0, 0, SIDE, SIDE);
  const px = sc.getImageData(0, 0, SIDE, SIDE).data;
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  const input = new Float32Array(3 * SIDE * SIDE);
  for (let i = 0; i < SIDE * SIDE; i++) {
    for (let c = 0; c < 3; c++) input[c * SIDE * SIDE + i] = (px[i * 4 + c] / 255 - mean[c]) / std[c];
  }
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIDE, SIDE]) });
  const t = out[session.outputNames[0]];
  const oh = t.dims[t.dims.length - 2], ow = t.dims[t.dims.length - 1];
  // volta para o tamanho do mapa
  const res = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    res[y * w + x] = t.data[Math.min(oh - 1, Math.floor(y * oh / h)) * ow + Math.min(ow - 1, Math.floor(x * ow / w))];
  }
  return res;
}

// Mapa de profundidade (0 = fundo, 1 = mais perto) do tamanho da peça com margem.
export async function estimateDepth(layer, onStatus) {
  const src = padded(layer);
  const k = Math.min(1, 384 / Math.max(src.width, src.height));
  const w = Math.max(8, Math.round(src.width * k)), h = Math.max(8, Math.round(src.height * k));
  const small = new OffscreenCanvas(w, h);
  const sx = small.getContext('2d');
  sx.drawImage(src, 0, 0, w, h);
  const px = sx.getImageData(0, 0, w, h).data;
  const alpha = new Float32Array(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3] / 255;
  const shape = shapeDepth(alpha, w, h);

  let depth = shape, usedAi = false;
  try {
    const ai = await aiDepth(src, w, h, onStatus);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < ai.length; i++) if (alpha[i] > 0.5) { lo = Math.min(lo, ai[i]); hi = Math.max(hi, ai[i]); }
    if (hi > lo && Number.isFinite(hi)) {
      depth = new Float32Array(w * h);
      for (let i = 0; i < depth.length; i++) {
        const a = (ai[i] - lo) / (hi - lo);
        // mistura com o formato para a borda não "rasgar"
        depth[i] = alpha[i] * (0.7 * a + 0.3 * shape[i]);
      }
      usedAi = true;
    }
  } catch (e) {
    console.warn('Profundidade por IA indisponível; usando o formato da peça', e);
  }

  // suaviza para o giro não tremer
  const out = new OffscreenCanvas(w, h);
  const ox = out.getContext('2d');
  const img = ox.createImageData(w, h);
  for (let i = 0; i < depth.length; i++) {
    const v = Math.round(Math.max(0, Math.min(1, depth[i])) * 255);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ox.putImageData(img, 0, 0);
  const blur = new OffscreenCanvas(w, h);
  const bx = blur.getContext('2d');
  bx.filter = `blur(${Math.max(1, Math.round(w / 120))}px)`;
  bx.drawImage(out, 0, 0);
  return { map: blur, src, usedAi };
}

const VS = `attribute vec2 p; varying vec2 uv;
void main(){ uv = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0., 1.); }`;
const FS = `precision highp float;
uniform sampler2D img; uniform sampler2D dep; uniform vec2 shift; uniform float light; uniform float sx;
varying vec2 uv;
void main(){
  vec2 q = vec2((uv.x - .5) / sx + .5, uv.y);
  vec2 p = q;
  for (int i = 0; i < 10; i++) { float d = texture2D(dep, p).r; p = q - shift * (d - .35); }
  if (p.x < 0. || p.x > 1. || p.y < 0. || p.y > 1.) { gl_FragColor = vec4(0.); return; }
  vec4 c = texture2D(img, p);
  float d = texture2D(dep, p).r;
  float band = exp(-pow((p.x + p.y * .35 - light) * 5., 2.)) * d;
  c.rgb = min(c.rgb + vec3(.16) * band * c.a, vec3(c.a));
  gl_FragColor = c;
}`;

// Devolve draw(ctx, x, y, w, h, angle, light) — angle de -1 a 1.
// Sem WebGL, desenha a foto parada (com leve achatamento).
export function makeOrbit(layer, depth) {
  const src = depth.src;
  const pad = src.pad;
  const gw = src.width, gh = src.height;
  let gl = null, cnv = null, u = null;
  try {
    cnv = new OffscreenCanvas(gw, gh);
    gl = cnv.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
  } catch { gl = null; }
  if (gl) {
    const sh = (type, code) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, code);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    try {
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const tex = (unit, image) => {
        const t = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      };
      tex(0, src);
      tex(1, depth.map);
      gl.uniform1i(gl.getUniformLocation(prog, 'img'), 0);
      gl.uniform1i(gl.getUniformLocation(prog, 'dep'), 1);
      u = { shift: gl.getUniformLocation(prog, 'shift'), light: gl.getUniformLocation(prog, 'light'), sx: gl.getUniformLocation(prog, 'sx') };
      gl.viewport(0, 0, gw, gh);
    } catch (e) {
      console.warn('Giro 3D sem WebGL', e);
      gl = null;
    }
  }
  // tamanho da peça sem a margem, para posicionar igual às outras cenas
  const fx = gw / layer.width, fy = gh / layer.height;
  return (ctx, x, y, w, h, angle = 0, light = -1) => {
    const X = x - pad.px / layer.width * w, Y = y - pad.py / layer.height * h, Wd = w * fx, Hd = h * fy;
    if (!gl) {
      const s = 1 - 0.05 * Math.abs(angle);
      ctx.drawImage(layer, x + w * (1 - s) / 2, y, w * s, h);
      return;
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(u.shift, angle * 0.055, -Math.abs(angle) * 0.008);
    gl.uniform1f(u.light, light);
    gl.uniform1f(u.sx, 1 - 0.06 * Math.abs(angle));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    ctx.drawImage(cnv, X, Y, Wd, Hd);
  };
}

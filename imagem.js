// Tratamento da foto: remove o fundo, amplia com IA (ESRGAN), enquadra em
// 1200x1200 com fundo branco e monta as 5 versões do anúncio.
import { removeBackground } from './vendor/bg-removal.js';

export const SIZE = 1200;
const BOX_W = 1060;          // área máxima ocupada pelo produto
const BOX_H = 1040;
const LIFT = 20;             // sobe um pouco o produto para caber a sombra

const DATA_PATH = new URL('./vendor/imgly-data/', import.meta.url).href;
const ORT_DIR = new URL('./vendor/ort/', import.meta.url).href;
const SR_MODEL = new URL('./vendor/realesrgan/realesr-general-x4v3.onnx', import.meta.url).href;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// ---------- remoção de fundo ----------

// A biblioteca de recorte guarda o primeiro callback de progresso que recebe,
// então usamos sempre o mesmo e trocamos só o destino das mensagens.
let progressTarget = () => {};
function onCutProgress(key, cur, total) {
  progressTarget(key, cur, total);
}

export async function cutout(blob, onStatus = () => {}, label = 'produto') {
  progressTarget = (key, cur, total) => {
    if (key.startsWith('fetch') && total) {
      onStatus(`Carregando o modelo de recorte... ${Math.round((cur / total) * 100)}%`);
    } else if (key.startsWith('compute')) {
      onStatus(`Recortando o ${label}...`);
    }
  };
  try {
    return await removeBackground(blob, {
      publicPath: DATA_PATH,
      model: 'medium',
      output: { format: 'image/png', quality: 1 },
      progress: onCutProgress,
    });
  } finally {
    progressTarget = () => {};
  }
}

// Caixa onde o alpha é visível.
function alphaBounds(cnv) {
  const w = cnv.width, h = cnv.height;
  const { data } = cnv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w, h };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// ---------- redimensionamento ----------

// Redimensiona em etapas (no máximo 2x por passo) para um resultado mais limpo.
function resizeStepwise(src, sx, sy, sw, sh, tw, th) {
  let cur = canvas(sw, sh);
  cur.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  let w = sw, h = sh;
  while (w !== tw || h !== th) {
    const nw = tw > w ? Math.min(tw, w * 2) : Math.max(tw, Math.floor(w / 2));
    const nh = th > h ? Math.min(th, h * 2) : Math.max(th, Math.floor(h / 2));
    const next = canvas(nw, nh);
    const nctx = next.getContext('2d');
    nctx.imageSmoothingEnabled = true;
    nctx.imageSmoothingQuality = 'high';
    nctx.drawImage(cur, 0, 0, nw, nh);
    cur = next; w = nw; h = nh;
  }
  return cur;
}

// ---------- super-resolução com IA (Real-ESRGAN rodando no navegador) ----------
// Real-ESRGAN "general x4v3": reconstrói os detalhes (não só estica a imagem).
// Roda na placa de vídeo (WebGPU) quando existe; senão no processador (WASM).

let srSession = null;

async function loadSr(onStatus) {
  if (!srSession) {
    srSession = (async () => {
      onStatus('Carregando a IA de super-resolução...');
      const ort = await import('./vendor/ort/ort.webgpu.min.mjs');
      ort.env.wasm.wasmPaths = ORT_DIR;
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
      const model = await (await fetch(SR_MODEL)).arrayBuffer();
      const providers = navigator.gpu ? [['webgpu'], ['wasm']] : [['wasm']];
      for (const ep of providers) {
        try {
          const session = await ort.InferenceSession.create(model, { executionProviders: ep, graphOptimizationLevel: 'all' });
          return { ort, session, ep: ep[0] };
        } catch (e) {
          console.warn(`Super-resolução sem ${ep[0]}:`, e);
        }
      }
      throw new Error('Não foi possível iniciar a IA de super-resolução');
    })();
    srSession.catch(() => { srSession = null; });
  }
  return srSession;
}

// Amplia o canvas `src` 4x. Trabalha em blocos de tamanho fixo (a imagem é
// completada com branco) e confere cada bloco contra uma ampliação comum: se
// algum sair errado (preto, manchado), aquele pedaço usa a ampliação comum.
async function superResolve(src, onStatus) {
  const { ort, session, ep } = await loadSr(onStatus);
  const S = 4;
  const W = src.width, H = src.height;
  const TILE = ep === 'webgpu' ? 192 : 128, PAD = 12, P = TILE + PAD * 2;
  const cols = Math.ceil(W / TILE), rows = Math.ceil(H / TILE);

  const padded = canvas(cols * TILE + PAD * 2, rows * TILE + PAD * 2);
  const pctx = padded.getContext('2d', { willReadFrequently: true });
  pctx.fillStyle = '#fff';
  pctx.fillRect(0, 0, padded.width, padded.height);
  pctx.drawImage(src, PAD, PAD);
  // repete a borda da imagem na margem, para não criar contorno branco
  pctx.drawImage(src, 0, 0, W, 1, PAD, 0, W, PAD);
  pctx.drawImage(src, 0, H - 1, W, 1, PAD, PAD + H, W, PAD);
  pctx.drawImage(padded, PAD, 0, 1, padded.height, 0, 0, PAD, padded.height);
  pctx.drawImage(padded, PAD + W - 1, 0, 1, padded.height, PAD + W, 0, PAD, padded.height);
  const pdata = pctx.getImageData(0, 0, padded.width, padded.height).data;
  const PW = padded.width;

  const ref = resizeStepwise(src, 0, 0, W, H, W * S, H * S);
  const rdata = ref.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W * S, H * S).data;

  const out = canvas(W * S, H * S);
  const octx = out.getContext('2d');
  octx.drawImage(ref, 0, 0);

  const input = new Float32Array(3 * P * P);
  const OP = P * S;
  let done = 0, bad = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tx = c * TILE, ty = r * TILE;
      const tw = Math.min(TILE, W - tx), th = Math.min(TILE, H - ty);
      for (let y = 0; y < P; y++) {
        for (let x = 0; x < P; x++) {
          const i = ((ty + y) * PW + (tx + x)) * 4, o = y * P + x;
          input[o] = pdata[i] / 255;
          input[P * P + o] = pdata[i + 1] / 255;
          input[2 * P * P + o] = pdata[i + 2] / 255;
        }
      }
      const feeds = { input: new ort.Tensor('float32', input, [1, 3, P, P]) };
      const res = await session.run(feeds);
      const y4 = res.output.data;
      const img = new ImageData(tw * S, th * S);
      const d = img.data;
      let diff = 0, cnt = 0, nan = false;
      for (let y = 0; y < th * S; y++) {
        for (let x = 0; x < tw * S; x++) {
          const o = (y + PAD * S) * OP + (x + PAD * S);
          const i = (y * tw * S + x) * 4;
          for (let ch = 0; ch < 3; ch++) {
            const v = y4[ch * OP * OP + o];
            if (Number.isNaN(v)) nan = true;
            d[i + ch] = v * 255 + 0.5;
          }
          d[i + 3] = 255;
          if ((x & 3) === 0 && (y & 3) === 0) {
            const ri = ((ty * S + y) * W * S + (tx * S + x)) * 4;
            diff += Math.abs(d[i] - rdata[ri]) + Math.abs(d[i + 1] - rdata[ri + 1]) + Math.abs(d[i + 2] - rdata[ri + 2]);
            cnt += 3;
          }
        }
      }
      res.output.dispose?.();
      if (!nan && cnt && diff / cnt < 30) octx.putImageData(img, tx * S, ty * S);
      else bad++;
      done++;
      onStatus(`Reconstruindo os detalhes com IA... ${Math.round((done / (rows * cols)) * 100)}%`);
      await new Promise((res2) => setTimeout(res2, 0));
    }
  }
  if (bad > (rows * cols) / 2) throw new Error('A super-resolução falhou neste computador');
  if (bad) console.warn(`${bad} bloco(s) usaram a ampliação comum`);
  return out;
}

// ---------- nitidez ----------

// Máscara de nitidez (unsharp mask) ponderada pelo alpha, para não criar
// halo escuro nas bordas do produto recortado.
function sharpen(cnv, amount, sigma) {
  const w = cnv.width, h = cnv.height;
  const ctx = cnv.getContext('2d');
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;

  const radius = Math.max(1, Math.ceil(sigma * 2.5));
  const kernel = [];
  let ksum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(v); ksum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= ksum;

  const src = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3] / 255;
    src[i * 4] = d[i * 4] * a;
    src[i * 4 + 1] = d[i * 4 + 1] * a;
    src[i * 4 + 2] = d[i * 4 + 2] * a;
    src[i * 4 + 3] = a;
  }
  const tmp = new Float32Array(n * 4);
  const blur = new Float32Array(n * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        const j = (y * w + xx) * 4, kv = kernel[k + radius];
        r += src[j] * kv; g += src[j + 1] * kv; b += src[j + 2] * kv; a += src[j + 3] * kv;
      }
      const o = (y * w + x) * 4;
      tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b; tmp[o + 3] = a;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        const j = (yy * w + x) * 4, kv = kernel[k + radius];
        r += tmp[j] * kv; g += tmp[j + 1] * kv; b += tmp[j + 2] * kv; a += tmp[j + 3] * kv;
      }
      const o = (y * w + x) * 4;
      blur[o] = r; blur[o + 1] = g; blur[o + 2] = b; blur[o + 3] = a;
    }
  }
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (d[o + 3] === 0) continue;
    const ba = blur[o + 3];
    if (ba <= 0.001) continue;
    for (let c = 0; c < 3; c++) {
      const orig = d[o + c];
      const bl = blur[o + c] / ba;
      d[o + c] = Math.max(0, Math.min(255, Math.round(orig + amount * (orig - bl))));
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ---------- acabamento do recorte e das cores ----------

// Limpa a borda do recorte: some com sobras quase transparentes, deixa firme o
// que é quase opaco e troca a cor das bordas semitransparentes pela cor do
// produto logo ao lado (tira o "contorno" do fundo antigo).
function cleanEdges(cnv, box) {
  const { x: bx, y: by, w, h } = box;
  const ctx = cnv.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(bx, by, w, h);
  const d = img.data;
  const n = w * h;
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3];
    if (a < 16) d[i * 4 + 3] = 0;
    else if (a > 240) d[i * 4 + 3] = 255;
    if (d[i * 4 + 3] === 255) solid[i] = 1;
  }
  // espalha a cor dos pixels sólidos para a borda (3 passadas)
  for (let pass = 0; pass < 3; pass++) {
    const next = solid.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (solid[i] || d[i * 4 + 3] === 0) continue;
        let r = 0, g = 0, b = 0, k = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const j = yy * w + xx;
            if (!solid[j]) continue;
            r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; k++;
          }
        }
        if (k) {
          d[i * 4] = r / k; d[i * 4 + 1] = g / k; d[i * 4 + 2] = b / k;
          next[i] = 1;
        }
      }
    }
    solid.set(next);
  }
  ctx.putImageData(img, bx, by);
}

// Realce automático: estica levemente o contraste (níveis automáticos pelo
// brilho, sem mudar a cor) e dá um pouco mais de vida às cores.
function enhance(cnv) {
  const ctx = cnv.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, cnv.width, cnv.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++;
    total++;
  }
  if (!total) return;
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255; lo++) { acc += hist[lo]; if (acc > total * 0.004) break; }
  acc = 0;
  for (; hi > 0; hi--) { acc += hist[hi]; if (acc > total * 0.004) break; }
  // só corrige o que estiver lavado ou escuro, e no máximo pela metade
  // não estoura os brancos (mantém detalhe de lentes, cromados etc.)
  const tLo = Math.min(lo, 40) * 0.5, tHi = hi < 225 ? 255 - (255 - Math.max(hi, 200)) * 0.5 : 255;
  const k = 255 / Math.max(1, tHi - tLo);
  const SAT = 1.05;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let r = (d[i] - tLo) * k, g = (d[i + 1] - tLo) * k, b = (d[i + 2] - tLo) * k;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    r = l + (r - l) * SAT; g = l + (g - l) * SAT; b = l + (b - l) * SAT;
    d[i] = r; d[i + 1] = g; d[i + 2] = b;   // Uint8ClampedArray limita 0..255
  }
  ctx.putImageData(img, 0, 0);
}

// Mede quanto detalhe real a foto tem: reduz e amplia de volta em vários
// fatores e vê até onde a imagem quase não muda. Devolve a fração do tamanho
// atual que já guarda todo o detalhe (1 = nítida; 0.33 = é uma foto 3x menor
// que foi esticada). A medição é feita com no máximo 900 px.
function detailRatio(src, box) {
  const k0 = Math.min(1, 900 / Math.max(box.w, box.h));
  const w = Math.max(8, Math.round(box.w * k0)), h = Math.max(8, Math.round(box.h * k0));
  const base = canvas(w, h);
  const bctx = base.getContext('2d', { willReadFrequently: true });
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, w, h);
  const a = bctx.getImageData(0, 0, w, h).data;
  let found = 1;
  for (const k of [1.5, 2, 2.5, 3, 4]) {
    const sw = Math.max(4, Math.round(w / k)), sh = Math.max(4, Math.round(h / k));
    const small = canvas(sw, sh);
    const sctx = small.getContext('2d');
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(base, 0, 0, sw, sh);
    const back = canvas(w, h);
    const kctx = back.getContext('2d', { willReadFrequently: true });
    kctx.imageSmoothingQuality = 'high';
    kctx.drawImage(small, 0, 0, w, h);
    const b = kctx.getImageData(0, 0, w, h).data;
    let se = 0, n = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i + 3] < 200) continue;           // só pixels do produto
      const la = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
      const lb = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
      se += (la - lb) ** 2; n++;
    }
    if (!n) break;
    if (10 * Math.log10(65025 / Math.max(1e-6, se / n)) >= 40) found = k; else break;
  }
  // nítida na medição: trata como nítida (não reduz foto boa)
  return found === 1 ? 1 : k0 / found;
}

// ---------- preparo do produto ----------

/**
 * Remove o fundo, recorta o produto e amplia até caber em 1060x1040.
 * Devolve um canvas transparente só com o produto, em alta resolução.
 */
export async function prepareProduct(file, { removeBg = true, aiUpscale = true, colorFix = true, maxSharp = false, onStatus = () => {} } = {}) {
  const bmp = await createImageBitmap(file);
  const orig = canvas(bmp.width, bmp.height);
  orig.getContext('2d').drawImage(bmp, 0, 0);

  let cut = orig;
  let removed = false;
  if (removeBg) {
    onStatus('Removendo o fundo (a primeira vez demora um pouco para carregar o modelo)...');
    try {
      const cb = await createImageBitmap(await cutout(file, onStatus));
      cut = canvas(bmp.width, bmp.height);
      cut.getContext('2d').drawImage(cb, 0, 0, bmp.width, bmp.height);
      removed = true;
    } catch (e) {
      console.error(e);
      onStatus('Não consegui remover o fundo; usando a foto original.');
    }
  }

  const b = removed ? alphaBounds(cut) : { x: 0, y: 0, w: bmp.width, h: bmp.height };
  if (removed) cleanEdges(cut, b);
  const scale = Math.min(BOX_W / b.w, BOX_H / b.h);
  const tw = Math.max(1, Math.round(b.w * scale));
  const th = Math.max(1, Math.round(b.h * scale));

  let layer = null;
  let usedAi = false;
  // fotos pequenas OU grandes porém borradas (já esticadas) passam pela IA
  let detail = detailRatio(cut, b);
  if (maxSharp) detail = Math.min(detail, 0.34);   // força a reconstrução máxima
  if (aiUpscale && (scale > 1.05 || detail < 0.7)) {
    try {
      // recorte do produto com margem, ainda com o fundo original: a IA
      // reconstrói melhor a foto real, e o recorte é refeito em alta resolução
      const m = Math.max(6, Math.round(Math.max(b.w, b.h) * 0.04));
      const cx = Math.max(0, b.x - m), cy = Math.max(0, b.y - m);
      const cw = Math.min(bmp.width - cx, b.w + 2 * m), ch = Math.min(bmp.height - cy, b.h + 2 * m);
      let rgb = canvas(cw, ch);
      rgb.getContext('2d').drawImage(orig, cx, cy, cw, ch, 0, 0, cw, ch);

      // a IA amplia 4x. Escolhe o tamanho de entrada para que a saída já
      // chegue no tamanho final (ou um pouco acima), com todos os pixels
      // reconstruídos pela IA.
      // entrada = o maior entre (tamanho final / 4) e (o detalhe real da foto)
      const r = Math.min(1, Math.max(scale / 4, detail));
      let inW = Math.max(16, Math.round(cw * r)), inH = Math.max(16, Math.round(ch * r));
      if (scale > 4) { inW = Math.round(cw * scale / 4); inH = Math.round(ch * scale / 4); }
      const MAX_PX = 300000;
      if (inW * inH > MAX_PX) { const k = Math.sqrt(MAX_PX / (inW * inH)); inW = Math.round(inW * k); inH = Math.round(inH * k); }
      if (inW !== cw || inH !== ch) rgb = resizeStepwise(rgb, 0, 0, cw, ch, inW, inH);

      const up = await superResolve(rgb, onStatus);
      const factor = up.width / cw;
      let hi = up;
      if (removed) {
        try {
          // recorte refeito na foto já reconstruída: borda nítida
          onStatus('Recortando o produto em alta resolução...');
          const blob = await new Promise((res) => up.toBlob(res, 'image/png'));
          const cb = await createImageBitmap(await cutout(blob, onStatus));
          hi = canvas(up.width, up.height);
          hi.getContext('2d').drawImage(cb, 0, 0, up.width, up.height);
        } catch (e) {
          console.warn('Recorte em alta falhou; usando a máscara ampliada', e);
          const mask = resizeStepwise(cut, cx, cy, cw, ch, up.width, up.height);
          const uctx = up.getContext('2d');
          uctx.globalCompositeOperation = 'destination-in';
          uctx.drawImage(mask, 0, 0);
          uctx.globalCompositeOperation = 'source-over';
          hi = up;
        }
        const hb = alphaBounds(hi);
        cleanEdges(hi, hb);
        const k = Math.min(BOX_W / hb.w, BOX_H / hb.h);
        layer = resizeStepwise(hi, hb.x, hb.y, hb.w, hb.h, Math.round(hb.w * k), Math.round(hb.h * k));
      } else {
        const ox = Math.round((b.x - cx) * factor), oy = Math.round((b.y - cy) * factor);
        layer = resizeStepwise(up, ox, oy, Math.round(b.w * factor), Math.round(b.h * factor), tw, th);
      }
      usedAi = true;
    } catch (e) {
      console.warn('Super-resolução indisponível, usando a ampliação comum:', e);
    }
  }
  if (!layer) layer = resizeStepwise(cut, b.x, b.y, b.w, b.h, tw, th);

  onStatus('Ajustando cores e nitidez...');
  if (colorFix) enhance(layer);
  if (usedAi) sharpen(layer, 0.2, 0.7);
  else if (scale > 1.5) sharpen(layer, 0.9, 1.4);
  else if (scale > 1) sharpen(layer, 0.7, 1.1);
  else sharpen(layer, 0.45, 0.8);

  return { layer, removed, usedAi, upscaled: scale > 1, srcW: b.w, srcH: b.h, detail };
}

/** Prepara a foto de fundo (veículo/ambiente): remove o fundo e recorta. */
// Mantém só o objeto principal do recorte (o veículo) e apaga sobras soltas
// como fios, postes e placas. Recusa a foto se o veículo for pequeno demais
// ou se o recorte não tiver formato de veículo.
function keepMainObject(c) {
  const W0 = c.width, H0 = c.height;
  const k = Math.min(1, 400 / Math.max(W0, H0));
  const w = Math.max(1, Math.round(W0 * k)), h = Math.max(1, Math.round(H0 * k));
  const small = canvas(w, h);
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(c, 0, 0, w, h);
  const a = sctx.getImageData(0, 0, w, h).data;
  const label = new Int32Array(w * h).fill(-1);
  const comps = [];
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (label[i] !== -1 || a[i * 4 + 3] < 128) continue;
    const id = comps.length;
    const comp = { area: 0, x0: w, y0: h, x1: 0, y1: 0 };
    label[i] = id;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop();
      const x = j % w, y = (j - x) / w;
      comp.area++;
      if (x < comp.x0) comp.x0 = x;
      if (x > comp.x1) comp.x1 = x;
      if (y < comp.y0) comp.y0 = y;
      if (y > comp.y1) comp.y1 = y;
      for (const n of [j - 1, j + 1, j - w, j + w]) {
        if (n < 0 || n >= w * h || label[n] !== -1 || a[n * 4 + 3] < 128) continue;
        if ((n === j - 1 && x === 0) || (n === j + 1 && x === w - 1)) continue;
        label[n] = id;
        stack.push(n);
      }
    }
    comps.push(comp);
  }
  if (!comps.length) throw new Error('nenhum veículo no recorte');
  const main = comps.reduce((m, x) => (x.area > m.area ? x : m));
  const bw = main.x1 - main.x0 + 1, bh = main.y1 - main.y0 + 1;
  if (bw < w * 0.3 && bh < h * 0.3) throw new Error('veículo pequeno demais na foto');
  if (main.area < w * h * 0.06) throw new Error('veículo pequeno demais na foto');
  if (main.area < bw * bh * 0.35) throw new Error('recorte sem formato de veículo');
  // pedaços grandes perto do veículo (retrovisor, estepe) ficam; o resto sai
  const keep = new Uint8Array(comps.length);
  comps.forEach((x, id) => {
    const near = x.x1 >= main.x0 - 4 && x.x0 <= main.x1 + 4 && x.y1 >= main.y0 - 4 && x.y0 <= main.y1 + 4;
    keep[id] = x === main || (near && x.area > main.area * 0.02) ? 1 : 0;
  });
  let on = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) on[i] = label[i] >= 0 ? keep[label[i]] : 0;
  // engorda a máscara 2 pixels para não comer a borda do veículo
  for (let it = 0; it < 2; it++) {
    const nx = on.slice();
    for (let i = 0; i < w * h; i++) {
      if (on[i]) continue;
      const x = i % w;
      if ((x > 0 && on[i - 1]) || (x < w - 1 && on[i + 1]) || (i >= w && on[i - w]) || (i < w * h - w && on[i + w])) nx[i] = 1;
    }
    on = nx;
  }
  const mask = sctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) mask.data[i * 4 + 3] = on[i] ? 255 : 0;
  sctx.putImageData(mask, 0, 0);
  const big = canvas(W0, H0);
  const bctx = big.getContext('2d');
  bctx.filter = `blur(${Math.max(1, Math.round(1 / k))}px)`;
  bctx.drawImage(small, -2, -2, W0 + 4, H0 + 4);
  // apaga o que ficou fora da máscara, preservando a borda original do veículo
  const cctx = c.getContext('2d');
  cctx.globalCompositeOperation = 'destination-in';
  cctx.drawImage(big, 0, 0);
  cctx.globalCompositeOperation = 'source-over';
}

export async function prepareBackdrop(blob, onStatus = () => {}) {
  let src = blob;
  try {
    src = await cutout(blob, onStatus, 'veículo');
  } catch (e) {
    console.warn('Fundo do veículo mantido:', e);
  }
  const bmp = await createImageBitmap(src);
  const c = canvas(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, 0, 0);
  keepMainObject(c);
  const b = alphaBounds(c);
  cleanEdges(c, b);
  const out = canvas(b.w, b.h);
  out.getContext('2d').drawImage(c, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
  out.crop = { ...b, origW: bmp.width, origH: bmp.height };
  // foto de veículo pequena: reconstrói os detalhes com a mesma IA
  if (out.width < 900 && out.width * out.height < 300000) {
    try {
      const flat = canvas(out.width, out.height);
      const fctx = flat.getContext('2d');
      fctx.fillStyle = '#fff';
      fctx.fillRect(0, 0, flat.width, flat.height);
      fctx.drawImage(out, 0, 0);
      const up = await superResolve(flat, onStatus);
      const scale = up.width / out.width;
      const mask = resizeStepwise(out, 0, 0, out.width, out.height, up.width, up.height);
      const uctx = up.getContext('2d');
      uctx.globalCompositeOperation = 'destination-in';
      uctx.drawImage(mask, 0, 0);
      up.crop = { x: b.x * scale, y: b.y * scale, w: up.width, h: up.height, origW: bmp.width * scale, origH: bmp.height * scale };
      return up;
    } catch (e) {
      console.warn('Veículo sem super-resolução', e);
    }
  }
  return out;
}

/**
 * Marca onde a peça fica no veículo. box = [ymin, xmin, ymax, xmax] de 0 a 1000
 * sobre a foto original do veículo (formato do Gemini).
 */
export function setPartBox(backdrop, box) {
  if (!backdrop?.crop || !Array.isArray(box) || box.length !== 4) { if (backdrop) backdrop.partBox = null; return; }
  const { x, y, origW, origH } = backdrop.crop;
  const [y0, x0, y1, x1] = box.map(Number);
  const r = { x: x0 / 1000 * origW - x, y: y0 / 1000 * origH - y, w: (x1 - x0) / 1000 * origW, h: (y1 - y0) / 1000 * origH };
  backdrop.partBox = r.w > 2 && r.h > 2 ? r : null;
}

// ---------- composições ----------

function blank() {
  const c = canvas(SIZE, SIZE);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { c, ctx };
}

export function fit(w, h, maxW, maxH, allowUp = false) {
  const s = Math.min(maxW / w, maxH / h, allowUp ? Infinity : 1);
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

// Desenha o produto em (x, y, w, h), com sombra de contato e sombra suave.
export function drawWithShadow(ctx, layer, x, y, w, h, strength = 1) {
  const cx = x + w / 2, cy = Math.min(SIZE - 12, y + h - 4);
  const rx = w * 0.46, ry = Math.max(8, Math.min(40, h * 0.045));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(0,0,0,${0.38 * strength})`);
  g.addColorStop(0.55, `rgba(0,0,0,${0.16 * strength})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${0.30 * strength})`;
  ctx.shadowBlur = Math.max(20, w * 0.05);
  ctx.shadowOffsetY = Math.max(10, h * 0.02);
  ctx.drawImage(layer, x, y, w, h);
  ctx.restore();
  ctx.drawImage(layer, x, y, w, h);
}

// Veículo ao fundo: por padrão inteiro e nítido (opacity 1); o controle da
// tela permite deixá-lo mais claro.
function drawBackdrop(ctx, img, x, y, w, h, opacity) {
  ctx.save();
  ctx.globalAlpha = Math.max(0.2, Math.min(1, opacity));
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
}

// Produto em destaque: halo branco suave para separar do veículo + sombra.
function drawHero(ctx, layer, x, y, w, h) {
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.95)';
  ctx.shadowBlur = Math.max(24, w * 0.06);
  for (let i = 0; i < 2; i++) ctx.drawImage(layer, x, y, w, h);
  ctx.restore();
  drawWithShadow(ctx, layer, x, y, w, h);
}

// Círculo na posição da peça no veículo, ligado à peça por uma linha.
function drawCallout(ctx, box, to) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const r = Math.max(26, Math.max(box.w, box.h) * 0.75);
  const ang = Math.atan2(to.y - cy, to.x - cx);
  const sx = cx + Math.cos(ang) * r, sy = cy + Math.sin(ang) * r;
  ctx.save();
  ctx.lineCap = 'round';
  for (const [color, width] of [['#fff', 12], ['#e53935', 6]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  ctx.restore();
}

// Cópia espelhada (a peça do outro lado do veículo).
export function mirrored(layer) {
  const m = canvas(layer.width, layer.height);
  const mctx = m.getContext('2d');
  mctx.translate(layer.width, 0);
  mctx.scale(-1, 1);
  mctx.drawImage(layer, 0, 0);
  return m;
}

// Fundo branco puríssimo: o que é quase branco (resto de recorte, fim da
// sombra) vira #FFFFFF exato, como o Mercado Livre pede na foto principal.
function pureWhite(c, limit = 246) {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] >= limit && d[i + 1] >= limit && d[i + 2] >= limit) d[i] = d[i + 1] = d[i + 2] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** 1. Fundo branco. */
export function renderWhite(layer) {
  const { c, ctx } = blank();
  ctx.drawImage(layer, Math.round((SIZE - layer.width) / 2), Math.round((SIZE - layer.height) / 2) - LIFT);
  return pureWhite(c);
}

/** 2. Fundo branco com sombra. */
export function renderShadow(layer) {
  const { c, ctx } = blank();
  drawWithShadow(ctx, layer, Math.round((SIZE - layer.width) / 2), Math.round((SIZE - layer.height) / 2) - LIFT, layer.width, layer.height);
  return pureWhite(c);
}

/** 3. Par do produto (duas unidades lado a lado; a segunda pode ser espelhada). */
// Par direito + esquerdo: a segunda peça é o espelho da primeira, e as duas
// ficam simétricas em relação ao centro, como no veículo (cada uma de um lado).
// mirror=false: duas peças iguais (produtos que não têm lado).
export function renderPair(layer, mirror = true) {
  const { c, ctx } = blank();
  let second = layer;
  if (mirror) {
    second = canvas(layer.width, layer.height);
    const sctx = second.getContext('2d');
    sctx.translate(layer.width, 0);
    sctx.scale(-1, 1);
    sctx.drawImage(layer, 0, 0);
  }
  const tilted = (img, x, y, w, h, deg) => {
    // gira em volta do centro e desenha com sombra
    const t = canvas(Math.round(w * 1.3), Math.round(h * 1.15));
    const tctx = t.getContext('2d');
    tctx.translate(t.width / 2, t.height / 2);
    tctx.rotate(deg * Math.PI / 180);
    tctx.drawImage(img, -w / 2, -h / 2, w, h);
    const b = alphaBounds(t);
    const crop = canvas(b.w, b.h);
    crop.getContext('2d').drawImage(t, -b.x, -b.y);
    drawWithShadow(ctx, crop, x + w / 2 - t.width / 2 + b.x, y + h / 2 - t.height / 2 + b.y, b.w, b.h, 0.75);
  };
  const wide = layer.width > layer.height * 1.25;
  if (wide) {
    // peças largas: uma em cima da outra, a de baixo espelhada, com leve deslocamento
    const { w, h } = fit(layer.width, layer.height, 900, 470);
    const gap = Math.round(h * 0.1);
    const y = Math.round((SIZE - (h * 2 + gap)) / 2) - 10;
    tilted(second, Math.round((SIZE - w) / 2) - 30, y, w, h, 0);
    tilted(layer, Math.round((SIZE - w) / 2) + 30, y + h + gap, w, h, 0);
  } else {
    // lado a lado, simétricas: a espelhada à esquerda, a original à direita
    const { w, h } = fit(layer.width, layer.height, 460, 880);
    const gap = Math.round(Math.min(160, Math.max(70, w * 0.4)));
    const x = Math.round((SIZE - (w * 2 + gap)) / 2), y = Math.round((SIZE - h) / 2) - 15;
    tilted(second, x, y, w, h, 0);
    tilted(layer, x + w + gap, y, w, h, 0);
  }
  return c;
}

/** 4. Veículo inteiro ao fundo e o produto grande na frente, em destaque. */
export function renderSceneFront(layer, backdrop, opacity = 1) {
  const { c, ctx } = blank();
  const v = fit(backdrop.width, backdrop.height, 1140, 700, true);
  drawBackdrop(ctx, backdrop, SIZE - 30 - v.w, Math.round(SIZE * 0.40 - v.h / 2), v.w, v.h, opacity);
  const p = fit(layer.width, layer.height, 700, 1020);
  const x = Math.max(40, Math.round(SIZE * 0.36 - p.w / 2));
  const y = SIZE - 60 - p.h;
  drawHero(ctx, layer, x, y, p.w, p.h);
  return c;
}

/** 5. Veículo à esquerda com a posição da peça marcada, produto à direita. */
export function renderSceneSide(layer, backdrop, opacity = 1) {
  const { c, ctx } = blank();
  const v = fit(backdrop.width, backdrop.height, 700, 760, true);
  const vx = 30, vy = Math.round((SIZE - v.h) / 2);
  drawBackdrop(ctx, backdrop, vx, vy, v.w, v.h, opacity);
  const p = fit(layer.width, layer.height, 420, 1000);
  const x = SIZE - 40 - p.w;
  const y = Math.round((SIZE - p.h) / 2);
  const box = backdrop.partBox;
  if (box) {
    const k = v.w / backdrop.width;
    drawCallout(ctx, { x: vx + box.x * k, y: vy + box.y * k, w: box.w * k, h: box.h * k }, { x: x + p.w * 0.1, y: y + p.h * 0.5 });
  }
  drawHero(ctx, layer, x, y, p.w, p.h);
  return c;
}

export function toBlob(c, type = 'image/jpeg', quality = 0.95) {
  return new Promise((res) => c.toBlob(res, type, quality));
}

/** Confere a foto principal: tamanho, fundo branco puro e quanto o produto ocupa. */
export function checkPhoto(cnv) {
  const ctx = cnv.getContext('2d', { willReadFrequently: true });
  const { data } = ctx.getImageData(0, 0, cnv.width, cnv.height);
  const W = cnv.width, H = cnv.height;
  let border = 0, borderWhite = 0;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const white = data[i] >= 250 && data[i + 1] >= 250 && data[i + 2] >= 250;
      if (x < 8 || y < 8 || x >= W - 8 || y >= H - 8) { border++; if (white) borderWhite++; }
      if (!white) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  const fill = x1 < 0 ? 0 : Math.max((x1 - x0 + 1) / W, (y1 - y0 + 1) / H);
  return { width: W, height: H, whiteBorder: borderWhite / border, fill };
}

// Cenas do vídeo de apresentação (motion design no canvas): estúdio escuro com
// luz e partículas, produto entrando com efeito, cartões de destaques, lupa de
// detalhes, veículo, par direito/esquerdo e chamada final. Cada cena é uma
// função draw(ctx, t, dur); o renderizador junta as cenas com transições
// variadas (chicote, zoom, círculo, empurrão).
export const W = 1080, H = 1920;
const TR = 0.55;           // duração da transição (s)
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

const clamp = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
const easeInOut = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
// mola: passa um pouco do ponto e volta (efeito de "assentar")
const spring = (x) => { x = clamp(x); return 1 - Math.cos(x * Math.PI * 2.6) * Math.exp(-x * 5.5); };
const lerp = (a, b, t) => a + (b - a) * t;

function rgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex, a) => `rgba(${rgb(hex).join(',')},${a})`;

// ---------- fundo de estúdio ----------

const studioCache = new Map();
function studio(color) {
  if (studioCache.has(color)) return studioCache.get(color);
  const c = new OffscreenCanvas(W, H);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(W / 2, H * 0.42, 50, W / 2, H * 0.45, H * 0.75);
  g.addColorStop(0, '#2c3546');
  g.addColorStop(0.55, '#141a25');
  g.addColorStop(1, '#07090e');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W / 2, H * 0.44, 0, W / 2, H * 0.44, W * 0.75);
  glow.addColorStop(0, rgba(color, 0.42));
  glow.addColorStop(1, rgba(color, 0));
  x.fillStyle = glow;
  x.fillRect(0, 0, W, H);
  // piso com reflexo
  const f = x.createLinearGradient(0, H * 0.62, 0, H);
  f.addColorStop(0, 'rgba(255,255,255,0.05)');
  f.addColorStop(0.02, 'rgba(0,0,0,0.0)');
  f.addColorStop(1, 'rgba(0,0,0,0.55)');
  x.fillStyle = f;
  x.fillRect(0, H * 0.62, W, H * 0.38);
  studioCache.set(color, c);
  return c;
}

const DOTS = Array.from({ length: 28 }, (_, i) => {
  const r = (n) => { const s = Math.sin(i * 127.1 + n * 311.7) * 43758.5453; return s - Math.floor(s); };
  return { x: r(1) * W, y: r(2) * H, s: 3 + r(3) * 9, v: 18 + r(4) * 40, a: 0.06 + r(5) * 0.18, ph: r(6) * 6.28 };
});
function particles(ctx, t) {
  ctx.save();
  for (const d of DOTS) {
    const y = ((d.y - t * d.v) % H + H) % H;
    const x = d.x + Math.sin(t * 0.7 + d.ph) * 18;
    const g = ctx.createRadialGradient(x, y, 0, x, y, d.s * 2.5);
    g.addColorStop(0, `rgba(255,255,255,${d.a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - d.s * 2.5, y - d.s * 2.5, d.s * 5, d.s * 5);
  }
  ctx.restore();
}

function backdrop(ctx, t, color) {
  ctx.drawImage(studio(color), 0, 0);
  particles(ctx, t);
}

// faixa de luz atravessando a tela na diagonal
function lightSweep(ctx, p) {
  if (p <= 0 || p >= 1) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const x = lerp(-W * 0.6, W * 1.6, p);
  ctx.translate(x, H / 2);
  ctx.rotate(-0.35);
  const g = ctx.createLinearGradient(-160, 0, 160, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, `rgba(255,255,255,${0.18 * Math.sin(p * Math.PI)})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-160, -H, 320, H * 2);
  ctx.restore();
}

// ---------- produto ----------

const reflCache = new WeakMap();
function reflection(layer) {
  if (reflCache.has(layer)) return reflCache.get(layer);
  const h = Math.round(layer.height * 0.45);
  const c = new OffscreenCanvas(layer.width, h);
  const x = c.getContext('2d');
  x.translate(0, layer.height);
  x.scale(1, -1);
  x.drawImage(layer, 0, 0);
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'destination-in';
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0.32)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, layer.width, h);
  reflCache.set(layer, c);
  return c;
}

// tamanho do produto para caber em (maxW, maxH)
function fitSize(layer, maxW, maxH) {
  const k = Math.min(maxW / layer.width, maxH / layer.height);
  return { w: layer.width * k, h: layer.height * k };
}

// desenha a peça centrada em (cx, cy), com reflexo no piso e brilho atrás
function product(ctx, item, cx, cy, w, h, { angle = 0, light = -1, rot = 0, alpha = 1, refl = true } = {}) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.75);
  halo.addColorStop(0, 'rgba(255,255,255,0.10)');
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(cx - w * 1.5, cy - h, w * 3, h * 2);
  if (refl) {
    const r = reflection(item.layer);
    ctx.drawImage(r, cx - w / 2, cy + h / 2 + 6, w, h * 0.45);
  }
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  if (item.orbit) {
    item.orbit(ctx, -w / 2, -h / 2, w, h, angle, light);
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 60;
    ctx.shadowOffsetY = 30;
    ctx.drawImage(item.layer, -w / 2, -h / 2, w, h);
  }
  ctx.restore();
}

// ---------- textos ----------

function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function fitFont(ctx, text, maxW, size, min, maxLines, weight = 800) {
  let lines;
  for (; size >= min; size -= 4) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines) break;
  }
  return { size, lines };
}

// título com as palavras subindo uma a uma
function headline(ctx, text, t, y, color, { size = 86, maxW = W - 140, align = 'center', x = W / 2 } = {}) {
  if (!text || t < 0) return;
  const { size: s, lines } = fitFont(ctx, text, maxW, size, 48, 3);
  const lh = s * 1.12;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 24;
  let n = 0;
  lines.forEach((line, li) => {
    const words = line.split(' ');
    const total = ctx.measureText(line).width;
    let px = align === 'center' ? x - total / 2 : x;
    for (const wd of words) {
      const p = ease((t - n * 0.07) / 0.45);
      const ww = ctx.measureText(wd + ' ').width;
      ctx.globalAlpha = p;
      ctx.fillText(wd, px, y + li * lh + (1 - p) * 46);
      px += ww;
      n++;
    }
  });
  // traço de destaque crescendo embaixo
  const p = ease((t - 0.25) / 0.5);
  ctx.globalAlpha = 1;
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = color;
  const bw = 150 * p;
  const by = y + (lines.length - 1) * lh + 30;
  ctx.fillRect(align === 'center' ? x - bw / 2 : x, by, bw, 9);
  ctx.restore();
}

function chip(ctx, text, x, y, t, color, { align = 'center', size = 38 } = {}) {
  if (!text || t < 0) return;
  const p = ease(t / 0.4);
  ctx.save();
  ctx.font = `700 ${size}px ${FONT}`;
  const tw = ctx.measureText(text).width;
  const w = tw + 70, h = size + 34;
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.globalAlpha *= p;
  ctx.translate(0, (1 - p) * 30);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x0, y, w, h, h / 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x0 + 30, y + h / 2, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x0 + 50, y + h / 2 + 2);
  ctx.restore();
}

// cartão de destaque com ícone de visto
function card(ctx, text, x, y, w, t, color) {
  if (!text || t < 0) return 0;
  const p = ease(t / 0.5);
  const { size, lines } = fitFont(ctx, text, w - 130, 40, 30, 3, 700);
  const lh = size * 1.2;
  const h = Math.max(120, lines.length * lh + 50);
  ctx.save();
  ctx.globalAlpha *= p;
  ctx.translate((1 - p) * 140, 0);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 26);
  ctx.fill();
  ctx.stroke();
  const ix = x + 52, iy = y + h / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(ix, iy, 28 * lerp(0.4, 1, spring((t - 0.15) / 0.6)), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const cp = ease((t - 0.25) / 0.35);
  ctx.beginPath();
  ctx.moveTo(ix - 12, iy + 1);
  if (cp > 0) ctx.lineTo(ix - 12 + 8 * Math.min(1, cp * 2), iy + 1 + 9 * Math.min(1, cp * 2));
  if (cp > 0.5) ctx.lineTo(ix - 4 + 18 * (cp - 0.5) * 2, iy + 10 - 20 * (cp - 0.5) * 2);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, x + 100, y + h / 2 + (i - (lines.length - 1) / 2) * lh));
  ctx.restore();
  return h;
}

// ---------- cenas ----------

function sceneIntro(item, title, color) {
  return (ctx, t, dur) => {
    backdrop(ctx, t, color);
    lightSweep(ctx, (t - 0.15) / 1.1);
    const { w, h } = fitSize(item.layer, W * 0.78, H * 0.46);
    const p = spring(t / 1.0);
    const cx = lerp(W * 1.25, W / 2, p), cy = lerp(H * 0.8, H * 0.49, p);
    const rot = lerp(0.6, 0, p);
    const s = lerp(0.55, 1, p);
    // rastro de movimento enquanto voa
    const fly = clamp(1 - t / 0.7);
    for (let g = 3; g >= 1 && fly > 0; g--) {
      const q = spring(Math.max(0, t - g * 0.035) / 1.0);
      product(ctx, item, lerp(W * 1.25, W / 2, q), lerp(H * 0.8, H * 0.49, q), w * lerp(0.55, 1, q), h * lerp(0.55, 1, q),
        { rot: lerp(0.6, 0, q), alpha: 0.12 * fly, refl: false });
    }
    const after = Math.max(0, t - 0.9);
    product(ctx, item, cx, cy + Math.sin(after * 1.4) * 8, w * s, h * s,
      { rot, angle: Math.sin(after * 0.9) * 0.9, light: lerp(-0.4, 1.4, clamp(after / (dur - 0.9))) });
    headline(ctx, title, t - 0.55, H * 0.12, color);
  };
}

function sceneFeatures(item, feats, color, label) {
  return (ctx, t, dur) => {
    backdrop(ctx, t + 3, color);
    const { w, h } = fitSize(item.layer, W * 0.36, H * 0.42);
    const p = ease(t / 0.7);
    product(ctx, item, lerp(W * 0.5, W * 0.22, p), H * 0.43 + Math.sin(t * 1.3) * 6, w, h,
      { angle: Math.sin(t * 0.8) * 0.8, light: lerp(1.3, -0.3, t / dur) });
    chip(ctx, label, W / 2, H * 0.1, t - 0.1, color);
    let y = H * 0.22;
    feats.slice(0, 3).forEach((f, i) => {
      const hh = card(ctx, f, W * 0.42, y, W * 0.55, t - 0.45 - i * 0.5, color);
      y += (hh || 130) + 26;
    });
  };
}

// lupa passeando sobre a peça
function sceneLoupe(item, color, label) {
  return (ctx, t, dur) => {
    backdrop(ctx, t + 6, color);
    const { w, h } = fitSize(item.layer, W * 0.86, H * 0.6);
    const cx = W / 2, cy = H * 0.46;
    product(ctx, item, cx, cy, w, h, { angle: Math.sin(t * 0.6) * 0.4, light: lerp(-0.3, 1.3, t / dur) });
    const p = easeInOut(t / dur);
    const lx = cx + Math.sin(p * Math.PI * 1.5 - 0.6) * w * 0.18;
    const ly = cy + lerp(-h * 0.24, h * 0.24, p);
    const r = 175 * ease(t / 0.5);
    if (r > 2) {
      const zoom = 2.3;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 40;
      ctx.fillStyle = '#10141c';
      ctx.beginPath();
      ctx.arc(lx, ly, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.arc(lx, ly, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#1b2230';
      ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
      const zx = lx - (lx - (cx - w / 2)) * zoom, zy = ly - (ly - (cy - h / 2)) * zoom;
      ctx.drawImage(item.layer, zx, zy, w * zoom, h * zoom);
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(lx, ly, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = rgba(color, 0.9);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(lx, ly, r + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ease(t / 1.2));
      ctx.stroke();
      ctx.restore();
    }
    chip(ctx, label, W / 2, H * 0.1, t - 0.1, color);
  };
}

// foto com o veículo, com câmera andando e o selo de compatibilidade
function sceneVehicle(img, color, label, dir = 1) {
  return (ctx, t, dur) => {
    backdrop(ctx, t + 20, color);
    const p = easeInOut(t / dur);
    const a = spring(t / 0.9);
    // foto num cartão que entra girando de leve, com a câmera andando dentro
    const cw = W - 80, ch = cw * img.height / img.width;
    const x0 = 40, y0 = H * 0.45 - ch / 2;
    ctx.save();
    ctx.translate(W / 2, H * 0.45);
    ctx.rotate(lerp(dir * 0.08, 0, a));
    ctx.scale(lerp(0.8, 1, a), lerp(0.8, 1, a));
    ctx.translate(-W / 2, -H * 0.45);
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 60;
    ctx.shadowOffsetY = 24;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.roundRect(x0, y0, cw, ch, 30);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.clip();
    const z = lerp(1.0, 1.12, p);
    const zw = cw * z, zh = ch * z;
    ctx.drawImage(img, x0 - (zw - cw) / 2 + dir * lerp(-1, 1, p) * (zw - cw) / 2, y0 - (zh - ch) / 2, zw, zh);
    ctx.restore();
    chip(ctx, label, W / 2, H * 0.1, t - 0.25, color);
  };
}

// par: as duas peças vêm dos lados e se encontram no meio
// labels[0]: selo do alto
function scenePair(item, mirror, color, labels) {
  let left = null;
  return (ctx, t, dur) => {
    if (!left) {
      left = item.layer;
      if (mirror) {
        left = new OffscreenCanvas(item.layer.width, item.layer.height);
        const x = left.getContext('2d');
        x.translate(left.width, 0);
        x.scale(-1, 1);
        x.drawImage(item.layer, 0, 0);
      }
    }
    backdrop(ctx, t + 9, color);
    const { w, h } = fitSize(item.layer, W * 0.4, H * 0.42);
    const p = spring(t / 1.0);
    const gap = Math.max(40, w * 0.15);
    const lx = lerp(-w, W / 2 - gap / 2 - w / 2, p), rx = lerp(W + w, W / 2 + gap / 2 + w / 2, p);
    const cy = H * 0.46 + Math.sin(t * 1.2) * 6;
    product(ctx, { layer: left }, lx, cy, w, h, { rot: lerp(-0.3, 0, p) });
    product(ctx, item, rx, cy, w, h, { rot: lerp(0.3, 0, p) });
    // brilho quando as peças se encontram
    const f = clamp((t - 0.45) / 0.5);
    if (f > 0 && f < 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(color, 0.8 * (1 - f));
      ctx.lineWidth = 12 * (1 - f);
      ctx.beginPath();
      ctx.arc(W / 2, cy, lerp(40, 520, f), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    chip(ctx, labels[0], W / 2, H * 0.1, t - 0.1, color);
  };
}

function sceneAngle(item, color, label, phase) {
  return (ctx, t, dur) => {
    backdrop(ctx, t + 12 + phase, color);
    const { w, h } = fitSize(item.layer, W * 0.8, H * 0.5);
    const p = ease(t / 0.6);
    product(ctx, item, W / 2, H * 0.47, w * lerp(0.85, 1, p), h * lerp(0.85, 1, p),
      { angle: Math.sin(t * 0.9 + phase) * 0.9, light: lerp(-0.3, 1.3, t / dur), alpha: p });
    chip(ctx, label, W / 2, H * 0.1, t - 0.1, color);
  };
}

// chamada final: raios de luz girando atrás da peça e seta indicando o anúncio
function sceneOutro(item, cta, color) {
  return (ctx, t, dur) => {
    backdrop(ctx, t + 15, color);
    const cx = W / 2, cy = H * 0.47;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.25);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 12; i++) {
      ctx.rotate(Math.PI / 6);
      const g = ctx.createLinearGradient(0, 0, 0, -H * 0.6);
      g.addColorStop(0, rgba(color, 0.16));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-60, -H * 0.6);
      ctx.lineTo(60, -H * 0.6);
      ctx.fill();
    }
    ctx.restore();
    const { w, h } = fitSize(item.layer, W * 0.7, H * 0.42);
    const p = spring(t / 0.9);
    product(ctx, item, cx, cy, w * lerp(0.7, 1, p), h * lerp(0.7, 1, p),
      { angle: Math.sin(t * 0.9) * 0.7, light: lerp(-0.3, 1.3, t / dur) });
    headline(ctx, cta, t - 0.35, H * 0.12, color, { size: 80 });
    // seta pulando para baixo (o anúncio fica abaixo do vídeo no app)
    const a = ease((t - 0.9) / 0.4);
    if (a > 0) {
      const by = H * 0.72 + Math.abs(Math.sin(t * 4)) * 22;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(W / 2 - 40, by);
      ctx.lineTo(W / 2, by + 40);
      ctx.lineTo(W / 2 + 40, by);
      ctx.stroke();
      ctx.restore();
    }
  };
}

// ---------- roteiro de cenas ----------

// main: { layer, orbit } produto; angles: [{ layer, orbit }]; photos: { frente, lado };
// captions: textos (1º = título, do meio = destaques, último = chamada final)
export function buildScenes({ layer, orbit, angles = [], photos = {}, captions = [], vehicle = '', mirror = true, color = '#3483fa' }) {
  const main = { layer, orbit };
  const caps = captions.filter(Boolean);
  const title = caps[0] || 'Conheça o produto';
  const cta = caps.length > 1 ? caps[caps.length - 1] : 'Veja todos os detalhes no anúncio';
  const feats = caps.slice(1, -1);
  const list = [];
  const add = (draw, weight = 1) => list.push({ draw, weight });
  if (!layer) return list;
  add(sceneIntro(main, title, color), 1.25);
  if (feats.length) add(sceneFeatures(main, feats, color, 'Destaques'), 0.9 + 0.45 * Math.min(3, feats.length));
  if (photos.frente) add(sceneVehicle(photos.frente, color, vehicle ? `Compatível: ${vehicle}` : 'Encaixe original', 1), 1);
  add(sceneLoupe(main, color, 'Acabamento em detalhe'), 1.1);
  angles.forEach((a, i) => add(sceneAngle(a, color, 'Outro ângulo', i * 1.7), 0.9));
  if (photos.lado) add(sceneVehicle(photos.lado, color, 'Onde a peça é instalada', -1), 1);
  add(scenePair(main, mirror, color, [mirror ? 'Lado direito e esquerdo' : 'Também em par']), 1.1);
  add(sceneOutro(main, cta, color), 1.2);
  return list;
}

// tempos das cenas para a duração total
function timeline(scenes, duration) {
  const total = scenes.reduce((n, s) => n + s.weight, 0) || 1;
  let t = 0;
  return scenes.map((s) => { const d = duration * s.weight / total; const r = { start: t, end: t + d }; t += d; return r; });
}

// momentos das transições (para os efeitos sonoros)
export function transitionTimes(scenes, duration) {
  return timeline(scenes, duration).slice(1).map((x) => x.start);
}

// ---------- legenda e apresentador ----------

function drawCaption(ctx, text, t, color) {
  if (!text) return;
  const a = ease(t / 0.3);
  const { size, lines } = fitFont(ctx, text, W - 220, 64, 40, 3);
  const lh = size * 1.22, pad = 34;
  const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const boxH = lines.length * lh + pad * 1.4;
  const y = H * 0.76 + (1 - a) * 50;
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.fillStyle = 'rgba(10,12,16,.78)';
  ctx.beginPath();
  ctx.roundRect((W - boxW) / 2, y, boxW, boxH, 28);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect((W - boxW) / 2 + 28, y + boxH - 10, boxW - 56, 6);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y + pad * 0.7 + lh * (i + 0.5)));
  ctx.restore();
}

function drawPresenter(ctx, img, time) {
  const a = ease(time / 0.5);
  const r = 170 * lerp(0.8, 1, a), cx = W - 50 - 170, cy = H * 0.62;
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.shadowColor = 'rgba(0,0,0,.45)';
  ctx.shadowBlur = 30;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx, cy, r + 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}

// ---------- renderizador ----------

const KINDS = ['whip', 'circle', 'zoom', 'push'];
let bufA = null, bufB = null;
function buffers() {
  if (!bufA) { bufA = new OffscreenCanvas(W, H); bufB = new OffscreenCanvas(W, H); }
  return [bufA, bufB];
}

function transition(ctx, kind, p, A, B) {
  const e = easeInOut(p);
  ctx.save();
  if (kind === 'whip') {
    // chicote lateral com rastro de movimento
    const blur = Math.sin(e * Math.PI);
    for (let g = 0; g < 4; g++) {
      ctx.globalAlpha = g ? 0.25 * blur : 1;
      const off = g * 40 * blur;
      ctx.drawImage(A, -e * W - off, 0);
      ctx.drawImage(B, W - e * W - off, 0);
    }
  } else if (kind === 'circle') {
    ctx.drawImage(A, 0, 0, W, H);
    ctx.beginPath();
    ctx.arc(W / 2, H * 0.46, e * Math.hypot(W, H) * 0.62, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(B, 0, 0);
  } else if (kind === 'push') {
    ctx.drawImage(A, 0, -e * H * 0.35, W, H);
    ctx.fillStyle = `rgba(0,0,0,${0.5 * e})`;
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(B, 0, H * (1 - e));
  } else {
    ctx.translate(W / 2, H / 2);
    ctx.save();
    ctx.scale(1 + 0.25 * e, 1 + 0.25 * e);
    ctx.drawImage(A, -W / 2, -H / 2);
    ctx.restore();
    ctx.globalAlpha = e;
    ctx.scale(lerp(0.85, 1, e), lerp(0.85, 1, e));
    ctx.drawImage(B, -W / 2, -H / 2);
  }
  ctx.restore();
}

// subtitles: [{ text, start, end }] legendas no tempo da voz
// overlay: { presenter } preenchido por prepare(t) antes de cada quadro
export function makeRenderer(scenes, duration, color = '#3483fa', { subtitles = null, overlay = {} } = {}) {
  const tl = timeline(scenes, duration);
  return (ctx, time) => {
    let i = tl.findIndex((x) => time < x.end);
    if (i < 0) i = scenes.length - 1;
    const { start, end } = tl[i];
    const t = time - start, dur = end - start;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const left = end - time;
    if (i < scenes.length - 1 && left < TR / 2) {
      // transição centrada na troca: metade antes, metade depois
      const [A, B] = buffers();
      const p = 0.5 - left / TR;
      scenes[i].draw(A.getContext('2d'), t, dur);
      scenes[i + 1].draw(B.getContext('2d'), -left, tl[i + 1].end - tl[i + 1].start);
      transition(ctx, KINDS[i % KINDS.length], p, A, B);
    } else if (i > 0 && t < TR / 2) {
      const [A, B] = buffers();
      const p = 0.5 + t / TR;
      scenes[i - 1].draw(A.getContext('2d'), tl[i - 1].end - tl[i - 1].start + t, tl[i - 1].end - tl[i - 1].start);
      scenes[i].draw(B.getContext('2d'), t, dur);
      transition(ctx, KINDS[(i - 1) % KINDS.length], p, A, B);
    } else {
      scenes[i].draw(ctx, t, dur);
    }
    if (subtitles) {
      const s = subtitles.find((x) => time >= x.start && time < x.end + 0.15);
      if (s) drawCaption(ctx, s.text, time - s.start, color);
    }
    if (overlay.presenter) drawPresenter(ctx, overlay.presenter, time);
    // barra de progresso no alto
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0, 0, W, 8);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W * time / duration, 8);
    // abertura e fechamento suaves
    if (time < 0.25) {
      ctx.fillStyle = `rgba(0,0,0,${1 - time / 0.25})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (time > duration - 0.4) {
      ctx.fillStyle = `rgba(0,0,0,${(time - duration + 0.4) / 0.4})`;
      ctx.fillRect(0, 0, W, H);
    }
  };
}

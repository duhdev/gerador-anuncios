// Fotos 4, 5 e 6: a sequência conta uma história para o comprador.
// 4. desejo (o produto em uso na vida real), 5. convicção (benefícios e
// compatibilidade), 6. certeza (qual é o lado certo).
import { SIZE, fit, drawWithShadow, mirrored } from './imagem.js';

const FONT = '"Inter","Segoe UI",Roboto,Helvetica,Arial,sans-serif';
const NAVY = '#0f1b33', BLUE = '#3483fa', YELLOW = '#ffe600', GRAY = '#5b6475';

function canvas() {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { c, ctx };
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// Quebra o texto em linhas; diminui a fonte até caber em maxLines.
function layoutText(ctx, text, maxW, size, weight = 800, maxLines = 2) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  for (let s = size; s >= size * 0.5; s -= 2) {
    ctx.font = `${weight} ${s}px ${FONT}`;
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(t).width <= maxW || !cur) cur = t;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxW)) return { lines, size: s };
  }
  ctx.font = `${weight} ${Math.round(size * 0.5)}px ${FONT}`;
  return { lines: [words.join(' ')], size: Math.round(size * 0.5) };
}

function drawText(ctx, text, x, y, maxW, size, { weight = 800, color = NAVY, align = 'left', maxLines = 2, lh = 1.15 } = {}) {
  const { lines, size: s } = layoutText(ctx, text, maxW, size, weight, maxLines);
  ctx.font = `${weight} ${s}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * s * lh));
  return lines.length * s * lh;
}

function pill(ctx, text, x, y, { bg = YELLOW, color = NAVY, size = 26, align = 'left' } = {}) {
  ctx.font = `800 ${size}px ${FONT}`;
  const w = ctx.measureText(text).width + size * 1.3, h = size * 1.75;
  const x0 = align === 'center' ? x - w / 2 : x;
  ctx.fillStyle = bg;
  rrect(ctx, x0, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x0 + w / 2, y + h / 2 + 1);
  return { w, h };
}

function check(ctx, cx, cy, r, bg = BLUE) {
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = r * 0.22;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.42, cy + r * 0.02);
  ctx.lineTo(cx - r * 0.1, cy + r * 0.34);
  ctx.lineTo(cx + r * 0.45, cy - r * 0.3);
  ctx.stroke();
}

function cover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// ---------- 4. produto em uso ----------

/**
 * Cena real de uso (veículo no trânsito, na estrada...). Quando a cena não
 * tem a peça exata (foto enviada ou gerada sem a peça), ela aparece num
 * quadro no canto, para o comprador ligar a peça ao uso.
 */
export function renderInUse(layer, scene, inset = true) {
  const { c, ctx } = canvas();
  cover(ctx, scene, 0, 0, SIZE, SIZE);
  const v = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.45, SIZE / 2, SIZE / 2, SIZE * 0.78);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, SIZE, SIZE);
  if (inset) {
    const s = 340, x = SIZE - 40 - s, y = SIZE - 40 - s;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = '#fff';
    rrect(ctx, x, y, s, s, 32);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 6;
    rrect(ctx, x - 3, y - 3, s + 6, s + 6, 34);
    ctx.stroke();
    const p = fit(layer.width, layer.height, s - 50, s - 50, true);
    drawWithShadow(ctx, layer, x + (s - p.w) / 2, y + (s - p.h) / 2 - 6, p.w, p.h, 0.6);
  }
  return c;
}

// ---------- 5. conversão ----------

/**
 * Peça em destaque + 1 promessa + 3 benefícios + compatibilidade.
 * info: { titulo, beneficios: [3], compatibilidade, selo }
 */
export function renderConversion(layer, info) {
  const { c, ctx } = canvas();
  const g = ctx.createLinearGradient(0, 0, 0, SIZE);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#e9f0fb');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // título no alto (onde o olho começa a ler)
  let top = 56;
  if (info.selo) top += pill(ctx, info.selo.toUpperCase(), 60, top, { size: 26 }).h + 18;
  top += drawText(ctx, info.titulo, 60, top, 1080, 70, { maxLines: 2 }) + 30;

  const band = info.compatibilidade ? 170 : 0;
  const bottom = SIZE - 40 - band - (band ? 30 : 0);
  // produto grande à esquerda, sobre um círculo de destaque
  const area = { x: 40, y: top, w: 600, h: bottom - top };
  const cx = area.x + area.w / 2, cy = area.y + area.h / 2;
  const r = Math.min(area.w, area.h) * 0.5;
  ctx.fillStyle = 'rgba(52,131,250,0.12)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(52,131,250,0.25)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  ctx.stroke();
  const p = fit(layer.width, layer.height, area.w - 40, area.h - 30, true);
  drawWithShadow(ctx, layer, Math.round(cx - p.w / 2), Math.round(cy - p.h / 2), p.w, p.h, 0.8);

  // três benefícios à direita
  const bs = (info.beneficios || []).filter(Boolean).slice(0, 3);
  const colX = 680, colW = SIZE - 40 - colX;
  const cardH = Math.min(170, (area.h - 24 * (bs.length - 1)) / Math.max(1, bs.length));
  let by = cy - (bs.length * cardH + (bs.length - 1) * 24) / 2;
  for (const b of bs) {
    ctx.save();
    ctx.shadowColor = 'rgba(15,27,51,0.12)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#fff';
    rrect(ctx, colX, by, colW, cardH, 22);
    ctx.fill();
    ctx.restore();
    check(ctx, colX + 58, by + cardH / 2, 30);
    const { lines, size } = layoutText(ctx, b, colW - 130, 36, 800, 2);
    const th = lines.length * size * 1.15;
    drawText(ctx, b, colX + 108, by + (cardH - th) / 2, colW - 130, 36, { maxLines: 2 });
    by += cardH + 24;
  }

  // faixa de compatibilidade (tira a principal dúvida de quem compra peça)
  if (band) {
    const y = SIZE - 40 - band;
    ctx.fillStyle = NAVY;
    rrect(ctx, 40, y, SIZE - 80, band, 26);
    ctx.fill();
    check(ctx, 120, y + band / 2, 40, '#12a150');
    drawText(ctx, 'COMPATÍVEL COM', 190, y + 30, 900, 26, { color: YELLOW, maxLines: 1 });
    drawText(ctx, info.compatibilidade, 190, y + 68, 920, 46, { color: '#fff', maxLines: 2, lh: 1.05 });
  }
  return c;
}

// ---------- 6. qual é o lado ----------

function car(ctx, cx, top, w, h) {
  const x = cx - w / 2;
  // rodas
  ctx.fillStyle = '#2b2f36';
  for (const wy of [top + h * 0.15, top + h * 0.72]) {
    rrect(ctx, x - 16, wy, 30, h * 0.14, 8); ctx.fill();
    rrect(ctx, x + w - 14, wy, 30, h * 0.14, 8); ctx.fill();
  }
  // retrovisores
  ctx.fillStyle = '#c3cad6';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * (w / 2 + 18), top + h * 0.33, 24, 12, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // carroceria
  ctx.save();
  ctx.shadowColor = 'rgba(15,27,51,0.18)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = '#e4e9f1';
  rrect(ctx, x, top, w, h, [w * 0.38, w * 0.38, w * 0.22, w * 0.22]);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#a4adbc';
  ctx.lineWidth = 5;
  rrect(ctx, x, top, w, h, [w * 0.38, w * 0.38, w * 0.22, w * 0.22]);
  ctx.stroke();
  // vidros
  ctx.fillStyle = '#b9c6d8';
  ctx.beginPath();
  ctx.moveTo(x + w * 0.14, top + h * 0.30);
  ctx.lineTo(x + w * 0.86, top + h * 0.30);
  ctx.lineTo(x + w * 0.80, top + h * 0.20);
  ctx.lineTo(x + w * 0.20, top + h * 0.20);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + w * 0.18, top + h * 0.80);
  ctx.lineTo(x + w * 0.82, top + h * 0.80);
  ctx.lineTo(x + w * 0.86, top + h * 0.87);
  ctx.lineTo(x + w * 0.14, top + h * 0.87);
  ctx.closePath();
  ctx.fill();
  // bancos da frente: volante do lado esquerdo (motorista)
  const seatY = top + h * 0.40;
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#cdd4df';
    rrect(ctx, cx + s * w * 0.22 - w * 0.15, seatY, w * 0.30, h * 0.15, 14);
    ctx.fill();
  }
  const sx = cx - w * 0.22, sy = seatY - 6;
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.ellipse(sx, sy, 32, 12, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = `700 21px ${FONT}`;
  ctx.fillStyle = NAVY;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('Motorista', sx, seatY + h * 0.16);
  ctx.fillText('Passageiro', cx + w * 0.22, seatY + h * 0.16);
  // faróis e lanternas
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#fff3b0';
    rrect(ctx, cx + s * w * 0.33 - 26, top + 14, 52, 22, 10); ctx.fill();
    ctx.fillStyle = '#e53935';
    rrect(ctx, cx + s * w * 0.36 - 22, top + h - 34, 44, 22, 8); ctx.fill();
  }
}

function arrow(ctx, from, to, color) {
  const mx = (from.x + to.x) / 2, my = Math.min(from.y, to.y) - 40;
  const ang = Math.atan2(to.y - my, to.x - mx);
  for (const [col, wdt] of [['#fff', 16], [color, 9]]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = wdt;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(mx, my, to.x - Math.cos(ang) * 22, to.y - Math.sin(ang) * 22);
    ctx.stroke();
  }
  const L = 40;
  ctx.fillStyle = color;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - L * Math.cos(ang - 0.45), to.y - L * Math.sin(ang - 0.45));
  ctx.lineTo(to.x - L * Math.cos(ang + 0.45), to.y - L * Math.sin(ang + 0.45));
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
}

/**
 * Explica cada lado com o veículo visto de cima e setas para a posição da peça.
 * info: { vendido: 'esquerdo'|'direito'|'par'|null, foto: 'esquerdo'|'direito'|null,
 *         posicao: 'dianteira'|'traseira'|'lateral' }
 */
export function renderSides(layer, info) {
  const { c, ctx } = canvas();
  const g = ctx.createLinearGradient(0, 0, 0, SIZE);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#eef2f8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // sem título nem faixa: só o veículo, as duas peças e as setas, centralizados
  ctx.translate(0, 46);

  // qual imagem é de qual lado: a da foto e o espelho dela
  const fotoLado = info.foto || (info.vendido === 'esquerdo' || info.vendido === 'direito' ? info.vendido : null);
  const imgs = fotoLado ? { esquerdo: fotoLado === 'esquerdo' ? layer : mirrored(layer), direito: fotoLado === 'direito' ? layer : mirrored(layer) } : null;

  const cw = 290, ch = 640, ccx = SIZE / 2, ctop = 250;
  ctx.font = `800 22px ${FONT}`;
  ctx.fillStyle = GRAY;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('▲ FRENTE', ccx, ctop - 14);
  car(ctx, ccx, ctop, cw, ch);

  const target = (s) => {
    const sign = s === 'esquerdo' ? -1 : 1;
    if (info.posicao === 'dianteira') return { x: ccx + sign * cw * 0.33, y: ctop + 25 };
    if (info.posicao === 'lateral') return { x: ccx + sign * (cw / 2 + 18), y: ctop + ch * 0.33 };
    return { x: ccx + sign * cw * 0.36, y: ctop + ch - 23 };
  };

  for (const lado of ['esquerdo', 'direito']) {
    const left = lado === 'esquerdo';
    const sold = info.vendido === lado || info.vendido === 'par';
    const dim = info.vendido && !sold;
    const x = left ? 40 : SIZE - 40 - 330, y = 300, w = 330, h = 520;
    const color = dim ? '#9aa3b2' : BLUE;
    ctx.save();
    ctx.globalAlpha = dim ? 0.5 : 1;
    ctx.shadowColor = 'rgba(15,27,51,0.14)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#fff';
    rrect(ctx, x, y, w, h, 26);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    if (sold) {
      ctx.strokeStyle = BLUE;
      ctx.lineWidth = 6;
      rrect(ctx, x, y, w, h, 26);
      ctx.stroke();
    }
    if (imgs) {
      const p = fit(imgs[lado].width, imgs[lado].height, w - 50, h - 170, true);
      ctx.drawImage(imgs[lado], x + (w - p.w) / 2, y + 30 + (h - 170 - p.h) / 2, p.w, p.h);
    }
    drawText(ctx, left ? 'LADO ESQUERDO' : 'LADO DIREITO', x + w / 2, y + h - 125, w - 30, 36, { align: 'center', maxLines: 1, color: dim ? GRAY : NAVY });
    drawText(ctx, left ? 'lado do motorista' : 'lado do passageiro', x + w / 2, y + h - 78, w - 30, 26, { weight: 600, align: 'center', maxLines: 1, color: GRAY });
    ctx.restore();
    if (sold) pill(ctx, info.vendido === 'par' ? 'ACOMPANHA' : 'ESTE ANÚNCIO', x + w / 2, y - 24, { bg: BLUE, color: '#fff', size: 24, align: 'center' });
    const t = target(lado);
    arrow(ctx, { x: left ? x + w - 10 : x + 10, y: y + h * 0.42 }, t, color);
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 34, 0, Math.PI * 2);
    ctx.stroke();
  }

  return c;
}

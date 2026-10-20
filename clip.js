// Vídeo vertical para o Mercado Livre Clips, montado a partir das fotos geradas.
// Tudo roda no navegador: animação no canvas, trilha sonora sintetizada
// (sem direitos autorais) e MP4 gravado com WebCodecs.
import { Muxer, ArrayBufferTarget } from './vendor/mp4-muxer/mp4-muxer.mjs';

export const W = 1080, H = 1920, FPS = 30;
const FADE = 0.45;           // transição entre cenas (s)
const RATE = 44100;

const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- cenas ----------

function paintWhite(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#eef1f5');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// produto recortado entrando com um "pop" e balançando de leve
function sceneHero(layer) {
  return (ctx, t, dur) => {
    paintWhite(ctx);
    const k = Math.min(W * 0.86 / layer.width, H * 0.5 / layer.height);
    const s = k * lerp(0.82, 1, ease(t / 0.6)) * (1 + 0.04 * (t / dur));
    const w = layer.width * s, h = layer.height * s;
    const cx = W / 2, cy = H * 0.44;
    // sombra de contato
    ctx.save();
    ctx.translate(cx, cy + h / 2 + 10);
    ctx.scale(1, 0.12);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.45);
    g.addColorStop(0, 'rgba(0,0,0,.30)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(t * 1.6) * 0.025);
    ctx.shadowColor = 'rgba(0,0,0,.25)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 18;
    ctx.drawImage(layer, -w / 2, -h / 2, w, h);
    ctx.restore();
  };
}

// aproximação percorrendo o produto: mostra os detalhes
function sceneDetail(layer) {
  return (ctx, t, dur) => {
    paintWhite(ctx);
    const p = ease(t / dur);
    const k = Math.min(W * 1.25 / layer.width, H * 0.62 / layer.height) * lerp(1, 1.18, p);
    const w = layer.width * k, h = layer.height * k;
    const x = W / 2 - w / 2 + lerp(w * 0.12, -w * 0.12, p);
    const y = H * 0.42 - h / 2;
    ctx.drawImage(layer, x, y, w, h);
  };
}

// foto quadrada de fundo branco ocupando a largura, sem faixas pretas
function sceneSquare(img, zoomIn = true) {
  return (ctx, t, dur) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    const p = ease(t / dur);
    const s = W / img.width * (zoomIn ? lerp(1, 1.12, p) : lerp(1.12, 1, p));
    const w = img.width * s, h = img.height * s;
    ctx.drawImage(img, (W - w) / 2, H * 0.43 - h / 2, w, h);
  };
}

// foto com o veículo: a foto inteira (peça e destaque) no centro e a mesma
// foto ampliada e desfocada preenchendo o resto da tela vertical
function sceneCover(img, dir = 1) {
  const bg = new OffscreenCanvas(W / 4, H / 4);
  const b = bg.getContext('2d');
  const k = Math.max(bg.width / img.width, bg.height / img.height) * 1.1;
  b.filter = 'blur(10px) brightness(0.85)';
  b.drawImage(img, (bg.width - img.width * k) / 2, (bg.height - img.height * k) / 2, img.width * k, img.height * k);
  return (ctx, t, dur) => {
    const p = ease(t / dur);
    ctx.drawImage(bg, 0, 0, W, H);
    const s = W / img.width * lerp(1.0, 1.1, p);
    const w = img.width * s, h = img.height * s;
    const x = (W - w) / 2 + dir * lerp(-1, 1, p) * (w - W) / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)';
    ctx.shadowBlur = 50;
    ctx.drawImage(img, x, H * 0.43 - h / 2, w, h);
    ctx.restore();
  };
}

export function buildScenes({ layer, photos, captions }) {
  const list = [];
  const cap = [...captions];
  const last = cap.length > 1 ? cap.pop() : '';
  const add = (draw) => list.push({ draw, caption: cap.shift() || '' });
  if (layer) add(sceneHero(layer));
  if (photos.frente) add(sceneCover(photos.frente, 1));
  if (layer) add(sceneDetail(layer));
  if (photos.lado) add(sceneCover(photos.lado, -1));
  if (photos.par) add(sceneSquare(photos.par, true));
  // legendas que sobraram ganham cenas extras com as fotos já usadas
  const extra = [photos.sombra && sceneSquare(photos.sombra, false), layer && sceneDetail(layer)].filter(Boolean);
  for (let i = 0; cap.length && i < extra.length; i++) add(extra[i]);
  const outro = photos.sombra ? sceneSquare(photos.sombra, false) : layer ? sceneHero(layer) : null;
  if (outro) list.push({ draw: outro, caption: last });
  return list;
}

// ---------- legenda ----------

function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawCaption(ctx, text, t, color) {
  if (!text) return;
  const a = ease(t / 0.45);
  let size = 72, lines;
  for (; size >= 44; size -= 4) {
    ctx.font = `800 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
    lines = wrap(ctx, text, W - 220);
    if (lines.length <= 3) break;
  }
  const lh = size * 1.22, pad = 34;
  const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const boxH = lines.length * lh + pad * 1.4;
  const y = H * 0.71 + (1 - a) * 60;
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.fillStyle = 'rgba(17,20,24,.82)';
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

// ---------- quadro ----------

export function makeRenderer(scenes, duration, color = '#3483fa') {
  const per = duration / scenes.length;
  return (ctx, time) => {
    const i = Math.min(scenes.length - 1, Math.floor(time / per));
    const t = time - i * per;
    ctx.globalAlpha = 1;
    // cada cena dura um pouco mais para cobrir a transição
    scenes[i].draw(ctx, t + (i ? FADE : 0), per + FADE);
    drawCaption(ctx, scenes[i].caption, t, color);
    const left = per - t;
    if (i < scenes.length - 1 && left < FADE) {
      ctx.globalAlpha = 1 - left / FADE;
      scenes[i + 1].draw(ctx, FADE - left, per + FADE);
      ctx.globalAlpha = 1;
    }
    // final some suavemente para o branco
    if (time > duration - 0.4) {
      ctx.fillStyle = `rgba(255,255,255,${(time - duration + 0.4) / 0.4})`;
      ctx.fillRect(0, 0, W, H);
    }
  };
}

// ---------- trilha sonora (sintetizada, livre de direitos) ----------

export async function makeMusic(duration) {
  const ac = new OfflineAudioContext(2, Math.ceil(RATE * duration), RATE);
  const master = ac.createGain();
  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(0.8, 0.6);
  master.gain.setValueAtTime(0.8, Math.max(0.7, duration - 1.2));
  master.gain.linearRampToValueAtTime(0, duration);
  const comp = ac.createDynamicsCompressor();
  master.connect(comp).connect(ac.destination);

  const bpm = 104, beat = 60 / bpm, bar = beat * 4;
  const chords = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]];   // C G Am F
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1800;
  lp.connect(master);

  const noise = ac.createBuffer(1, RATE * 0.2, RATE);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  for (let b = 0, t0 = 0; t0 < duration; b++, t0 = b * bar) {
    const ch = chords[b % 4];
    // acordes em colcheias (pad pulsado)
    for (let s = 0; s < 8; s++) {
      const st = t0 + s * beat / 2;
      if (st >= duration) break;
      for (const n of ch) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'triangle';
        o.frequency.value = hz(n);
        g.gain.setValueAtTime(0.0001, st);
        g.gain.exponentialRampToValueAtTime(0.06, st + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, st + beat / 2 - 0.02);
        o.connect(g).connect(lp);
        o.start(st);
        o.stop(st + beat / 2);
      }
    }
    for (let k = 0; k < 4; k++) {
      const st = t0 + k * beat;
      if (st >= duration) break;
      // baixo
      const bo = ac.createOscillator(), bg = ac.createGain();
      bo.type = 'sine';
      bo.frequency.value = hz(ch[0] - 24);
      bg.gain.setValueAtTime(0.35, st);
      bg.gain.exponentialRampToValueAtTime(0.0001, st + beat * 0.9);
      bo.connect(bg).connect(master);
      bo.start(st);
      bo.stop(st + beat);
      // bumbo
      const ko = ac.createOscillator(), kg = ac.createGain();
      ko.frequency.setValueAtTime(140, st);
      ko.frequency.exponentialRampToValueAtTime(45, st + 0.15);
      kg.gain.setValueAtTime(0.7, st);
      kg.gain.exponentialRampToValueAtTime(0.0001, st + 0.22);
      ko.connect(kg).connect(master);
      ko.start(st);
      ko.stop(st + 0.25);
      // chimbal no contratempo
      const ht = st + beat / 2;
      if (ht < duration) {
        const hs = ac.createBufferSource(), hf = ac.createBiquadFilter(), hg = ac.createGain();
        hs.buffer = noise;
        hf.type = 'highpass';
        hf.frequency.value = 7000;
        hg.gain.setValueAtTime(0.12, ht);
        hg.gain.exponentialRampToValueAtTime(0.0001, ht + 0.05);
        hs.connect(hf).connect(hg).connect(master);
        hs.start(ht);
        hs.stop(ht + 0.06);
      }
    }
  }
  return ac.startRendering();
}

// ---------- gravação do MP4 ----------

async function pickVideoCodec() {
  if (!('VideoEncoder' in window)) return null;
  const base = { width: W, height: H, bitrate: 8_000_000, framerate: FPS };
  const tries = [
    { mux: 'avc', codec: 'avc1.640028', avc: { format: 'avc' } },   // H.264 High: o que o Mercado Livre aceita
    { mux: 'avc', codec: 'avc1.4d0028', avc: { format: 'avc' } },
    { mux: 'avc', codec: 'avc1.42e028', avc: { format: 'avc' } },
    { mux: 'vp9', codec: 'vp09.00.40.08' },
  ];
  for (const t of tries) {
    const cfg = { ...base, codec: t.codec, ...(t.avc ? { avc: t.avc } : {}) };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { mux: t.mux, cfg }; } catch {}
  }
  return null;
}

async function pickAudioCodec() {
  if (!('AudioEncoder' in window)) return null;
  const tries = [
    { mux: 'aac', cfg: { codec: 'mp4a.40.2', sampleRate: RATE, numberOfChannels: 2, bitrate: 160_000 } },
    { mux: 'opus', cfg: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128_000 } },
  ];
  for (const t of tries) {
    try { if ((await AudioEncoder.isConfigSupported(t.cfg)).supported) return t; } catch {}
  }
  return null;
}

function resample(buf, rate) {
  if (buf.sampleRate === rate) return Promise.resolve(buf);
  const ac = new OfflineAudioContext(buf.numberOfChannels, Math.ceil(buf.duration * rate), rate);
  const s = ac.createBufferSource();
  s.buffer = buf;
  s.connect(ac.destination);
  s.start();
  return ac.startRendering();
}

// Grava o vídeo. Devolve { blob, type, ext, warning }.
export async function recordClip({ render, duration, music, onProgress = () => {} }) {
  const video = await pickVideoCodec();
  if (!video) return recordRealtime({ render, duration, music, onProgress });
  const audio = music ? await pickAudioCodec() : null;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: video.mux, width: W, height: H, frameRate: FPS },
    ...(audio ? { audio: { codec: audio.mux, numberOfChannels: 2, sampleRate: audio.cfg.sampleRate } } : {}),
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let failure = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { failure = e; } });
  venc.configure(video.cfg);

  const cnv = new OffscreenCanvas(W, H);
  const ctx = cnv.getContext('2d');
  const frames = Math.round(duration * FPS);
  for (let f = 0; f < frames; f++) {
    if (failure) throw failure;
    render(ctx, f / FPS);
    const vf = new VideoFrame(cnv, { timestamp: Math.round(f * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
    venc.encode(vf, { keyFrame: f % (FPS * 2) === 0 });
    vf.close();
    while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
    if (f % 10 === 0) { onProgress(f / frames); await new Promise((r) => setTimeout(r, 0)); }
  }
  await venc.flush();
  venc.close();

  if (audio) {
    const buf = await resample(music, audio.cfg.sampleRate);
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { failure = e; } });
    aenc.configure(audio.cfg);
    const sr = audio.cfg.sampleRate, step = sr;   // blocos de 1 s
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (let i = 0; i < buf.length; i += step) {
      const n = Math.min(step, buf.length - i);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(i, i + n), 0);
      data.set(R.subarray(i, i + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i * 1e6 / sr), data });
      aenc.encode(ad);
      ad.close();
    }
    await aenc.flush();
    aenc.close();
  }
  if (failure) throw failure;
  muxer.finalize();
  onProgress(1);
  const warning = [
    video.mux !== 'avc' ? 'Seu navegador não grava H.264; o vídeo saiu em VP9. Se o Mercado Livre recusar, gere de novo pelo Google Chrome ou Edge.' : '',
    music && !audio ? 'Seu navegador não conseguiu gravar o áudio; o vídeo saiu sem música.' : '',
  ].filter(Boolean).join(' ');
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), type: 'video/mp4', ext: 'mp4', warning };
}

// Navegadores sem WebCodecs: grava em tempo real com o MediaRecorder.
async function recordRealtime({ render, duration, music, onProgress }) {
  if (!('MediaRecorder' in window)) throw new Error('Este navegador não grava vídeo. Use o Google Chrome ou o Edge.');
  const cnv = document.createElement('canvas');
  cnv.width = W;
  cnv.height = H;
  const ctx = cnv.getContext('2d');
  const stream = cnv.captureStream(FPS);
  let ac = null;
  if (music) {
    ac = new AudioContext();
    const src = ac.createBufferSource();
    src.buffer = music;
    const dest = ac.createMediaStreamDestination();
    src.connect(dest);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    src.start();
  }
  const mime = ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
    .find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const parts = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const done = new Promise((r) => { rec.onstop = r; });
  rec.start(250);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      render(ctx, Math.min(t, duration));
      onProgress(Math.min(1, t / duration));
      if (t >= duration) resolve(); else requestAnimationFrame(tick);
    };
    tick();
  });
  rec.stop();
  await done;
  ac?.close();
  const type = rec.mimeType || mime || 'video/webm';
  const ext = type.includes('mp4') ? 'mp4' : 'webm';
  return {
    blob: new Blob(parts, { type }), type, ext,
    warning: ext === 'webm' ? 'Seu navegador só grava WEBM. O Mercado Livre pede MP4: gere o vídeo pelo Google Chrome ou Edge.' : '',
  };
}

// Legendas padrão quando a IA não mandou as do vídeo.
export function defaultCaptions(ad) {
  const cut = (s) => (s.length > 34 ? s.slice(0, 33).replace(/\s+\S*$/, '') : s);
  if (Array.isArray(ad?.clip_legendas) && ad.clip_legendas.length) {
    return ad.clip_legendas.map((s) => String(s).trim()).filter(Boolean).slice(0, 7);
  }
  const out = [];
  if (ad?.produto_identificado) out.push(cut(ad.produto_identificado.replace(/\.$/, '')));
  for (const f of ad?.ficha_tecnica || []) {
    if (out.length >= 4) break;
    const v = String(f.valor || '');
    if (v && !/confirmar/i.test(v)) out.push(cut(`${f.atributo}: ${v}`));
  }
  if (!out.length) out.push('Conheça os detalhes', 'Acabamento de qualidade', 'Pronto para instalar');
  out.push('Veja todos os detalhes no anúncio');
  return out;
}

// Palavras que o Mercado Livre não aceita nos Clips.
export function forbidden(text) {
  const m = text.match(/R\$\s*\d|\b\d{2}\s*9?\d{4}-?\d{4}\b|frete|promo[cç][aã]o|desconto|cupom|oferta|whats|telefone|@|https?:|www\./i);
  return m ? m[0] : '';
}

// Vídeo vertical para o Mercado Livre Clips, montado a partir das fotos geradas.
// Tudo roda no navegador: animação no canvas, trilha sonora sintetizada
// (sem direitos autorais) e MP4 gravado com WebCodecs.
import { Muxer, ArrayBufferTarget } from './vendor/mp4-muxer/mp4-muxer.mjs';

export const W = 1080, H = 1920, FPS = 30;
const RATE = 44100;


// As cenas e o renderizador ficam em cenas.js.
export { buildScenes, makeRenderer, transitionTimes } from './cenas.js';

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

// Junta música, narração e voz do apresentador numa trilha só (estéreo 44,1 kHz).
// Com fala, a música fica baixinha por baixo. intro: áudio do avatar, no começo.
export async function makeSoundtrack({ duration, music = true, voice = null, voiceAt = 0.4, presenter = null, presenterAt = 0, intro = null, whooshes = [] }) {
  const speech = voice || presenter || intro;
  if (!music && !speech) return null;
  const ac = new OfflineAudioContext(2, Math.ceil(RATE * duration), RATE);
  // "whoosh" nas transições: ruído passando por um filtro que varre as frequências
  if (music && whooshes.length) {
    const len = Math.round(RATE * 0.6);
    const nb = ac.createBuffer(1, len, RATE);
    const d = nb.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / len);
    for (const at of whooshes) {
      const st = Math.max(0, at - 0.3);
      const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      s.buffer = nb;
      f.type = 'bandpass';
      f.Q.value = 1.2;
      f.frequency.setValueAtTime(400, st);
      f.frequency.exponentialRampToValueAtTime(4000, st + 0.3);
      f.frequency.exponentialRampToValueAtTime(800, st + 0.6);
      g.gain.value = speech ? 0.12 : 0.28;
      s.connect(f).connect(g).connect(ac.destination);
      s.start(st);
    }
  }
  const play = (buf, gain, at = 0) => {
    const s = ac.createBufferSource(), g = ac.createGain();
    s.buffer = buf;
    g.gain.value = gain;
    s.connect(g).connect(ac.destination);
    s.start(at);
  };
  if (music) play(await makeMusic(duration), speech ? 0.22 : 0.8);
  if (voice) play(voice, 1, voiceAt);
  if (presenter) play(presenter, 1.1, presenterAt);
  if (intro) play(intro, 1.1);   // fala do avatar na abertura
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
export async function recordClip({ render, prepare = null, duration, music, onProgress = () => {} }) {
  const video = await pickVideoCodec();
  if (!video) return recordRealtime({ render, prepare, duration, music, onProgress });
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
    if (prepare) await prepare(f / FPS);
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
async function recordRealtime({ render, prepare, duration, music, onProgress }) {
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
    const tick = async () => {
      const t = (performance.now() - t0) / 1000;
      if (prepare) await prepare(Math.min(t, duration));
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

// Roteiro padrão da narração quando a IA não mandou um.
export function defaultScript(ad, captions) {
  if (ad?.clip_roteiro) return String(ad.clip_roteiro).trim();
  return captions.map((c) => c.replace(/[.!?]*$/, '.')).join(' ');
}

// Palavras que o Mercado Livre não aceita nos Clips.
export function forbidden(text) {
  const m = text.match(/R\$\s*\d|\b\d{2}\s*9?\d{4}-?\d{4}\b|frete|promo[cç][aã]o|desconto|cupom|oferta|whats|telefone|@|https?:|www\./i);
  return m ? m[0] : '';
}

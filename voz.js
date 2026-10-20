// Narração com voz neural em português (Piper, voz "faber" pt-BR, licença
// livre). Roda no navegador: o texto vira fonemas (espeak-ng em WebAssembly) e
// a IA gera o áudio. Os arquivos são baixados na primeira vez e ficam guardados.
const PHON = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';
const VOICE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx';
const ORT_DIR = new URL('./vendor/ort/', import.meta.url).href;

let voice = null;

async function cachedFetch(url, onStatus, label) {
  let cache = null;
  try { cache = await caches.open('gerador-modelos'); } catch {}
  const hit = await cache?.match(url);
  if (hit) return hit;
  onStatus?.(label);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  await cache?.put(url, res.clone()).catch(() => {});
  return res;
}

async function loadVoice(onStatus) {
  if (!voice) {
    voice = (async () => {
      const ort = await import('./vendor/ort/ort.webgpu.min.mjs');
      ort.env.wasm.wasmPaths = ORT_DIR;
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
      const config = await (await cachedFetch(VOICE + '.json', onStatus, 'Baixando a voz...')).json();
      const model = await (await cachedFetch(VOICE, onStatus, 'Baixando a voz em português (só na primeira vez, cerca de 60 MB)...')).arrayBuffer();
      const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
      // arquivos do separador de fonemas guardados localmente como blob
      const wasm = URL.createObjectURL(await (await cachedFetch(PHON + '.wasm', onStatus, 'Baixando o leitor de português...')).blob());
      const data = URL.createObjectURL(await (await cachedFetch(PHON + '.data', onStatus, 'Baixando o leitor de português...')).blob());
      const { createPiperPhonemize } = await import('./vendor/piper/piper_phonemize.js');
      return { ort, session, config, createPiperPhonemize, wasm, data };
    })();
    voice.catch(() => { voice = null; });
  }
  return voice;
}

async function phonemize(v, text) {
  return new Promise((resolve, reject) => {
    v.createPiperPhonemize({
      print: (out) => { try { resolve(JSON.parse(out).phoneme_ids); } catch (e) { reject(e); } },
      printErr: (m) => console.warn('fonemas:', m),
      locateFile: (u) => (u.endsWith('.wasm') ? v.wasm : u.endsWith('.data') ? v.data : u),
    }).then((m) => {
      m.callMain(['-l', v.config.espeak.voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
    }).catch(reject);
  });
}

export function sentences(text) {
  return (text.match(/[^.!?…\n]+[.!?…]*/g) || []).map((s) => s.trim()).filter(Boolean);
}

// Fala o texto. Devolve { buffer: AudioBuffer, parts: [{ text, start, end }] }
// com o tempo de cada frase (para as legendas acompanharem a voz).
export async function speak(text, { onStatus, speed = 1 } = {}) {
  const v = await loadVoice(onStatus);
  const rate = v.config.audio.sample_rate;
  const inf = v.config.inference || {};
  const gap = Math.round(rate * 0.28);
  const chunks = [], parts = [];
  let pos = 0;
  const list = sentences(text);
  for (let i = 0; i < list.length; i++) {
    onStatus?.(`Gerando a voz... frase ${i + 1} de ${list.length}`);
    const ids = await phonemize(v, list[i]);
    const feeds = {
      input: new v.ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      input_lengths: new v.ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new v.ort.Tensor('float32', Float32Array.from([inf.noise_scale ?? 0.667, (inf.length_scale ?? 1) / speed, inf.noise_w ?? 0.8]), [3]),
    };
    if (Object.keys(v.config.speaker_id_map || {}).length) feeds.sid = new v.ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
    const out = await v.session.run(feeds);
    const pcm = out.output?.data || out[v.session.outputNames[0]].data;
    parts.push({ text: list[i], start: pos / rate, end: (pos + pcm.length) / rate });
    chunks.push(pcm);
    pos += pcm.length + gap;
  }
  const buffer = new AudioBuffer({ length: Math.max(1, pos), sampleRate: rate, numberOfChannels: 1 });
  const ch = buffer.getChannelData(0);
  let at = 0;
  for (const c of chunks) { ch.set(c, at); at += c.length + gap; }
  return { buffer, parts };
}

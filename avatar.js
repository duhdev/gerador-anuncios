// Avatar feito no Gemini (app ou Flow, com a assinatura do usuário): o vídeo
// baixado de lá entra como abertura do Clips. Aqui ele vira quadros JPEG
// pequenos + o áudio, para o vídeo final ser montado quadro a quadro.
const FPS = 30;
const MAX = 1280;          // maior lado guardado de cada quadro
const MAX_SECONDS = 30;    // o resto do Clips mostra o produto

// Pedido pronto para colar no Gemini junto com a foto do produto.
export function avatarPrompt(ad, script) {
  const produto = ad?.produto_identificado || ad?.titulo || 'o produto da foto';
  const fala = (script || '').split(/(?<=[.!?])\s+/).slice(0, 2).join(' ').slice(0, 160)
    || `Olha só essa ${produto}, peça nova com encaixe perfeito.`;
  return [
    'Crie um vídeo vertical (9:16), realista, de 8 segundos.',
    `Uma pessoa brasileira, simpática, em uma oficina/loja de autopeças bem iluminada, segura nas mãos a peça da foto anexada (${produto.charAt(0).toLowerCase() + produto.slice(1)}), exatamente igual à foto (mesmo formato, cor e detalhes) e mostra a peça para a câmera, girando-a devagar.`,
    `Ela olha para a câmera e diz, em português do Brasil, com voz natural: "${fala}"`,
    'Câmera parada na altura do peito, luz natural, sem texto na tela, sem música, sem logotipos.',
  ].join('\n\n');
}

function waitEvent(target, name) {
  return new Promise((resolve, reject) => {
    const ok = () => { off(); resolve(); };
    const bad = () => { off(); reject(new Error('Não consegui abrir esse vídeo. Use o MP4 baixado do Gemini.')); };
    const off = () => { target.removeEventListener(name, ok); target.removeEventListener('error', bad); };
    target.addEventListener(name, ok);
    target.addEventListener('error', bad);
  });
}

// Lê o vídeo. Devolve { frames: [{ t, blob }], audio, duration, w, h }.
export async function importAvatar(file, onStatus) {
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = url;
    await waitEvent(v, 'loadeddata');
    const duration = Math.min(MAX_SECONDS, v.duration || 0);
    if (!(duration >= 1)) throw new Error('O vídeo do avatar está vazio ou curto demais.');
    const s = Math.min(1, MAX / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * s), h = Math.round(v.videoHeight * s);
    const c = new OffscreenCanvas(w, h), g = c.getContext('2d');
    const frames = [];
    const n = Math.floor(duration * FPS);
    for (let i = 0; i < n; i++) {
      v.currentTime = i / FPS;
      await waitEvent(v, 'seeked');
      g.drawImage(v, 0, 0, w, h);
      frames.push({ t: i / FPS, blob: await c.convertToBlob({ type: 'image/jpeg', quality: 0.86 }) });
      if (i % 15 === 0) onStatus?.(`Lendo o vídeo do avatar... ${Math.round(100 * i / n)}%`);
    }
    let audio = null;
    try {
      const ac = new AudioContext();
      audio = await ac.decodeAudioData(await file.arrayBuffer());
      ac.close();
    } catch (e) { console.warn('Vídeo do avatar sem áudio', e); }
    return { frames, audio, duration, w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Desenha o quadro cobrindo a tela toda (corta as sobras, como no Clips).
export function drawCover(ctx, img, W, H) {
  const s = Math.max(W / img.width, H / img.height);
  const w = img.width * s, h = img.height * s;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

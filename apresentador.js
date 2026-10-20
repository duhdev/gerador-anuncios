// Gravação do apresentador pela câmera, com o roteiro rolando na tela
// (teleprompter). Guarda os quadros como JPEG pequenos e o áudio do microfone,
// para o vídeo final ser montado quadro a quadro com o produto.
const SIDE = 480;      // quadro quadrado guardado (vira o círculo no vídeo)
const FPS = 30;

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => (k === 'class' ? (e.className = v) : e.setAttribute(k, v)));
  children.flat().forEach((c) => c != null && e.append(c));
  return e;
}

// Abre a tela de gravação. Resolve com { frames: [{ t, blob }], audio, duration }
// ou null se o usuário cancelar.
export function recordPresenter(script, maxSeconds = 60) {
  return new Promise((resolve, reject) => {
    let stream = null, rec = null, timer = null, raf = 0, recording = false, finished = false;
    const frames = [];
    const audioParts = [];
    const video = el('video', { autoplay: '', muted: '', playsinline: '', class: 'tp-video' });
    video.muted = true;
    const text = el('div', { class: 'tp-text' }, script || 'Apresente o produto: o que é, para qual veículo serve e o principal benefício.');
    const info = el('p', { class: 'tp-info' }, 'Posicione o rosto no círculo. Ao gravar, leia o texto que vai subindo. Grave pelo menos 10 segundos (o Clips aceita de 10 a 60).');
    const startBtn = el('button', { type: 'button' }, 'Gravar');
    const stopBtn = el('button', { type: 'button', disabled: '' }, 'Parar');
    const cancelBtn = el('button', { type: 'button', class: 'ghost' }, 'Cancelar');
    const box = el('div', { class: 'tp' },
      el('div', { class: 'tp-cam' }, video, el('div', { class: 'tp-ring' })),
      el('div', { class: 'tp-script' }, text),
      info,
      el('div', { class: 'job-actions' }, cancelBtn, stopBtn, startBtn));
    const overlay = el('div', { class: 'tp-overlay' }, box);
    document.body.append(overlay);

    const cleanup = () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      overlay.remove();
    };

    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: { echoCancellation: true, noiseSuppression: true } })
      .then((s) => { stream = s; video.srcObject = s; })
      .catch((e) => { cleanup(); reject(new Error('Não consegui abrir a câmera e o microfone. Permita o acesso no navegador e tente de novo.')); console.warn(e); });

    const grab = new OffscreenCanvas(SIDE, SIDE);
    const g = grab.getContext('2d');
    let t0 = 0, next = 0, pending = 0;
    const loop = () => {
      if (!recording) return;
      const t = (performance.now() - t0) / 1000;
      if (t >= next && video.videoWidth && pending < 8) {
        next += 1 / FPS;
        const vw = video.videoWidth, vh = video.videoHeight, s = Math.min(vw, vh);
        g.save();
        g.translate(SIDE, 0);
        g.scale(-1, 1);       // espelhado, como a pessoa se vê
        g.drawImage(video, (vw - s) / 2, (vh - s) / 2, s, s, 0, 0, SIDE, SIDE);
        g.restore();
        pending++;
        grab.convertToBlob({ type: 'image/jpeg', quality: 0.85 }).then((blob) => { frames.push({ t, blob }); pending--; });
      }
      text.parentElement.scrollTop = Math.max(0, (t - 1.5) * 20);
      info.textContent = `Gravando... ${Math.floor(t)} s (máximo ${maxSeconds} s)`;
      if (t >= maxSeconds) stop();
      raf = requestAnimationFrame(loop);
    };

    const stop = async () => {
      if (!recording || finished) return;
      finished = true;
      recording = false;
      const duration = (performance.now() - t0) / 1000;
      const done = new Promise((r) => { rec.onstop = r; });
      rec.stop();
      await done;
      while (pending) await new Promise((r) => setTimeout(r, 20));
      let audio = null;
      try {
        const buf = await new Blob(audioParts, { type: rec.mimeType }).arrayBuffer();
        const ac = new AudioContext();
        audio = await ac.decodeAudioData(buf);
        ac.close();
      } catch (e) { console.warn('Áudio do apresentador falhou', e); }
      cleanup();
      frames.sort((a, b) => a.t - b.t);
      resolve({ frames, audio, duration });
    };

    startBtn.onclick = async () => {
      if (!stream) return;
      startBtn.disabled = true;
      for (let n = 3; n > 0; n--) { info.textContent = `Começando em ${n}...`; await new Promise((r) => setTimeout(r, 1000)); }
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
      rec = new MediaRecorder(new MediaStream(stream.getAudioTracks()), mime ? { mimeType: mime } : {});
      rec.ondataavailable = (e) => e.data.size && audioParts.push(e.data);
      rec.start(250);
      recording = true;
      t0 = performance.now();
      next = 0;
      stopBtn.disabled = false;
      loop();
    };
    stopBtn.onclick = stop;
    cancelBtn.onclick = () => { recording = false; rec?.state === 'recording' && rec.stop(); cleanup(); resolve(null); };
  });
}

// Busca o quadro do apresentador no tempo t (decodifica sob demanda e guarda o último).
export function presenterFrames(rec) {
  let lastIdx = -1, lastBmp = null;
  return {
    async at(t) {
      const f = rec.frames;
      if (!f.length) return null;
      let lo = 0, hi = f.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (f[m].t <= t) lo = m; else hi = m - 1; }
      if (lo !== lastIdx) {
        lastBmp?.close?.();
        lastBmp = await createImageBitmap(f[lo].blob);
        lastIdx = lo;
      }
      return lastBmp;
    },
  };
}

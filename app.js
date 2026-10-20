import {
  prepareProduct, prepareBackdrop, renderWhite, renderShadow, renderPair,
  renderSceneFront, renderSceneSide, checkPhoto, toBlob, setPartBox,
} from './imagem.js';
import { generateAd, generateBackdrop, searchBackdrops, fetchImage, pickBackdrops } from './ia.js';
import { makeZip } from './zip.js';
import { W, H, buildScenes, makeRenderer, makeSoundtrack, recordClip, defaultCaptions, defaultScript, forbidden, personPrompt } from './clip.js';
import { estimateDepth, makeOrbit } from './tresd.js';
import { speak, sentences } from './voz.js';
import { recordPresenter, presenterFrames } from './apresentador.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const SLOTS = [
  { id: 'branco', label: 'Fundo branco (principal)' },
  { id: 'sombra', label: 'Com sombra' },
  { id: 'par', label: 'Par do produto' },
  { id: 'fundo-frente', label: 'Veículo ao fundo (frente)' },
  { id: 'fundo-lado', label: 'Veículo ao fundo (ao lado)' },
];
const SCENES = ['fundo-frente', 'fundo-lado'];

const jobs = [];
let queue = Promise.resolve();
let userBackdrop = null;   // foto de fundo enviada (preparada uma vez)

// ---------- configurações ----------

const CHECKS = { removeBg: 'remove_bg', aiUpscale: 'ai_upscale', maxSharp: 'max_sharp', colorFix: 'color_fix', mirrorPair: 'mirror_pair' };

function loadConfig() {
  $('apiKey').value = store.get('gemini_key', '');
  $('model').value = store.get('gemini_model', 'gemini-2.5-flash');
  $('useSearch').checked = store.get('use_search', '1') === '1';
  for (const [id, key] of Object.entries(CHECKS)) $(id).checked = store.get(key, id === 'mirrorPair' || id === 'maxSharp' ? '0' : '1') === '1';
  $('bgOpacity').value = store.get('bg_opacity_v2', '100');
  $('bgOpacityVal').textContent = `${$('bgOpacity').value}%`;
  if (!$('apiKey').value) $('config').open = true;
}

function saveConfig() {
  store.set('gemini_key', $('apiKey').value.trim());
  store.set('gemini_model', $('model').value.trim() || 'gemini-2.5-flash');
  store.set('use_search', $('useSearch').checked ? '1' : '0');
  $('configMsg').textContent = 'Salvo.';
  setTimeout(() => ($('configMsg').textContent = ''), 2000);
}

const opacity = () => Number($('bgOpacity').value) / 100;

function status(msg, err = false) {
  const s = $('status');
  s.hidden = !msg;
  s.textContent = msg || '';
  s.classList.toggle('err', err);
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => (k === 'class' ? (e.className = v) : e.setAttribute(k, v)));
  children.flat().forEach((c) => c != null && e.append(c));
  return e;
}

function copyButton(getText) {
  const b = el('button', { class: 'ghost', type: 'button' }, 'Copiar');
  b.onclick = async () => {
    try { await navigator.clipboard.writeText(getText()); b.textContent = 'Copiado!'; }
    catch { b.textContent = 'Selecione e copie'; }
    setTimeout(() => (b.textContent = 'Copiar'), 1500);
  };
  return b;
}

function field(title, content, copyText) {
  return el('div', { class: 'field' },
    el('div', { class: 'field-head' }, el('h3', {}, title), copyText != null ? copyButton(() => copyText) : null),
    content);
}

// ---------- um anúncio (uma foto) ----------

class Job {
  constructor(file, index) {
    this.file = file;
    this.index = index;
    this.base = (file.name.replace(/\.[^.]+$/, '') || 'produto').replace(/[\\/:*?"<>|]+/g, '-');
    this.blobs = {};
    this.urls = {};
    this.layer = null;
    this.backdrop = null;
    this.candidates = null;  // [{ blob, caixa }] fotos do veículo aprovadas
    this.candIdx = -1;
    this.partBox = null;     // onde a peça fica no veículo do fundo
    this.ad = null;
    this.prep = null;
    this.buildUi();
  }

  buildUi() {
    this.statusEl = el('p', { class: 'status' }, 'Na fila...');
    this.grid = el('div', { class: 'grid' });
    this.checkEl = el('div', { class: 'checks' });
    this.adEl = el('div', {});
    this.regenBtn = el('button', { type: 'button', class: 'ghost' }, 'Gerar anúncio de novo');
    this.bgBtn = el('button', { type: 'button', class: 'ghost' }, 'Trocar veículo do fundo');
    this.regenBtn.onclick = () => this.runAd();
    this.bgBtn.onclick = () => this.nextBackdrop();
    this.slotEls = {};
    SLOTS.forEach((s, i) => {
      const fig = el('figure', { class: 'card slot' },
        el('div', { class: 'placeholder' }, 'Aguardando...'),
        el('figcaption', {}, `${i + 1}. ${s.label}`));
      this.slotEls[s.id] = fig;
      this.grid.append(fig);
    });
    this.root = el('section', { class: 'card job' },
      el('div', { class: 'ad-head' }, el('h2', {}, this.file.name),
        el('span', { class: 'job-actions' }, this.bgBtn, this.regenBtn)),
      this.statusEl, this.grid,
      el('h3', { class: 'sub' }, 'Conferência para o Mercado Livre'), this.checkEl,
      el('h3', { class: 'sub' }, 'Vídeo para o Mercado Livre Clips'), this.buildClipUi(),
      el('h3', { class: 'sub' }, 'Anúncio'), this.adEl);
    $('jobs').append(this.root);
  }

  status(msg, err = false) {
    this.statusEl.textContent = msg || '';
    this.statusEl.classList.toggle('err', err);
    if (msg) status(jobs.length > 1 ? `Foto ${this.index + 1} de ${jobs.length}: ${msg}` : msg, err);
  }

  slotMessage(id, msg) {
    const fig = this.slotEls[id];
    fig.firstChild.replaceWith(el('div', { class: 'placeholder' }, msg));
    fig.querySelector('a')?.remove();
    delete this.blobs[id];
  }

  async setSlot(id, cnv) {
    const blob = await toBlob(cnv);
    if (this.urls[id]) URL.revokeObjectURL(this.urls[id]);
    const url = URL.createObjectURL(blob);
    this.blobs[id] = blob;
    this.urls[id] = url;
    const i = SLOTS.findIndex((s) => s.id === id);
    const fig = this.slotEls[id];
    fig.firstChild.replaceWith(el('img', { src: url, alt: SLOTS[i].label }));
    fig.querySelector('figcaption').replaceChildren(
      `${i + 1}. ${SLOTS[i].label}`,
      el('a', { class: 'btn', href: url, download: this.fileName(id) }, 'Baixar'));
    return blob;
  }

  fileName(id) {
    return `${this.base}-${SLOTS.findIndex((s) => s.id === id) + 1}-${id}.jpg`;
  }

  async renderPair() {
    if (this.layer) await this.setSlot('par', renderPair(this.layer, $('mirrorPair').checked));
  }

  async renderScenes() {
    if (!this.layer || !this.backdrop) return;
    setPartBox(this.backdrop, this.partBox);
    await this.setSlot('fundo-frente', renderSceneFront(this.layer, this.backdrop, opacity()));
    await this.setSlot('fundo-lado', renderSceneSide(this.layer, this.backdrop, opacity()));
  }

  async run() {
    try {
      const opts = {
        removeBg: $('removeBg').checked, aiUpscale: $('aiUpscale').checked, maxSharp: $('maxSharp').checked, colorFix: $('colorFix').checked,
        onStatus: (m) => this.status(m),
      };
      this.prep = await prepareProduct(this.file, opts);
      this.layer = this.prep.layer;
      const white = renderWhite(this.layer);
      this.whiteBlob = await this.setSlot('branco', white);
      this.check = checkPhoto(white);
      await this.setSlot('sombra', renderShadow(this.layer));
      await this.renderPair();
      this.renderChecks();
    } catch (e) {
      console.error(e);
      this.status('Erro ao tratar a foto: ' + (e.message || e), true);
      return;
    }

    SCENES.forEach((id) => this.slotMessage(id, 'Aguardando a IA identificar o veículo...'));
    await this.runAd();
    await this.nextBackdrop();
    this.fillCaptions();
    if (this.urls.branco) this.personPhotoLink.href = this.urls.branco;
    this.clipBtn.disabled = this.previewBtn.disabled = false;
    this.status(this.ad ? 'Pronto! Confira os campos marcados com [CONFIRMAR] antes de publicar.' : this.statusEl.textContent,
      !this.ad);
    updateBatchBar();
  }

  // ---------- fundo com veículo ----------

  aiOpts() {
    return {
      key: store.get('gemini_key', '') || $('apiKey').value.trim(),
      model: store.get('gemini_model', '') || $('model').value.trim() || 'gemini-2.5-flash',
      vehicle: this.ad?.fundo?.descricao || $('extraInfo').value.trim(),
      part: this.ad?.produto_identificado || '',
    };
  }

  async nextBackdrop() {
    if (!this.layer) return;
    const f = $('bgFile').files[0];
    if (f) {
      // foto do veículo enviada pelo usuário: só marca onde fica a peça
      SCENES.forEach((id) => this.slotMessage(id, 'Recortando o veículo...'));
      userBackdrop = userBackdrop || { blob: f, canvas: await prepareBackdrop(f, (m) => this.status(m)) };
      this.backdrop = userBackdrop.canvas;
      const pick = await pickBackdrops([f], this.whiteBlob, this.aiOpts()).catch(() => null);
      this.partBox = pick?.[0]?.caixa || null;
      return this.renderScenes();
    }

    const query = this.ad?.fundo?.busca || $('extraInfo').value.trim();
    if (this.candidates === null) {
      SCENES.forEach((id) => this.slotMessage(id, 'Procurando fotos do veículo...'));
      this.candidates = [];
      try {
        this.status(`Procurando fotos de "${query}"...`);
        const urls = (await searchBackdrops(query)).slice(0, 8);
        const blobs = (await Promise.all(urls.map((u) => fetchImage(u).catch(() => null)))).filter(Boolean);
        if (blobs.length) {
          this.status('A IA está escolhendo a foto do veículo certo...');
          const picks = await pickBackdrops(blobs, this.whiteBlob, this.aiOpts());
          this.candidates = picks
            ? picks.map((p) => ({ blob: blobs[p.i], caixa: p.caixa }))
            : blobs.map((blob) => ({ blob, caixa: null }));
        }
      } catch (e) {
        console.warn('Busca de fotos falhou', e);
      }
    }
    SCENES.forEach((id) => this.slotMessage(id, 'Montando a foto com o veículo...'));
    for (let tries = 0; tries < this.candidates.length; tries++) {
      this.candIdx = (this.candIdx + 1) % this.candidates.length;
      const cand = this.candidates[this.candIdx];
      try {
        this.status('Recortando o veículo...');
        cand.canvas = cand.canvas || await prepareBackdrop(cand.blob, (m) => this.status(m));
        if (cand.canvas.width < 200) throw new Error('recorte pequeno demais');
        this.backdrop = cand.canvas;
        this.partBox = cand.caixa;
        return this.renderScenes();
      } catch (e) {
        console.warn('Foto do veículo descartada', e);
      }
    }
    // nenhuma foto real serviu: tenta gerar com IA de imagem gratuita
    const prompt = this.ad?.fundo?.prompt_en;
    if (prompt && !this.triedGen) {
      this.triedGen = true;
      try {
        this.status('Gerando a imagem do veículo com IA...');
        const blob = await generateBackdrop(prompt);
        const pick = await pickBackdrops([blob], this.whiteBlob, this.aiOpts()).catch(() => null);
        if (pick && !pick.length) throw new Error('veículo gerado não confere');
        this.candidates.push({ blob, caixa: pick?.[0]?.caixa || null });
        return this.nextBackdrop();
      } catch (e) {
        console.warn('Geração do fundo falhou', e);
      }
    }
    SCENES.forEach((id) => this.slotMessage(id,
      query
        ? `Não achei uma foto confiável de "${query}". Envie uma foto do veículo no campo "Foto do veículo ou ambiente" para montar estas duas fotos.`
        : 'Escreva o veículo em "Informações extras" ou envie uma foto dele no campo "Foto do veículo ou ambiente".'));
  }

  // ---------- vídeo para Clips ----------

  buildClipUi() {
    this.capEl = el('textarea', { rows: 5, placeholder: 'Uma legenda por linha (aparecem uma por cena)' });
    this.capEl.addEventListener('input', () => { this.capEdited = true; this.checkCaptions(); });
    this.capWarn = el('p', { class: 'hint' });
    this.scriptEl = el('textarea', { rows: 4, placeholder: 'Texto que a voz vai falar (ou que você vai ler na câmera)' });
    this.scriptEl.addEventListener('input', () => { this.scriptEdited = true; this.voice = null; this.checkCaptions(); });
    this.durEl = el('select', {}, [15, 20, 30, 45, 60].map((d) => el('option', { value: d }, `${d} segundos`)));
    this.durEl.value = store.get('clip_dur', '20');
    this.durEl.onchange = () => store.set('clip_dur', this.durEl.value);
    const box = (key, def, label) => {
      const c = el('input', { type: 'checkbox' });
      c.checked = store.get(key, def) === '1';
      c.onchange = () => { store.set(key, c.checked ? '1' : '0'); this.updateClipHints(); };
      return [c, el('label', { class: 'check' }, c, ' ' + label)];
    };
    let row;
    [this.musicEl, row] = box('clip_music', '1', 'Música de fundo (criada pelo app, livre de direitos autorais)');
    this.musicRow = row;
    [this.voiceEl, row] = box('clip_voice', '1', 'Narração com voz em português (IA grátis no seu navegador)');
    this.voiceRow = row;
    [this.orbitEl, row] = box('clip_orbit', '1', 'Giro 3D do produto (IA de profundidade)');
    this.orbitRow = row;
    this.colorEl = el('input', { type: 'color', value: store.get('clip_color', '#3483fa') });
    this.colorEl.onchange = () => store.set('clip_color', this.colorEl.value);
    this.angleEl = el('input', { type: 'file', accept: 'image/*', multiple: '' });
    this.angleEl.onchange = () => this.addAngles(this.angleEl.files);
    this.angleInfo = el('span', { class: 'hint' });
    this.angles = [];
    this.people = [];
    this.presenter = null;
    this.personEl = el('input', { type: 'file', accept: 'image/*', multiple: '' });
    this.personEl.onchange = () => this.addPeople(this.personEl.files);
    this.personInfo = el('span', { class: 'hint' });
    const promptBtn = el('button', { type: 'button', class: 'ghost' }, 'Copiar pedido');
    promptBtn.onclick = async () => {
      const text = personPrompt(this.ad, $('extraInfo').value.trim());
      try { await navigator.clipboard.writeText(text); promptBtn.textContent = 'Copiado!'; } catch { window.prompt('Copie o pedido:', text); }
      setTimeout(() => { promptBtn.textContent = 'Copiar pedido'; }, 2000);
    };
    this.personPhotoLink = el('a', { class: 'btn ghost-link', download: `${this.base}-referencia.jpg` }, 'Baixar foto para anexar');
    this.personBox = el('details', { class: 'person' },
      el('summary', {}, 'Pessoa segurando a peça (sem você aparecer, grátis)'),
      el('ol', { class: 'steps' },
        el('li', {}, this.personPhotoLink, ' e ', promptBtn, '.'),
        el('li', {}, 'Abra o ', el('a', { href: 'https://aistudio.google.com/prompts/new_chat?model=gemini-2.5-flash-image', target: '_blank', rel: 'noopener' }, 'Google AI Studio'),
          ' (grátis, entre com sua conta Google), escolha o modelo de imagem "Nano Banana", anexe a foto, cole o pedido e envie.'),
        el('li', {}, 'Baixe as fotos que ficarem boas (confira se a peça ficou igual à sua) e envie aqui:', this.personEl, this.personInfo)),
      el('p', { class: 'hint' }, 'As fotos da pessoa entram no vídeo com movimento de câmera na mão, entre as cenas da peça, com a narração por cima. A pessoa não fala na tela; a voz narra, no estilo dos vídeos de demonstração.'));
    this.camBtn = el('button', { type: 'button', class: 'ghost' }, 'Gravar apresentador (câmera)');
    this.camBtn.onclick = () => this.recordCam();
    this.camInfo = el('span', { class: 'hint' });
    this.previewBtn = el('button', { type: 'button', class: 'ghost', disabled: '' }, 'Pré-visualizar');
    this.clipBtn = el('button', { type: 'button', disabled: '' }, 'Gerar vídeo MP4');
    this.previewBtn.onclick = () => this.previewClip();
    this.clipBtn.onclick = () => this.makeClip();
    this.clipCanvas = el('canvas', { class: 'clip-view', width: W, height: H });
    this.clipOut = el('div', { class: 'clip-out' });
    this.clipMsg = el('p', { class: 'hint' }, 'Disponível quando as fotos ficarem prontas.');
    this.durNote = el('p', { class: 'hint' });
    return el('div', { class: 'clip' },
      el('div', { class: 'clip-form' },
        el('label', {}, 'Roteiro falado (a IA escreve; pode editar)', this.scriptEl),
        el('label', {}, 'Legendas das cenas (usadas quando não há narração)', this.capEl), this.capWarn,
        el('label', {}, 'Fotos da mesma peça em outros ângulos (opcional)', this.angleEl), this.angleInfo,
        this.personBox,
        this.voiceRow, this.orbitRow, this.musicRow,
        el('div', { class: 'clip-row' },
          el('label', {}, 'Duração', this.durEl),
          el('label', {}, 'Cor do destaque', this.colorEl)),
        this.durNote,
        el('div', { class: 'job-actions', style: 'justify-content:flex-start' }, this.camBtn, this.camInfo),
        el('div', { class: 'job-actions', style: 'justify-content:flex-start' }, this.previewBtn, this.clipBtn),
        this.clipMsg,
        el('p', { class: 'hint' }, 'Formato dos Clips: vertical 1080x1920 (9:16), entre 10 e 60 segundos, MP4. Sem preço, promoção, frete ou contato no vídeo. O Mercado Livre dá preferência a vídeos com uma pessoa mostrando o produto: gravar o apresentador pela câmera deixa o vídeo mais real e com mais chance de aprovação.')),
      el('div', { class: 'clip-media' }, this.clipCanvas, this.clipOut));
  }

  updateClipHints() {
    this.durEl.disabled = !!this.presenter || this.voiceEl.checked;
    this.voiceEl.disabled = !!this.presenter;
    this.durNote.textContent = this.presenter
      ? `A duração segue a sua gravação (${Math.round(this.presenter.duration)} s). A narração por IA fica desligada, porque a voz é a sua.`
      : this.voiceEl.checked ? 'A duração segue o tamanho da narração (de 10 a 60 segundos).' : '';
  }

  fillCaptions() {
    if (!this.capEdited) this.capEl.value = defaultCaptions(this.ad).join('\n');
    if (!this.scriptEdited) { this.scriptEl.value = defaultScript(this.ad, this.captions()); this.voice = null; }
    this.checkCaptions();
    this.updateClipHints();
  }

  captions() {
    return this.capEl.value.split('\n').map((s) => s.trim()).filter(Boolean);
  }

  checkCaptions() {
    const bad = [...this.captions(), this.scriptEl.value].map(forbidden).filter(Boolean);
    this.capWarn.textContent = bad.length ? `Atenção: o Mercado Livre não aceita "${bad[0]}" nos Clips (preço, promoção, frete ou contato). Tire do roteiro e das legendas.` : '';
    this.capWarn.classList.toggle('count', !!bad.length);
    this.capWarn.classList.toggle('bad', !!bad.length);
  }

  async addAngles(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    this.angleEl.value = '';
    for (const [n, f] of list.entries()) {
      try {
        const prep = await prepareProduct(f, {
          removeBg: true, aiUpscale: $('aiUpscale').checked, maxSharp: false, colorFix: $('colorFix').checked,
          onStatus: (m) => { this.angleInfo.textContent = `Foto ${n + 1} de ${list.length}: ${m}`; },
        });
        this.angles.push({ layer: prep.layer, orbit: null, depth: null });
      } catch (e) {
        console.warn('Foto de ângulo falhou', e);
      }
    }
    this.angleInfo.textContent = this.angles.length ? `${this.angles.length} foto(s) de outros ângulos no vídeo.` : 'Não consegui usar essas fotos.';
  }

  async addPeople(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    this.personEl.value = '';
    for (const f of list) {
      try { this.people.push(await createImageBitmap(f)); } catch (e) { console.warn('Foto da pessoa inválida', e); }
    }
    this.personInfo.replaceChildren(this.people.length ? `${this.people.length} foto(s) da pessoa no vídeo. ` : 'Não consegui abrir essas fotos.',
      this.people.length ? Object.assign(el('button', { type: 'button', class: 'ghost' }, 'Remover'), {
        onclick: () => { this.people = []; this.personInfo.textContent = ''; },
      }) : '');
  }

  async recordCam() {
    this.stopPreview?.();
    try {
      const rec = await recordPresenter(this.scriptEl.value.trim(), 60);
      if (!rec) return;
      if (rec.duration < 3 || !rec.frames.length) throw new Error('A gravação ficou curta demais.');
      this.presenter = rec;
      this.camInfo.replaceChildren(`Gravação de ${Math.round(rec.duration)} s pronta. `,
        Object.assign(el('button', { type: 'button', class: 'ghost' }, 'Remover'), {
          onclick: () => { this.presenter = null; this.camInfo.textContent = ''; this.updateClipHints(); },
        }));
      this.updateClipHints();
    } catch (e) {
      this.camInfo.textContent = e.message || String(e);
    }
  }

  async orbitFor(item) {
    if (!this.orbitEl.checked) return null;
    if (!item.orbit) {
      item.depth = item.depth || await estimateDepth(item.layer, (m) => { this.clipMsg.textContent = m; });
      item.orbit = makeOrbit(item.layer, item.depth);
    }
    return item.orbit;
  }

  async clipRenderer() {
    const msg = (m) => { this.clipMsg.textContent = m; };
    const load = async (id) => (this.blobs[id] ? createImageBitmap(this.blobs[id]) : null);
    const photos = { sombra: await load('sombra'), par: await load('par'), frente: await load('fundo-frente'), lado: await load('fundo-lado') };
    this.main = this.main?.layer === this.layer ? this.main : { layer: this.layer };
    msg('Preparando o giro 3D...');
    const orbit = await this.orbitFor(this.main);
    const angles = [];
    for (const a of this.angles) angles.push({ layer: a.layer, orbit: await this.orbitFor(a) });

    let duration = Number(this.durEl.value), subtitles = null, voice = null, presenter = null;
    const script = this.scriptEl.value.trim();
    if (this.presenter) {
      presenter = this.presenter;
      duration = Math.min(60, Math.max(10, presenter.duration));
      // legendas no tempo da fala, divididas pelo tamanho de cada frase
      const ss = sentences(script);
      const total = ss.reduce((n, x) => n + x.length, 0) || 1;
      let t = 0.3;
      subtitles = ss.map((x) => { const d = (presenter.duration - 0.6) * x.length / total; const r = { text: x, start: t, end: t + d }; t += d; return r; });
    } else if (this.voiceEl.checked && script) {
      try {
        if (!this.voice || this.voice.text !== script) this.voice = { text: script, ...(await speak(script, { onStatus: msg })) };
        voice = this.voice;
        duration = Math.min(60, Math.max(10, voice.buffer.duration + 1.4));
        subtitles = voice.parts.map((x) => ({ text: x.text, start: x.start + 0.4, end: x.end + 0.4 }));
      } catch (e) {
        console.warn('Narração indisponível', e);
        this.voiceWarn = 'Não consegui carregar a voz (precisa de internet na primeira vez); o vídeo saiu só com música e legendas.';
      }
    }

    const scenes = buildScenes({ layer: this.layer, orbit, angles, people: this.people, photos, captions: this.captions() });
    const overlay = {};
    const frames = presenter ? presenterFrames(presenter) : null;
    const prepare = frames ? async (t) => { overlay.presenter = await frames.at(t); } : null;
    msg('Montando a trilha sonora...');
    const sound = await makeSoundtrack({ duration, music: this.musicEl.checked, voice: voice?.buffer, presenter: presenter?.audio }).catch((e) => { console.warn(e); return null; });
    return { render: makeRenderer(scenes, duration, this.colorEl.value, { subtitles, overlay }), prepare, duration, sound };
  }

  async previewClip() {
    if (!this.layer) return;
    this.stopPreview?.();
    this.voiceWarn = '';
    this.clipBtn.disabled = this.previewBtn.disabled = true;
    let r;
    try { r = await this.clipRenderer(); } catch (e) {
      console.error(e);
      this.clipMsg.textContent = 'Erro na pré-visualização: ' + (e.message || e);
      return;
    } finally { this.clipBtn.disabled = this.previewBtn.disabled = false; }
    const { render, prepare, duration, sound } = r;
    this.clipMsg.textContent = this.voiceWarn || 'Pré-visualizando...';
    const ctx = this.clipCanvas.getContext('2d');
    this.clipCanvas.hidden = false;
    let ac = null;
    if (sound) {
      ac = new AudioContext();
      const src = ac.createBufferSource();
      src.buffer = sound;
      src.connect(ac.destination);
      src.start();
    }
    const t0 = performance.now();
    let stop = false;
    this.stopPreview = () => { stop = true; ac?.close(); this.stopPreview = null; };
    const tick = async () => {
      if (stop) return;
      const t = Math.min((performance.now() - t0) / 1000, duration - 0.001);
      if (prepare) await prepare(t);
      render(ctx, t);
      if (t < duration - 0.01) requestAnimationFrame(tick); else this.stopPreview?.();
    };
    tick();
  }

  async makeClip() {
    if (!this.layer) return;
    this.stopPreview?.();
    this.voiceWarn = '';
    this.clipBtn.disabled = this.previewBtn.disabled = this.camBtn.disabled = true;
    try {
      const { render, prepare, duration, sound } = await this.clipRenderer();
      const res = await recordClip({
        render, prepare, duration, music: sound,
        onProgress: (p) => { this.clipMsg.textContent = `Gravando o vídeo... ${Math.round(p * 100)}%`; },
      });
      if (this.clipUrl) URL.revokeObjectURL(this.clipUrl);
      this.clipUrl = URL.createObjectURL(res.blob);
      this.clipBlob = res.blob;
      this.clipExt = res.ext;
      this.clipCanvas.hidden = true;
      const mb = (res.blob.size / 1048576).toFixed(1);
      this.clipOut.replaceChildren(
        el('video', { src: this.clipUrl, controls: '', playsinline: '', class: 'clip-view' }),
        el('a', { class: 'btn', href: this.clipUrl, download: `${this.base}-clip.${res.ext}` }, `Baixar vídeo (${res.ext.toUpperCase()}, ${mb} MB)`));
      const warn = [res.warning, this.voiceWarn].filter(Boolean).join(' ');
      this.clipMsg.textContent = warn || `Vídeo pronto: ${Math.round(duration)} s, 1080x1920, ${res.ext.toUpperCase()}.`;
      this.clipMsg.classList.toggle('warn', !!warn);
    } catch (e) {
      console.error(e);
      this.clipMsg.textContent = 'Erro ao gravar o vídeo: ' + (e.message || e);
    } finally {
      this.clipBtn.disabled = this.previewBtn.disabled = this.camBtn.disabled = false;
    }
  }

  // ---------- conferência ----------

  renderChecks() {
    const c = this.check, p = this.prep;
    const items = [];
    const add = (ok, text) => items.push(el('li', { class: ok === true ? 'c-ok' : ok === false ? 'c-bad' : 'c-warn' }, text));
    add(c.width === 1200 && c.height === 1200, `Tamanho ${c.width}x${c.height} px (recomendado pelo Mercado Livre: 1200x1200).`);
    add(c.whiteBorder > 0.995, c.whiteBorder > 0.995 ? 'Fundo branco puro nas bordas.' : 'O fundo não está totalmente branco nas bordas; confira o recorte.');
    const pct = Math.round(c.fill * 100);
    add(pct >= 80 && pct <= 95 ? true : 'warn', `O produto ocupa ${pct}% da foto (o ideal é entre 80% e 95%).`);
    if (p.detail < 0.7) {
      add('warn', `A foto original estava borrada (parece ter sido ampliada antes, com detalhe de uma foto ${Math.round(1 / p.detail * 10) / 10}x menor). ${p.usedAi ? 'A IA reconstruiu os detalhes,' : 'Ela foi ajustada,'} mas a foto original de melhor qualidade sempre sai melhor.`);
    }
    if (p.srcW < 500 && p.srcH < 500) {
      add('warn', `A foto original do produto tem só ${p.srcW}x${p.srcH} px. ${p.usedAi ? 'Foi ampliada com IA,' : 'Foi ampliada,'} mas uma foto maior sai mais nítida.`);
    } else {
      add(true, `Foto original com boa resolução (${p.srcW}x${p.srcH} px no produto).`);
    }
    if (!p.removed && $('removeBg').checked) add(false, 'Não foi possível remover o fundo automaticamente.');
    const f = this.ad?.foto;
    if (f) {
      add(!f.tem_texto_logo_ou_marca_dagua, f.tem_texto_logo_ou_marca_dagua
        ? 'A IA viu texto, logo ou marca d’água na foto. A foto principal deve estar limpa.'
        : 'Sem texto, logo ou marca d’água na foto.');
      (f.problemas || []).filter(Boolean).forEach((t) => add('warn', t));
    }
    this.checkEl.replaceChildren(el('ul', { class: 'checklist' }, items));
  }

  // ---------- anúncio ----------

  async runAd() {
    if (!this.whiteBlob) return;
    this.regenBtn.disabled = true;
    try {
      this.ad = await generateAd(this.whiteBlob, {
        key: store.get('gemini_key', '') || $('apiKey').value.trim(),
        model: store.get('gemini_model', '') || $('model').value.trim() || 'gemini-2.5-flash',
        useSearch: store.get('use_search', '1') === '1',
        extra: $('extraInfo').value.trim(),
        onStatus: (m) => this.status(m),
      });
      this.renderAd();
      this.renderChecks();
      this.fillCaptions();
    } catch (e) {
      console.error(e);
      this.status(e.message || String(e), true);
      if (/chave/i.test(e.message)) $('config').open = true;
    } finally {
      this.regenBtn.disabled = false;
    }
  }

  renderAd() {
    const ad = this.ad;
    const body = this.adEl;
    body.replaceChildren();
    const t = ad.titulo || '';
    const count = el('span', { class: 'count' + (t.length > 60 ? ' bad' : '') }, ` ${t.length}/60 caracteres`);
    body.append(el('p', { class: 'hint' }, `Produto identificado: ${ad.produto_identificado || '-'}`));
    if (ad.categoria_sugerida) body.append(el('p', { class: 'hint' }, `Categoria sugerida: ${ad.categoria_sugerida}`));
    if (ad.fundo?.descricao) body.append(el('p', { class: 'hint' }, `Veículo das fotos 4 e 5: ${ad.fundo.descricao}`));
    body.append(field('Título', el('div', {}, el('div', { class: 'box title' }, t), count), t));
    (ad.titulos_alternativos || []).forEach((alt, i) =>
      body.append(field(`Título alternativo ${i + 1}`, el('div', { class: 'box' }, `${alt}  (${alt.length}/60)`), alt)));
    body.append(field('Descrição', el('div', { class: 'box' }, ad.descricao || ''), ad.descricao || ''));
    const ficha = ad.ficha_tecnica || [];
    if (ficha.length) {
      body.append(field('Ficha técnica', el('table', {}, ficha.map((f) =>
        el('tr', {}, el('td', {}, f.atributo), el('td', {}, String(f.valor))))), fichaText(ad)));
    }
    const kw = ad.palavras_chave || [];
    if (kw.length) body.append(field('Palavras-chave', el('div', { class: 'tags' }, kw.map((k) => el('span', {}, k))), kw.join(', ')));
    const faq = ad.perguntas_frequentes || [];
    if (faq.length) {
      const txt = faq.map((f) => `P: ${f.pergunta}\nR: ${f.resposta}`).join('\n\n');
      body.append(field('Perguntas frequentes', el('div', { class: 'box' }, txt), txt));
    }
    if (ad.dicas) body.append(field('Dicas antes de publicar', el('div', { class: 'warn' }, ad.dicas)));
    const fontes = (ad._fontes || []).filter((f) => f.uri);
    const info = ad._pesquisou
      ? `Gerado com ${ad._modelo} usando pesquisa no Google.`
      : `Gerado com ${ad._modelo} sem pesquisa na web (cota da pesquisa indisponível ou desativada).`;
    body.append(el('div', { class: 'field sources' }, el('p', {}, info),
      fontes.length ? el('p', {}, 'Fontes consultadas: ', fontes.flatMap((f, i) => [
        i ? ', ' : '', el('a', { href: f.uri, target: '_blank', rel: 'noopener' }, f.title || `fonte ${i + 1}`)])) : null));
  }

  adText() {
    const ad = this.ad;
    if (!ad) return null;
    return [
      `TÍTULO\n${ad.titulo || ''}`,
      (ad.titulos_alternativos || []).length ? `TÍTULOS ALTERNATIVOS\n${ad.titulos_alternativos.join('\n')}` : '',
      `CATEGORIA\n${ad.categoria_sugerida || ''}`,
      `DESCRIÇÃO\n${ad.descricao || ''}`,
      (ad.ficha_tecnica || []).length ? `FICHA TÉCNICA\n${fichaText(ad)}` : '',
      (ad.palavras_chave || []).length ? `PALAVRAS-CHAVE\n${ad.palavras_chave.join(', ')}` : '',
      (ad.perguntas_frequentes || []).length
        ? `PERGUNTAS FREQUENTES\n${ad.perguntas_frequentes.map((f) => `P: ${f.pergunta}\nR: ${f.resposta}`).join('\n\n')}` : '',
    ].filter(Boolean).join('\n\n');
  }
}

function fichaText(ad) {
  return (ad.ficha_tecnica || []).map((f) => `${f.atributo}: ${f.valor}`).join('\n');
}

// ---------- lote ----------

function updateBatchBar() {
  const ready = jobs.filter((j) => j.blobs.branco).length;
  $('batchBar').hidden = !jobs.length;
  $('batchInfo').textContent = `${ready} de ${jobs.length} foto(s) prontas`;
}

function addFiles(files) {
  const imgs = [...files].filter((f) => f.type.startsWith('image/'));
  if (!imgs.length) return status('Escolha arquivos de imagem.', true);
  for (const f of imgs) {
    const job = new Job(f, jobs.length);
    jobs.push(job);
    queue = queue.then(() => job.run()).catch((e) => console.error(e));
  }
  updateBatchBar();
  queue.then(() => status(jobs.length > 1 ? 'Todas as fotos foram processadas.' : $('status').textContent));
}

async function downloadZip() {
  const files = [];
  const used = new Set();
  for (const j of jobs) {
    let dir = j.base, n = 2;
    while (used.has(dir)) dir = `${j.base}-${n++}`;
    used.add(dir);
    for (const s of SLOTS) if (j.blobs[s.id]) files.push({ name: `${dir}/${j.fileName(s.id)}`, data: j.blobs[s.id] });
    const txt = j.adText();
    if (txt) files.push({ name: `${dir}/anuncio.txt`, data: txt });
    if (j.clipBlob) files.push({ name: `${dir}/${j.base}-clip.${j.clipExt}`, data: j.clipBlob });
  }
  if (!files.length) return;
  const zip = await makeZip(files);
  const a = el('a', { href: URL.createObjectURL(zip), download: 'anuncios.zip' });
  document.body.append(a);
  a.click();
  a.remove();
}

loadConfig();
$('saveConfig').onclick = saveConfig;
$('file').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
$('dlZip').onclick = downloadZip;
for (const [id, key] of Object.entries(CHECKS)) {
  $(id).addEventListener('change', () => store.set(key, $(id).checked ? '1' : '0'));
}
$('mirrorPair').addEventListener('change', () => jobs.forEach((j) => j.renderPair()));
$('bgOpacity').addEventListener('input', () => { $('bgOpacityVal').textContent = `${$('bgOpacity').value}%`; });
$('bgOpacity').addEventListener('change', () => {
  store.set('bg_opacity_v2', $('bgOpacity').value);
  jobs.forEach((j) => j.renderScenes());
});
$('bgFile').addEventListener('change', () => {
  userBackdrop = null;
  jobs.forEach((j) => { j.candidates = null; j.candIdx = -1; if (j.layer) j.nextBackdrop(); });
});

const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });
window.addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files || [])].filter((x) => x.type.startsWith('image/'));
  if (f.length) addFiles(f);
});

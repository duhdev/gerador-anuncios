import { prepareProduct, renderWhite, renderShadow, renderPair, checkPhoto, toBlob } from './imagem.js';
import { renderInUse, renderConversion, renderSides } from './artes.js';
import { generateAd, generateScene, generateInUse, fetchImageUrl } from './ia.js';
import { makeZip } from './zip.js';
import { W, H, buildScenes, makeRenderer, transitionTimes, makeSoundtrack, recordClip, defaultCaptions, defaultScript, forbidden } from './clip.js';
import { estimateDepth, makeOrbit } from './tresd.js';
import { speak, sentences } from './voz.js';
import { recordPresenter, presenterFrames } from './apresentador.js';
import { avatarPrompt, importAvatar, drawCover } from './avatar.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

const SLOTS = [
  { id: 'branco', label: 'Fundo branco (principal)', png: true },
  { id: 'sombra', label: 'Com sombra', png: true },
  { id: 'par', label: 'Par do produto' },
  { id: 'ambiente', label: 'Em uso na vida real (desejo)' },
  { id: 'conversao', label: 'Benefícios (convencer)' },
  { id: 'lados', label: 'Qual é o lado (certeza)' },
];
const ARTS = ['ambiente', 'conversao', 'lados'];

const jobs = [];
let queue = Promise.resolve();
let bgFromUrl = null;      // foto do veículo em uso vinda de um link
let geminiImageOff = false; // a chave não tem cota para o modelo de imagem do Gemini

// ---------- configurações ----------

const CHECKS = { removeBg: 'remove_bg', aiUpscale: 'ai_upscale', maxSharp: 'max_sharp', colorFix: 'color_fix', mirrorPair: 'mirror_pair_v2' };

function loadConfig() {
  $('apiKey').value = store.get('gemini_key', '');
  $('model').value = store.get('gemini_model', 'gemini-2.5-flash');
  $('useSearch').checked = store.get('use_search', '1') === '1';
  for (const [id, key] of Object.entries(CHECKS)) $(id).checked = store.get(key, id === 'maxSharp' ? '0' : '1') === '1';
  if (!$('apiKey').value) $('config').open = true;
}

function openConfig() {
  $('config').open = true;
  $('config').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => $('apiKey').focus(), 300);
}

function keyState() {
  const ok = !!store.get('gemini_key', '');
  $('keyDot').classList.toggle('ok', ok);
  $('openConfig').lastChild.textContent = ok ? ' IA configurada' : ' Configurar IA';
}

function saveConfig() {
  store.set('gemini_key', $('apiKey').value.trim());
  store.set('gemini_model', $('model').value.trim() || 'gemini-2.5-flash');
  store.set('use_search', $('useSearch').checked ? '1' : '0');
  keyState();
  toast($('apiKey').value.trim() ? 'Configurações salvas.' : 'Salvo, mas falta a chave.');
  if ($('apiKey').value.trim()) $('config').open = false;
}

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

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
}

function copyButton(getText) {
  const b = el('button', { class: 'ghost', type: 'button' }, 'Copiar');
  b.onclick = async () => {
    try { await navigator.clipboard.writeText(getText()); toast('Copiado!'); }
    catch { toast('Não deu para copiar; selecione o texto e copie.'); }
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
    this.scene = null;       // foto do ambiente da foto 4
    this.ad = null;
    this.prep = null;
    this.buildUi();
  }

  buildUi() {
    this.statusEl = el('p', { class: 'status' }, 'Na fila...');
    this.grid = el('div', { class: 'grid' });
    this.checkEl = el('div', { class: 'checks' }, el('p', { class: 'empty' }, 'Aparece quando as fotos ficarem prontas.'));
    this.adEl = el('div', {}, el('p', { class: 'empty' }, 'O anúncio aparece aqui assim que a foto principal ficar pronta.'));
    this.regenBtn = el('button', { type: 'button', class: 'ghost' }, 'Gerar de novo');
    this.bgBtn = el('button', { type: 'button', class: 'ghost' }, 'Gerar outra cena (foto 4)');
    this.usePromptBtn = el('button', { type: 'button', class: 'ghost' }, 'Copiar pedido da foto 4 para o app Gemini');
    this.usePromptBtn.onclick = async () => {
      try { await navigator.clipboard.writeText(this.inUsePromptPt()); toast('Pedido copiado. Cole no app Gemini e anexe a foto 1 (fundo branco).'); }
      catch { toast('Não consegui copiar. Tente de novo.'); }
    };
    this.useFile = el('input', { type: 'file', accept: 'image/*', hidden: '' });
    this.useFile.onchange = async () => {
      const f = this.useFile.files[0];
      this.useFile.value = '';
      if (!f) return;
      this.ownScene = { bmp: await createImageBitmap(f), inset: false };
      this.renderAmbient(false);
    };
    this.useBtn = el('button', { type: 'button', class: 'ghost' }, 'Usar minha imagem na foto 4');
    this.useBtn.onclick = () => this.useFile.click();
    this.regenBtn.onclick = () => this.runAd().then(() => this.ad && this.renderArts(false));
    this.bgBtn.onclick = () => { this.ownScene = null; this.renderAmbient(true); };
    this.slotEls = {};
    SLOTS.forEach((s, i) => {
      const fig = el('figure', { class: 'card slot' },
        el('div', { class: 'placeholder' }, 'Aguardando...'),
        el('figcaption', {}, `${i + 1}. ${s.label}`));
      this.slotEls[s.id] = fig;
      this.grid.append(fig);
    });
    // etapas mostradas no topo do cartão
    this.stepEls = {};
    const steps = [['foto', 'Fotos'], ['anuncio', 'Anúncio'], ['artes', 'Fotos 4 a 6'], ['video', 'Vídeo']];
    const bar = el('div', { class: 'steps-bar' }, steps.map(([k, n]) => (this.stepEls[k] = el('span', { class: 'stp' }, n))));
    this.titleEl = el('h2', {}, this.file.name);
    const thumb = el('img', { class: 'thumb', alt: '' });
    thumb.src = URL.createObjectURL(this.file);

    // abas
    const panes = {
      fotos: ['Fotos', el('div', {}, el('div', { class: 'panel-actions' }, this.bgBtn, this.usePromptBtn, this.useBtn, this.useFile), this.grid)],
      anuncio: ['Anúncio', el('div', {}, el('div', { class: 'panel-actions' }, this.regenBtn), this.adEl)],
      video: ['Vídeo para Clips', this.buildClipUi()],
      conferencia: ['Conferência', this.checkEl],
    };
    this.tabEls = {};
    this.paneEls = {};
    const tabs = el('div', { class: 'tabs', role: 'tablist' });
    const body = el('div', {});
    for (const [k, [name, content]] of Object.entries(panes)) {
      const t = el('button', { type: 'button', class: 'tab', role: 'tab' }, name);
      t.onclick = () => this.showTab(k);
      this.tabEls[k] = t;
      tabs.append(t);
      this.paneEls[k] = el('div', { class: 'panel', role: 'tabpanel' }, content);
      body.append(this.paneEls[k]);
    }
    this.root = el('section', { class: 'card job' },
      el('div', { class: 'job-head' }, thumb,
        el('div', { class: 'job-title' }, this.titleEl, this.statusEl), bar),
      tabs, body);
    this.showTab('fotos');
    $('jobs').append(this.root);
  }

  showTab(k) {
    for (const [n, t] of Object.entries(this.tabEls)) {
      t.classList.toggle('on', n === k);
      t.setAttribute('aria-selected', n === k);
      this.paneEls[n].hidden = n !== k;
    }
    if (k !== 'video') this.stopPreview?.();
  }

  badge(k, text, err = false) {
    const t = this.tabEls[k];
    t.querySelector('.badge')?.remove();
    if (text) t.append(' ', el('span', { class: 'badge' + (err ? ' err' : '') }, text));
  }

  step(k, state) {
    this.stepEls[k].className = 'stp' + (state ? ' ' + state : '');
  }

  status(msg, err = false, busy = !err) {
    this.statusEl.replaceChildren(...(busy && msg ? [el('span', { class: 'spin' })] : []), msg || '');
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
    const blob = await (SLOTS.find((s) => s.id === id).png ? toBlob(cnv, 'image/png') : toBlob(cnv));
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
    const i = SLOTS.findIndex((s) => s.id === id);
    return `${this.base}-${i + 1}-${id}.${SLOTS[i].png ? 'png' : 'jpg'}`;
  }

  async renderPair() {
    if (this.layer) await this.setSlot('par', renderPair(this.layer, $('mirrorPair').checked));
  }


  async run() {
    this.step('foto', 'work');
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
      this.step('foto', 'done');
    } catch (e) {
      console.error(e);
      this.step('foto', 'fail');
      this.status('Erro ao tratar a foto: ' + (e.message || e), true);
      return;
    }

    ARTS.forEach((id) => this.slotMessage(id, 'Aguardando o anúncio da IA...'));
    await this.runAd();
    await this.renderArts(true);
    this.fillCaptions();
    this.clipBtn.disabled = this.previewBtn.disabled = false;
    if (this.ad) this.status('Pronto! Confira os campos marcados com [CONFIRMAR] antes de publicar.', false, false);
    else this.status(`Fotos prontas, mas o anúncio não foi gerado: ${this.adError || 'erro desconhecido'}`, true);
    updateBatchBar();
  }

  // ---------- fotos 4, 5 e 6: a história do anúncio ----------

  // lado e posição: da IA; sem ela, das informações extras e do título
  sideInfo() {
    const l = this.ad?.lado || {};
    const txt = `${$('extraInfo').value} ${this.ad?.titulo || ''} ${this.ad?.produto_identificado || ''}`.toLowerCase();
    const one = (v, ok) => (ok.includes(v) ? v : null);
    let vendido = one(l.vendido, ['esquerdo', 'direito', 'par', 'indefinido', 'nao_se_aplica']);
    if (!vendido || vendido === 'indefinido') {
      vendido = /\bpar\b|os dois lados|direito e esquerdo|esquerdo e direito/.test(txt) ? 'par'
        : /esquerd|\ble\b|motorista/.test(txt) ? 'esquerdo'
        : /direit|\bld\b|passageiro/.test(txt) ? 'direito' : vendido;
    }
    let posicao = one(l.posicao, ['dianteira', 'traseira', 'lateral', 'nao_se_aplica']);
    if (!posicao) {
      posicao = /lanterna|traseir|para-choque tras/.test(txt) ? 'traseira'
        : /farol|dianteir|milha|pisca/.test(txt) ? 'dianteira'
        : /retrovisor|espelho|lateral/.test(txt) ? 'lateral' : null;
    }
    return {
      vendido: ['esquerdo', 'direito', 'par'].includes(vendido) ? vendido : null,
      foto: one(l.foto, ['esquerdo', 'direito']),
      posicao,
      semLado: vendido === 'nao_se_aplica' || posicao === 'nao_se_aplica' || !posicao,
    };
  }

  convInfo() {
    const f = this.ad?.foto_conversao;
    if (!f) return null;
    const clean = (t, n) => (t && !forbidden(t) ? String(t).trim().slice(0, n) : '');
    const beneficios = (f.beneficios || []).map((b) => clean(b, 40)).filter(Boolean).slice(0, 3);
    const titulo = clean(f.titulo, 48) || clean(this.ad.clip_legendas?.[0], 48);
    if (!titulo || !beneficios.length) return null;
    return { titulo, beneficios, compatibilidade: clean(f.compatibilidade, 60), selo: clean(f.selo, 18) };
  }

  async renderArts(withAmbient = true) {
    if (!this.layer) return;
    this.step('artes', 'work');
    const conv = this.convInfo();
    if (conv) await this.setSlot('conversao', renderConversion(this.layer, conv));
    else this.slotMessage('conversao', this.ad ? 'A IA não mandou os benefícios. Clique em "Gerar de novo" na aba Anúncio.' : 'Esta foto usa os benefícios escritos pela IA. Gere o anúncio para montá-la.');
    await this.renderSidesSlot();
    if (withAmbient) await this.renderAmbient(false);
    this.step('artes', this.blobs.ambiente && this.blobs.conversao ? 'done' : 'fail');
  }

  async renderSidesSlot() {
    const info = this.sideInfo();
    if (info.semLado) {
      this.slotMessage('lados', 'Este produto não tem lado (direito/esquerdo), então esta foto não é necessária. Se tiver, escreva o lado e a peça em "Informações extras".');
      return;
    }
    await this.setSlot('lados', renderSides(this.layer, info));
  }

  inUsePromptPt() {
    const cena = this.ad?.foto_uso_pt || `o veículo compatível${this.ad?.fundo?.descricao ? ` (${this.ad.fundo.descricao})` : ''} rodando no trânsito da cidade, com a peça bem visível`;
    return `Crie uma foto realista e quadrada (1:1) da peça da foto anexada, exatamente igual (mesmo formato, cores e detalhes), instalada no lugar certo e em uso na vida real: ${cena}. A peça precisa aparecer com clareza. Sem texto, sem logotipos, sem marca d'água.`;
  }

  // Foto 4: o produto em uso na vida real. Ordem: imagem do usuário; Gemini
  // com a peça instalada (se a chave tiver cota de imagem); cena por IA grátis
  // com a peça num quadro; senão, aviso com o pedido para o app Gemini.
  async renderAmbient(newScene) {
    if (!this.layer) return;
    const g = bgFromUrl || $('bgFile').files[0];
    let use = this.ownScene || (g ? { bmp: await createImageBitmap(g).catch(() => null), inset: true } : null);
    if (!use?.bmp) {
      if (newScene || !this.scene) {
        this.slotMessage('ambiente', 'Criando a foto do produto em uso...');
        const veic = this.ad?.fundo?.descricao || this.ad?.fundo?.busca || $('extraInfo').value.trim();
        const prompt = this.ad?.foto_uso_en
          || `${veic || 'the compatible vehicle'} driving in city traffic at dusk, the part clearly visible, realistic photo, DSLR`;
        const key = store.get('gemini_key', '') || $('apiKey').value.trim();
        this.scene = null;
        if (!geminiImageOff && key) {
          try {
            this.status('O Gemini está criando a foto do produto em uso...');
            this.scene = { bmp: await createImageBitmap(await generateInUse(this.whiteBlob, prompt, key)), inset: false };
          } catch (e) {
            console.warn('Imagem do Gemini indisponível', e);
            if (e.status === 429 || e.status === 403 || e.status === 404 || e.status === 400) geminiImageOff = true;
          }
        }
        if (!this.scene) {
          try {
            this.status('Criando a cena do produto em uso com IA grátis...');
            this.scene = { bmp: await createImageBitmap(await generateScene(prompt)), inset: true };
          } catch (e) {
            console.warn('Cena por IA grátis indisponível', e);
          }
        }
      }
      use = this.scene;
    }
    if (!use?.bmp) {
      this.slotMessage('ambiente', 'As IAs de imagem grátis não responderam agora. Clique em "Gerar outra cena", ou use "Copiar pedido da foto 4 para o app Gemini", gere a imagem lá e envie em "Usar minha imagem na foto 4".');
      return;
    }
    await this.setSlot('ambiente', renderInUse(this.layer, use.bmp, use.inset));
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
      return [c, el('label', { class: 'switch' }, c, el('span'), ' ' + label)];
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
    this.presenter = null;
    this.camBtn = el('button', { type: 'button', class: 'ghost' }, 'Gravar apresentador (câmera)');
    this.camBtn.onclick = () => this.recordCam();
    this.camInfo = el('span', { class: 'hint' });
    this.avatar = null;
    this.avatarFile = el('input', { type: 'file', accept: 'video/*', hidden: '' });
    this.avatarFile.onchange = () => this.loadAvatar(this.avatarFile.files[0]);
    this.avatarInfo = el('span', { class: 'hint' });
    const promptBtn = el('button', { type: 'button', class: 'ghost' }, '1. Copiar pedido para o Gemini');
    promptBtn.onclick = async () => {
      try { await navigator.clipboard.writeText(avatarPrompt(this.ad, this.scriptEl.value.trim())); toast('Pedido copiado. Cole no Gemini junto com a foto do produto.'); }
      catch { toast('Não consegui copiar. Tente de novo.'); }
    };
    const photoBtn = el('button', { type: 'button', class: 'ghost' }, '2. Baixar foto do produto');
    photoBtn.onclick = () => {
      const b = this.blobs.branco;
      if (!b) return toast('A foto ainda está sendo preparada.');
      const a = el('a', { href: URL.createObjectURL(b), download: `${this.base}-produto.jpg` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
    const importBtn = el('button', { type: 'button', class: 'ghost' }, '3. Importar vídeo do avatar');
    importBtn.onclick = () => this.avatarFile.click();
    this.avatarBox = el('div', { class: 'avatar-box' },
      el('strong', {}, 'Avatar feito no Gemini (opcional)'),
      el('p', { class: 'hint' }, 'Com a sua assinatura do Gemini, gere no app Gemini (ou no Flow) uma pessoa segurando o produto e falando. Envie o pedido e a foto, baixe o vídeo e importe aqui: ele vira a abertura do Clips, com a voz do avatar, e depois entram as cenas do produto.'),
      el('div', { class: 'job-actions', style: 'justify-content:flex-start' }, promptBtn, photoBtn, importBtn),
      this.avatarFile, this.avatarInfo);
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
        this.voiceRow, this.orbitRow, this.musicRow,
        el('div', { class: 'clip-row' },
          el('label', {}, 'Duração', this.durEl),
          el('label', {}, 'Cor do destaque', this.colorEl)),
        this.durNote,
        this.avatarBox,
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

  async loadAvatar(file) {
    this.avatarFile.value = '';
    if (!file) return;
    this.stopPreview?.();
    try {
      const av = await importAvatar(file, (m) => { this.avatarInfo.textContent = m; });
      this.avatar = av;
      this.avatarInfo.replaceChildren(`Avatar de ${Math.round(av.duration)} s na abertura${av.audio ? ', com a voz dele' : ' (sem som)'}. `,
        Object.assign(el('button', { type: 'button', class: 'ghost' }, 'Remover'), {
          onclick: () => { this.avatar = null; this.avatarInfo.textContent = ''; },
        }));
    } catch (e) {
      console.warn(e);
      this.avatarInfo.textContent = e.message || String(e);
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
    const photos = { sombra: await load('sombra'), par: await load('par'), frente: await load('ambiente'), lado: await load('lados') };
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

    // avatar do Gemini na abertura: as cenas do produto vêm depois dele
    const avatar = this.avatar;
    const introDur = avatar ? avatar.duration : 0;
    if (avatar) duration = Math.min(duration, Math.max(6, 60 - introDur));
    const scenes = buildScenes({
      layer: this.layer, orbit, angles, photos, captions: this.captions(),
      vehicle: (this.ad?.fundo?.busca || '').slice(0, 28), mirror: $('mirrorPair').checked, color: this.colorEl.value,
    });
    const overlay = {};
    const frames = presenter ? presenterFrames(presenter) : null;
    const prepare = frames ? async (t) => { overlay.presenter = await frames.at(t); } : null;
    msg('Montando a trilha sonora...');
    const render = makeRenderer(scenes, duration, this.colorEl.value, { subtitles, overlay });
    if (!avatar) {
      const sound = await makeSoundtrack({ duration, music: this.musicEl.checked, voice: voice?.buffer, presenter: presenter?.audio, whooshes: transitionTimes(scenes, duration) }).catch((e) => { console.warn(e); return null; });
      return { render, prepare, duration, sound };
    }
    const total = introDur + duration;
    const sound = await makeSoundtrack({
      duration: total, music: this.musicEl.checked, voice: voice?.buffer, voiceAt: introDur + 0.4,
      presenter: presenter?.audio, presenterAt: introDur, intro: avatar.audio,
      whooshes: [introDur, ...transitionTimes(scenes, duration).map((x) => x + introDur)],
    }).catch((e) => { console.warn(e); return null; });
    const af = presenterFrames(avatar);
    let img = null;
    return {
      duration: total, sound,
      prepare: async (t) => {
        if (t < introDur) img = await af.at(t);
        else if (prepare) await prepare(t - introDur);
      },
      render: (ctx, t) => {
        if (t >= introDur) return render(ctx, t - introDur);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        if (img) drawCover(ctx, img, W, H);
        const fade = Math.max(t < 0.25 ? 1 - t / 0.25 : 0, t > introDur - 0.3 ? (t - introDur + 0.3) / 0.3 : 0);
        if (fade > 0) { ctx.fillStyle = `rgba(0,0,0,${Math.min(1, fade)})`; ctx.fillRect(0, 0, W, H); }
      },
    };
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
      this.step('video', 'done');
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
    const bad = items.filter((li) => li.className !== 'c-ok').length;
    this.badge('conferencia', bad ? String(bad) : '');
  }

  // ---------- anúncio ----------

  async runAd() {
    if (!this.whiteBlob) return;
    this.regenBtn.disabled = true;
    this.step('anuncio', 'work');
    this.adError = '';
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
      this.step('anuncio', 'done');
      this.badge('anuncio', '');
      if (this.ad.produto_identificado) this.titleEl.textContent = this.ad.produto_identificado;
    } catch (e) {
      console.error(e);
      this.adError = e.message || String(e);
      this.step('anuncio', 'fail');
      this.badge('anuncio', '!', true);
      this.status(this.adError, true);
      const retry = el('button', { type: 'button' }, 'Tentar de novo');
      retry.onclick = () => this.runAd().then(() => { if (this.ad) { this.status('Anúncio gerado.', false, false); this.renderArts(false); } });
      const cfg = el('button', { type: 'button', class: 'ghost' }, 'Abrir configurações da IA');
      cfg.onclick = openConfig;
      this.adEl.replaceChildren(el('div', { class: 'err-box' },
        el('strong', {}, 'O anúncio não foi gerado'), el('span', {}, this.adError), el('div', { class: 'row' }, retry, cfg)));
      if (/Chave da API inválida|Cole sua chave|não tem permissão/i.test(this.adError)) openConfig();
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
    body.append(el('div', { class: 'ad-meta' },
      el('span', {}, `Produto: ${ad.produto_identificado || '-'}`),
      ad.categoria_sugerida ? el('span', {}, `Categoria: ${ad.categoria_sugerida}`) : null,
      ad.fundo?.descricao ? el('span', {}, `Veículo: ${ad.fundo.descricao}`) : null));
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
keyState();
$('saveConfig').onclick = saveConfig;
$('openConfig').onclick = () => ($('config').open ? ($('config').open = false) : openConfig());
$('file').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
$('dlZip').onclick = downloadZip;
for (const [id, key] of Object.entries(CHECKS)) {
  $(id).addEventListener('change', () => store.set(key, $(id).checked ? '1' : '0'));
}
$('mirrorPair').addEventListener('change', () => jobs.forEach((j) => j.renderPair()));
function changeBackdrop() {
  jobs.forEach((j) => j.layer && j.renderAmbient(false));
}
$('bgFile').addEventListener('change', () => { bgFromUrl = null; $('bgUrlMsg').textContent = ''; changeBackdrop(); });
$('bgUrlForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter;
  btn.disabled = true;
  $('bgUrlMsg').textContent = 'Baixando a foto...';
  try {
    bgFromUrl = await fetchImageUrl($('bgUrl').value);
    $('bgFile').value = '';
    $('bgUrlMsg').textContent = 'Foto carregada pelo link.';
    $('bgUrl').value = '';
    changeBackdrop();
  } catch (err) {
    $('bgUrlMsg').textContent = err.message;
  } finally { btn.disabled = false; }
});

async function addUrls(urls) {
  const btn = $('urlForm').querySelector('button');
  btn.disabled = true;
  const files = [];
  for (const u of urls) {
    status(`Baixando a imagem do link${urls.length > 1 ? ` (${files.length + 1} de ${urls.length})` : ''}...`, false);
    try { files.push(await fetchImageUrl(u)); } catch (err) { status(err.message, true); }
  }
  btn.disabled = false;
  if (files.length) { $('imgUrl').value = ''; addFiles(files); }
}
// aceita vários links separados por espaço ou quebra de linha
$('urlForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const urls = $('imgUrl').value.split(/\s+/).filter(Boolean);
  if (urls.length) addUrls(urls);
});

const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  if (e.dataTransfer.files.length) return addFiles(e.dataTransfer.files);
  // imagem arrastada de outra aba do navegador chega como link
  const u = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).split('\n').find((x) => /^https?:/.test(x.trim()));
  if (u) addUrls([u.trim()]);
});
window.addEventListener('paste', (e) => {
  const f = [...(e.clipboardData?.files || [])].filter((x) => x.type.startsWith('image/'));
  if (f.length) return addFiles(f);
  // link colado fora de um campo de texto também vira foto
  const t = e.clipboardData?.getData('text/plain')?.trim();
  if (t && /^https?:\/\/\S+$/.test(t) && !e.target.closest?.('input, textarea')) addUrls([t]);
});

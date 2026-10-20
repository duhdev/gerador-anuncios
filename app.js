import {
  prepareProduct, prepareBackdrop, renderWhite, renderShadow, renderPair,
  renderSceneFront, renderSceneSide, checkPhoto, toBlob, setPartBox,
} from './imagem.js';
import { generateAd, generateBackdrop, searchBackdrops, fetchImage, pickBackdrops } from './ia.js';
import { makeZip } from './zip.js';

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

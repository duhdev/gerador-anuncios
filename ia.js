// Geração do anúncio com o Google Gemini (camada gratuita da API).
const API = 'https://generativelanguage.googleapis.com/v1beta/models/';
const FALLBACK_MODEL = 'gemini-2.5-flash-lite';

function hoje() {
  return new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function prompt(extra, comBusca) {
  return `Você é especialista em anúncios do Mercado Livre Brasil. Hoje é ${hoje()}.

1. Olhe a foto e identifique exatamente qual é o produto (tipo, material, cor, formato, marca/modelo se aparecerem).
${extra ? `   Informações do vendedor sobre o produto: "${extra}". Use-as como verdade.\n` : ''}${comBusca ? `2. Pesquise no Google como estão os anúncios MAIS VENDIDOS deste tipo de produto no Mercado Livre agora (mercadolivre.com.br), e as regras/boas práticas atuais do Mercado Livre para título e descrição. Use o padrão de estrutura que mais converte hoje para essa categoria.
` : `2. Use o padrão de estrutura de anúncio que mais converte hoje no Mercado Livre para essa categoria.
`}3. Escreva o anúncio seguindo as regras do Mercado Livre:
   - Título com no máximo 60 caracteres: Produto + Marca + Modelo + característica principal. Sem emojis, sem CAPS LOCK, sem palavras como "promoção", "frete grátis", "oferta".
   - Descrição em texto puro (sem HTML, sem emojis, sem links, sem telefone ou contato). Use parágrafos curtos e listas com hífen. Estrutura: abertura com benefício principal, características/diferenciais, especificações, itens inclusos, indicação de uso, garantia/cuidados.
   - Não invente especificações que não dá para ver na foto nem foram informadas. Onde faltar um dado importante, escreva [CONFIRMAR: o que falta].

Responda SOMENTE com um JSON válido (sem markdown), neste formato:
{
  "produto_identificado": "o que é o produto, em uma frase",
  "categoria_sugerida": "caminho de categoria no Mercado Livre",
  "titulo": "título com até 60 caracteres",
  "titulos_alternativos": ["opção 2", "opção 3"],
  "descricao": "descrição completa pronta para colar, com quebras de linha \\n",
  "ficha_tecnica": [{"atributo": "Marca", "valor": "..."}],
  "palavras_chave": ["termos que os compradores pesquisam"],
  "perguntas_frequentes": [{"pergunta": "...", "resposta": "..."}],
  "dicas": "o que conferir antes de publicar e o que os anúncios mais vendidos fazem",
  "fundo": {
    "descricao": "em português: o veículo compatível (se for peça automotiva) ou o objeto/ambiente onde o produto é usado",
    "busca": "nome curto para achar uma foto real disso no Wikimedia Commons, só marca e modelo, ex.: 'Volkswagen Amarok' ou 'Renault Master III'",
    "prompt_en": "prompt in English for a studio photo of that vehicle or object, e.g. 'white Renault Master van 2014, three-quarter rear view, full vehicle visible, studio product photo, plain white background, no text'"
  },
  "foto": {
    "tem_texto_logo_ou_marca_dagua": false,
    "problemas": ["problemas visíveis na foto do produto que atrapalham a aprovação no Mercado Livre (texto, marca d'água, produto cortado, reflexo forte, desfoque); lista vazia se estiver boa"]
  }
}`;
}

function parseJson(text) {
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i >= 0 && j > i) t = t.slice(i, j + 1);
  return JSON.parse(t);
}

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

// Imagem menor para a IA (economiza cota e acelera).
async function smallJpeg(blob, max = 768) {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
}

async function call(model, key, body) {
  const resp = await fetch(`${API}${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(data?.error?.message || `Erro ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return data;
}

/**
 * Gera o anúncio a partir da foto. Tenta com pesquisa no Google; se a cota
 * da pesquisa ou do modelo acabar, tenta sem pesquisa e depois com o modelo mais leve.
 */
export async function generateAd(imageBlob, { key, model, useSearch, extra, onStatus = () => {} }) {
  if (!key) throw new Error('Cole sua chave da API do Gemini em "Configurações da IA".');
  const img = await blobToBase64(await smallJpeg(imageBlob));

  const attempts = [];
  if (useSearch) attempts.push({ model, search: true });
  attempts.push({ model, search: false });
  if (model !== FALLBACK_MODEL) attempts.push({ model: FALLBACK_MODEL, search: false });

  let lastErr;
  for (const a of attempts) {
    onStatus(a.search
      ? 'Identificando o produto e pesquisando os anúncios que mais vendem...'
      : `Escrevendo o anúncio (${a.model})...`);
    const body = {
      contents: [{ role: 'user', parts: [
        { inline_data: { mime_type: 'image/jpeg', data: img } },
        { text: prompt(extra, a.search) },
      ] }],
      generationConfig: { temperature: 0.6 },
    };
    if (a.search) body.tools = [{ google_search: {} }];
    else body.generationConfig.responseMimeType = 'application/json';
    try {
      const data = await call(a.model, key, body);
      const cand = data.candidates?.[0];
      const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
      if (!text) throw new Error('A IA não devolveu texto.');
      const ad = parseJson(text);
      const chunks = cand.groundingMetadata?.groundingChunks || [];
      ad._fontes = chunks.map((c) => c.web).filter(Boolean);
      ad._modelo = a.model;
      ad._pesquisou = a.search;
      return ad;
    } catch (e) {
      console.warn('Tentativa falhou', a, e);
      lastErr = e;
      if (e.status === 400 && /API key/i.test(e.message)) throw new Error('Chave da API inválida. Confira em "Configurações da IA".');
      if (e.status === 403) throw new Error('A chave não tem permissão para usar a API do Gemini. Gere outra em aistudio.google.com/apikey.');
    }
  }
  if (lastErr?.status === 429) throw new Error('A cota grátis do dia acabou. Ela renova automaticamente; tente mais tarde ou troque o modelo nas configurações.');
  throw lastErr || new Error('Falha ao gerar o anúncio.');
}

/**
 * Gera grátis (sem chave) a foto do veículo/ambiente para o fundo, pelo Pollinations.ai.
 * Devolve um Blob de imagem.
 */
export async function generateBackdrop(promptEn, seed = Math.floor(Math.random() * 1e6)) {
  const p = `${promptEn}, full object visible, centered, plain white background, high detail, no text, no watermark`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(p)}?width=1024&height=768&nologo=true&seed=${seed}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Gerador de imagem respondeu ${resp.status}`);
  const blob = await resp.blob();
  if (!blob.type.startsWith('image/')) throw new Error('O gerador não devolveu uma imagem');
  return blob;
}

/**
 * Busca fotos reais (grátis, sem chave) no Wikimedia Commons.
 * Devolve uma lista de URLs de imagens, as melhores primeiro.
 */
export async function searchBackdrops(query) {
  if (!query) return [];
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '30',
    prop: 'imageinfo', iiprop: 'url|size|mime', iiurlwidth: '1280',
  });
  const resp = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`);
  if (!resp.ok) throw new Error(`Wikimedia respondeu ${resp.status}`);
  const data = await resp.json();
  const bad = /interior|engine|motor|dashboard|cockpit|logo|badge|emblem|wheel|seat|detail|crash|wreck|rally|race|map|diagram|drawing|instrument/i;
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return Object.values(data.query?.pages || {})
    .map((p) => ({ title: p.title, index: p.index, info: p.imageinfo?.[0] }))
    .filter((p) => p.info && /jpe?g|png|webp/.test(p.info.mime) && p.info.width >= 800 && p.info.width > p.info.height && !bad.test(p.title))
    .map((p) => ({ ...p, score: words.filter((w) => p.title.toLowerCase().includes(w)).length * 10 - p.index }))
    .sort((a, b) => b.score - a.score)
    .map((p) => p.info.thumburl || p.info.url);
}

export async function fetchImage(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Imagem respondeu ${resp.status}`);
  const blob = await resp.blob();
  if (!blob.type.startsWith('image/')) throw new Error('Não é uma imagem');
  return blob;
}

/**
 * Mostra ao Gemini as fotos de veículo encontradas e a peça. Ele escolhe as
 * que mostram o veículo certo, inteiro, no ângulo em que a peça aparece, e
 * marca onde a peça fica em cada foto.
 * Devolve [{ i, caixa }] na ordem da melhor para a pior (só as aprovadas).
 */
export async function pickBackdrops(blobs, productBlob, { key, model, vehicle, part }) {
  if (!key || !blobs.length) return null;
  const parts = [{ text: `Peça à venda (primeira imagem): ${part || 'peça automotiva'}. Veículo compatível: ${vehicle || 'desconhecido'}.` },
    { inline_data: { mime_type: 'image/jpeg', data: await blobToBase64(await smallJpeg(productBlob, 384)) } }];
  for (let i = 0; i < blobs.length; i++) {
    parts.push({ text: `Foto ${i}:` });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: await blobToBase64(await smallJpeg(blobs[i], 512)) } });
  }
  parts.push({ text: `Escolha as fotos que servem de fundo para o anúncio desta peça: devem mostrar o veículo compatível (mesmo modelo e geração), inteiro, do lado de fora, sem cortes, de preferência no ângulo em que a peça aparece (peça traseira: traseira ou 3/4 traseira; dianteira: frente ou 3/4 frente). Descarte fotos de outro modelo, interior, detalhes, veículo cortado ou com muita gente/objetos na frente.
Para cada foto aprovada, dê a caixa onde a peça fica nesse veículo, no formato [ymin, xmin, ymax, xmax] de 0 a 1000; use null se a posição não estiver visível.
Responda SOMENTE com JSON: {"aprovadas": [{"foto": 0, "caixa": [ymin, xmin, ymax, xmax]}]} com a melhor primeiro.` });
  const models = [model, 'gemini-2.5-flash-lite'].filter((m, i, a) => m && a.indexOf(m) === i);
  for (const m of models) {
    try {
      const data = await call(m, key, {
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      });
      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      const res = parseJson(text);
      return (res.aprovadas || [])
        .filter((a) => Number.isInteger(a.foto) && a.foto >= 0 && a.foto < blobs.length)
        .map((a) => ({ i: a.foto, caixa: Array.isArray(a.caixa) ? a.caixa : null }));
    } catch (e) {
      console.warn('Escolha do veículo falhou', m, e);
    }
  }
  return null;
}

// Geração do anúncio com o Google Gemini (camada gratuita da API).
const API = 'https://generativelanguage.googleapis.com/v1beta/models/';
// modelos "lite" têm cota grátis bem maior (centenas por dia) que os Flash (poucas dezenas)
const FALLBACK_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite'];

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
  "clip_roteiro": "texto falado por um apresentador num vídeo vertical de 20 a 30 segundos (45 a 70 palavras), em português do Brasil, tom natural de vendedor confiante: 4 a 6 frases curtas, começa chamando atenção para o problema ou o produto, mostra os benefícios reais e termina convidando a ver o anúncio. Sem preço, promoção, frete, contato nem emojis",
  "clip_legendas": ["5 frases curtas (até 32 caracteres cada) para as legendas de um vídeo vertical do Mercado Livre Clips: 1ª chama atenção para o produto, depois benefícios e diferenciais reais, a última convida a ver o anúncio. Sem preço, sem promoção, sem frete, sem contato, sem emojis"],
  "fundo": {
    "descricao": "em português: o veículo compatível (se for peça automotiva) ou o objeto/ambiente onde o produto é usado",
    "busca": "nome curto do veículo ou objeto, só marca e modelo, ex.: 'Renault Master'"
  },
  "foto_uso_en": "prompt in English for a REALISTIC photo of the product in real everyday use, with the compatible vehicle (or the place where the product is used) as the main subject and the part's position visible, e.g. for a tail light: 'white Renault Master van driving in city traffic at dusk, rear three-quarter view, tail lights glowing red, wet asphalt reflections, realistic photo, DSLR'",
  "foto_uso_pt": "a mesma cena em português, para pedir no app Gemini",
  "foto_conversao": {
    "titulo": "até 34 caracteres: a promessa principal, o desejo ou o problema resolvido para o comprador (ex.: 'Sua Master segura e bonita de novo'). Sem preço, promoção, frete ou contato",
    "beneficios": ["exatamente 3 benefícios concretos e verdadeiros, até 26 caracteres cada, do mais forte para o mais fraco"],
    "compatibilidade": "até 40 caracteres: veículos e anos compatíveis (ex.: 'Renault Master 2014 a 2022') ou para que serve; vazio se não souber",
    "selo": "até 16 caracteres, ex.: 'Peça nova', só se o vendedor informou ou dá para ver na foto; senão vazio"
  },
  "lado": {
    "vendido": "lado que este anúncio vende: 'esquerdo', 'direito', 'par' (os dois), 'indefinido' (peça com lado, mas não dá para saber) ou 'nao_se_aplica' (produto sem lado). No Brasil o lado esquerdo é o do motorista; LE = esquerdo, LD = direito",
    "foto": "de qual lado do veículo é a peça mostrada na foto: 'esquerdo', 'direito' ou 'indefinido'",
    "posicao": "onde a peça fica no veículo: 'dianteira', 'traseira', 'lateral' ou 'nao_se_aplica'"
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
  for (const m of FALLBACK_MODELS) if (m !== model) attempts.push({ model: m, search: false });

  let lastErr;
  const dead = new Set();     // modelos sem cota ou inexistentes: pula as outras tentativas com eles
  for (const a of attempts) {
    if (dead.has(a.model)) continue;
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
      if (e.status === 429 || e.status === 404) dead.add(a.model);
    }
  }
  if (lastErr?.status === 429) throw new Error('A cota grátis do Gemini acabou por hoje (o plano grátis permite poucas dezenas de anúncios por dia). Ela renova sozinha; tente mais tarde ou use outra chave.');
  if (lastErr instanceof SyntaxError) throw new Error('A IA respondeu num formato inválido. Clique em "Gerar de novo".');
  throw lastErr || new Error('Falha ao gerar o anúncio.');
}

/**
 * Gera grátis (sem chave) a foto do ambiente da foto 4, pelo Pollinations.ai.
 * Devolve um Blob de imagem.
 */
export async function generateScene(promptEn, seed = Math.floor(Math.random() * 1e6)) {
  const p = `${promptEn}, realistic photo, no text, no watermark, no logos, high detail`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(p)}?width=1200&height=1200&nologo=true&seed=${seed}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  const resp = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
  if (!resp.ok) throw new Error(`Gerador de imagem respondeu ${resp.status}`);
  const blob = await resp.blob();
  if (!blob.type.startsWith('image/')) throw new Error('O gerador não devolveu uma imagem');
  return blob;
}

/**
 * Foto do produto em uso feita pelo Gemini (modelo de imagem), com a peça da
 * foto instalada no veículo. Na maioria das chaves grátis esse modelo não tem
 * cota; aí dá erro e o app usa outro caminho.
 */
export async function generateInUse(productBlob, promptEn, key) {
  if (!key) throw new Error('sem chave');
  const img = await blobToBase64(await smallJpeg(productBlob, 1024));
  const data = await call('gemini-2.5-flash-image', key, {
    contents: [{ role: 'user', parts: [
      { inline_data: { mime_type: 'image/jpeg', data: img } },
      { text: `Create a realistic square photo of this exact part (same shape, colors and details as the attached photo) installed and in real use: ${promptEn}. The part must be on the vehicle, in its correct position and clearly visible. No text, no logos, no watermark.` },
    ] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } },
  });
  const part = (data.candidates?.[0]?.content?.parts || []).find((x) => x.inlineData || x.inline_data);
  const d = part?.inlineData || part?.inline_data;
  if (!d?.data) throw new Error('O Gemini não devolveu imagem.');
  const bin = atob(d.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: d.mimeType || d.mime_type || 'image/png' });
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

// Imagem colada por link. Muitos sites não deixam outra página baixar a foto
// (CORS); nesse caso a foto passa pelo wsrv.nl, um serviço público e grátis de
// imagens que libera o acesso.
export async function fetchImageUrl(url) {
  url = url.trim();
  if (!/^(https?:|data:image\/)/i.test(url)) throw new Error('Cole um link que comece com http:// ou https://');
  const name = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '') || 'imagem';
  let blob = null;
  try { blob = await fetchImage(url); } catch {}
  if (!blob && !url.startsWith('data:')) {
    try { blob = await fetchImage(`https://wsrv.nl/?url=${encodeURIComponent(url)}&output=png&n=-1`); } catch {}
  }
  if (!blob) throw new Error('Não consegui baixar a imagem desse link. Use o link da própria imagem (clique com o botão direito na foto e "Copiar endereço da imagem"), não o da página.');
  return new File([blob], `${name.slice(0, 60)}.${(blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`, { type: blob.type });
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
  parts.push({ text: `Escolha as fotos que servem de fundo para o anúncio desta peça: devem mostrar o veículo compatível (mesmo modelo e geração), inteiro, do lado de fora, sem cortes, de preferência no ângulo em que a peça aparece (peça traseira: traseira ou 3/4 traseira; dianteira: frente ou 3/4 frente). O veículo deve ser o assunto principal e ocupar a maior parte da foto (pelo menos metade da largura), com fundo limpo. Descarte fotos de outro modelo, interior, detalhes, veículo cortado, veículo pequeno ou distante, fotos com fios, postes, árvores, placas, pessoas ou outros veículos na frente ou em volta.
Para cada foto aprovada, dê a caixa onde a peça fica nesse veículo, no formato [ymin, xmin, ymax, xmax] de 0 a 1000; use null se a posição não estiver visível.
Responda SOMENTE com JSON: {"aprovadas": [{"foto": 0, "caixa": [ymin, xmin, ymax, xmax]}]} com a melhor primeiro.` });
  // usa os modelos lite primeiro para não gastar a cota do anúncio
  const models = [...FALLBACK_MODELS, model].filter((m, i, a) => m && a.indexOf(m) === i);
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

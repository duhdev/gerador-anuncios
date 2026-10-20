# Gerador de Anúncios

App web que transforma a foto do produto em fotos prontas para o Mercado Livre e escreve o anúncio com IA.

## Como usar (Windows)
1. Extraia a pasta `gerador-anuncios` em qualquer lugar do computador.
2. Dê dois cliques em **iniciar.bat**. O navegador abre em `http://localhost:8765`. Deixe a janela preta aberta enquanto usa.
3. Na primeira vez, abra **Configurações da IA**, cole sua chave do Gemini e clique em **Salvar**.
   - Crie a chave grátis em https://aistudio.google.com/apikey (só precisa de uma conta Google, sem cartão).
4. Clique ou arraste a foto do produto (também dá para colar com Ctrl+V).

Mac/Linux: rode `python3 servidor.py` dentro da pasta.

## O que ele faz
**Fotos (5 imagens, todas 1200x1200 em JPG)**
1. Fundo branco (foto principal).
2. Fundo branco com sombra.
3. Par do produto, duas unidades lado a lado (marque "espelhar" para peças de lado esquerdo e direito).
4. Veículo compatível inteiro ao fundo e a peça grande na frente, em destaque.
5. Veículo à esquerda com um círculo marcando onde a peça vai, ligado à peça à direita.

Como funciona:
- Pode mandar várias fotos de uma vez: cada foto vira um anúncio completo. "Baixar tudo (ZIP)" baixa uma pasta por produto com as 5 fotos e o anuncio.txt.
- Super-resolução com Real-ESRGAN (IA que reconstrói os detalhes, não só estica a imagem). Roda no seu PC: usa a placa de vídeo quando o navegador permite (WebGPU) e o processador nos outros casos. Depois da ampliação, o recorte do fundo é refeito na imagem já nítida, para a borda da peça ficar firme.
- Cada pedaço ampliado é conferido; se a placa de vídeo errar algum pedaço, aquele pedaço usa a ampliação comum (evita faixas pretas).
- Cores e contraste são realçados de leve, sem estourar os brancos (desligue em "Realçar cores e contraste" se preferir).
- Veículo das fotos 4 e 5: o Gemini identifica o veículo compatível, o app busca fotos reais dele no Wikimedia Commons (grátis) e o Gemini escolhe a que mostra o modelo certo, inteiro, no ângulo da peça, e marca onde a peça fica. Se nenhuma servir, as fotos 4 e 5 ficam vazias com um aviso (melhor do que usar um veículo errado). Para garantir, envie sua própria foto do veículo no campo "Foto do veículo ou ambiente".
- "Trocar veículo do fundo" passa para a próxima foto aprovada. O controle "Veículo ao fundo" deixa o veículo mais claro se quiser (padrão: 100%, inteiro e nítido).
- Para peças automotivas, escreva o veículo em "Informações extras" (ex.: Renault Master 2014 a 2022) para acertar o modelo.

**Conferência para o Mercado Livre** (aparece em cada produto)
- Tamanho 1200x1200, fundo branco puro nas bordas, quanto o produto ocupa da foto (ideal entre 80% e 95%), resolução da foto original.
- O Gemini também confere se a foto tem texto, logo ou marca d'água, e aponta outros problemas visíveis (reflexo, desfoque, produto cortado).

**Descrição**
- O Gemini identifica o produto pela foto, pesquisa no Google os anúncios que mais vendem hoje no Mercado Livre e escreve:
  título (até 60 caracteres), títulos alternativos, descrição em texto puro, ficha técnica, palavras-chave, perguntas frequentes e dicas.
- Dados que não aparecem na foto ficam marcados como `[CONFIRMAR: ...]`. Preencha o campo "Informações extras" (marca, medidas, voltagem) para um texto mais completo.

**Vídeo para o Mercado Livre Clips**
- Depois das fotos, cada produto ganha um editor de vídeo vertical 1080x1920 (9:16), em MP4, de 10 a 60 segundos.
- Giro 3D: uma IA de profundidade (Depth Anything V2, grátis, roda no navegador) calcula o relevo da peça e a câmera gira em volta dela, com um brilho passando pela superfície. A IA é baixada na primeira vez; sem ela, o app usa o formato da peça para o relevo.
- Outros ângulos: envie fotos da mesma peça de outros lados no campo "Fotos da mesma peça em outros ângulos". Cada uma é recortada e entra no vídeo com o giro 3D. A IA não consegue inventar com qualidade o lado que não aparece na foto, por isso as fotos reais são o melhor caminho.
- Transições fluidas: a câmera está sempre em movimento e as cenas se fundem com aproximação, sem cortes secos.
- Narração: o Gemini escreve o roteiro falado e uma voz neural em português (Piper, voz "faber", grátis) narra no seu navegador. As legendas acompanham cada frase da voz. A voz é baixada na primeira vez (cerca de 60 MB) e fica guardada.
- Pessoa segurando a peça (sem você aparecer): em "Pessoa segurando a peça", baixe a foto de referência e copie o pedido pronto. Cole no Google AI Studio (aistudio.google.com, grátis no site) com o modelo de imagem "Nano Banana" e a foto anexada. Baixe as fotos boas e envie no app: elas entram no vídeo com movimento de câmera na mão e a narração por cima. A API de imagens do Gemini não é mais grátis, por isso esse passo é feito no site.
- Apresentador: "Gravar apresentador (câmera)" abre a câmera com o roteiro subindo na tela (teleprompter). Você aparece num círculo no alto do vídeo, com a sua voz. Grave pelo menos 10 segundos. Avatar realista feito por IA hoje só existe em serviços pagos (HeyGen, D-ID, Synthesia), por isso o app usa a sua gravação.
- A música de fundo é criada pelo app (sem direitos autorais) e fica baixinha quando há fala.
- Use o Google Chrome ou o Edge: eles gravam em H.264, o formato que o Mercado Livre aceita. O vídeo entra no "Baixar tudo (ZIP)".

## Custo e limites da IA
- A chave do Google AI Studio na camada gratuita não cobra nada enquanto você não ativar faturamento no projeto do Google Cloud. Não ative e o custo é zero.
- A cota gratuita é por dia e o Google muda os números com frequência; os valores atuais aparecem em https://aistudio.google.com (página de limites de uso). Cada foto usa 1 pedido.
- Quando a cota da pesquisa no Google ou do modelo acaba, o app tenta sozinho sem pesquisa e depois com o modelo `gemini-2.5-flash-lite`, que tem cota maior.
- Na camada gratuita o Google pode usar os pedidos para melhorar os modelos. Não envie fotos com dados pessoais.

## Arquivos
- `index.html`, `style.css`, `app.js`: tela do app.
- `imagem.js`: tratamento da foto.
- `ia.js`: chamada ao Gemini e o prompt do anúncio (edite aqui para mudar o estilo do texto).
- `vendor/`: remoção de fundo (@imgly/background-removal 1.4.5, licença AGPL) com o modelo de recorte; ONNX Runtime Web 1.23 (MIT); modelo Real-ESRGAN realesr-general-x4v3 convertido para ONNX (licença BSD-3, Xintao Wang).
- `iniciar.bat` + `servidor.ps1` (Windows) e `servidor.py` (Python): servidor local.

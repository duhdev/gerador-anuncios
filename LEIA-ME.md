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
**Fotos (6 imagens, todas 1200x1200; as fotos 1 e 2 em PNG com fundo #FFFFFF puro)**
As fotos seguem uma história para o comprador: atenção (1 a 3), desejo (4), convicção (5) e certeza (6).
1. Fundo branco puro (foto principal).
2. Fundo branco puro com sombra.
3. Par do produto: lado direito e lado esquerdo (a segunda peça é o espelho da primeira), lado a lado e simétricos. Desmarque a opção se a peça não tiver lado.
4. Em uso na vida real (desejo): o veículo compatível no dia a dia (no trânsito, na estrada), para o comprador ver o uso real. Primeiro o app pede ao Gemini, com a sua chave, uma foto com a peça instalada (o modelo de imagem do Gemini quase nunca tem cota grátis; se não tiver, pula). Depois tenta uma IA grátis (Pollinations.ai), que cria a cena do veículo, e a peça aparece num quadro no canto. Se nenhuma responder, use "Copiar pedido da foto 4 para o app Gemini" (funciona com a assinatura Gemini) e envie a imagem em "Usar minha imagem na foto 4". "Gerar outra cena" cria outra.
5. Benefícios (convencer): a peça grande com um círculo de destaque, uma promessa curta no alto, 3 benefícios com marcação e uma faixa "Compatível com". Usa princípios conhecidos de leitura e decisão: um ponto de foco só, leitura de cima para baixo e da esquerda para a direita, no máximo 3 itens (fáceis de lembrar) e a compatibilidade em destaque (é a maior dúvida de quem compra peça). Os textos vêm do anúncio da IA, sem preço, promoção, frete ou contato. Nenhuma imagem garante a venda; confira os textos antes de publicar.
6. Qual é o lado (certeza): o veículo visto de cima com o volante do lado do motorista, a peça do lado esquerdo e a do lado direito (espelho uma da outra) e setas até a posição certa no veículo. O lado do anúncio ganha a marca "ESTE ANÚNCIO" (ou "ACOMPANHA" quando é o par). Sem título nem faixa de texto. O lado e a posição vêm da IA e do que você escrever em "Informações extras" (ex.: "lado direito", "LD"). Para produtos sem lado, a foto 6 não é gerada.

Como funciona:
- Pode mandar várias fotos de uma vez: cada foto vira um anúncio completo. "Baixar tudo (ZIP)" baixa uma pasta por produto com as 6 fotos e o anuncio.txt.
- Super-resolução com Real-ESRGAN (IA que reconstrói os detalhes, não só estica a imagem). Roda no seu PC: usa a placa de vídeo quando o navegador permite (WebGPU) e o processador nos outros casos. Depois da ampliação, o recorte do fundo é refeito na imagem já nítida, para a borda da peça ficar firme.
- Cada pedaço ampliado é conferido; se a placa de vídeo errar algum pedaço, aquele pedaço usa a ampliação comum (evita faixas pretas).
- Cores e contraste são realçados de leve, sem estourar os brancos (desligue em "Realçar cores e contraste" se preferir).
- O Mercado Livre exige fundo branco e nenhum texto só na foto principal; as fotos 5 e 6 têm textos explicativos, use-as como fotos secundárias.
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
- Vídeo de apresentação: estúdio escuro com luz, partículas e reflexo no piso. A peça entra voando com rastro de movimento, aparece o título, os destaques entram em cartões com visto animado, uma lupa passeia mostrando o acabamento, o veículo entra num cartão, as peças direita e esquerda se encontram no meio e o final tem raios de luz com a chamada para o anúncio.
- Transições variadas (chicote, círculo, zoom e empurrão) com efeito sonoro de "whoosh", e barra de progresso no alto.
- Narração: o Gemini escreve o roteiro falado e uma voz neural em português (Piper, voz "faber", grátis) narra no seu navegador. As legendas acompanham cada frase da voz. A voz é baixada na primeira vez (cerca de 60 MB) e fica guardada.
- Apresentador: "Gravar apresentador (câmera)" abre a câmera com o roteiro subindo na tela (teleprompter). Você aparece num círculo no alto do vídeo, com a sua voz. Grave pelo menos 10 segundos.
- Avatar do Gemini (para quem assina o Google AI Pro): na aba Vídeo, "Copiar pedido para o Gemini" e "Baixar foto do produto"; cole o pedido e anexe a foto no app Gemini (ou no Flow), baixe o vídeo gerado e use "Importar vídeo do avatar". Ele vira a abertura do Clips (até 30 s), com a voz do avatar, e depois entram as cenas do produto. A assinatura não inclui a API de vídeo do Google (o Veo pela API é cobrado à parte), por isso esse passo é feito no app Gemini.
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

## Foto pelo link

Além de enviar o arquivo, dá para colar o link da imagem no campo abaixo da área de envio (vários links separados por espaço viram vários anúncios), arrastar uma imagem de outra aba ou colar o link com Ctrl+V. A foto do veículo também aceita link, em Ajustes. Use o endereço da imagem (botão direito na foto, "Copiar endereço da imagem"), não o da página. Se o site bloquear o download, a foto passa pelo wsrv.nl, um serviço público e grátis de imagens.

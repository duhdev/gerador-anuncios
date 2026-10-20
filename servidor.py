# Servidor local do Gerador de Anúncios (Mac/Linux/Windows com Python).
# Uso: python3 servidor.py  -> abre http://localhost:8765
import functools, http.server, os, socketserver, webbrowser

PORT = 8765
ROOT = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm'}
    def end_headers(self):
        # isolamento de origem: libera várias threads no recorte de fundo (mais rápido)
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'credentialless')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
    def log_message(self, *a):
        pass

socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('127.0.0.1', PORT), functools.partial(Handler, directory=ROOT)) as httpd:
    url = f'http://localhost:{PORT}/'
    print(f'Gerador de Anúncios rodando em {url}  (feche esta janela para parar)')
    webbrowser.open(url)
    httpd.serve_forever()

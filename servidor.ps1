# Servidor local do Gerador de Anúncios para Windows (não precisa instalar nada).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8765
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
$url = "http://localhost:$port/"
Write-Host "Gerador de Anuncios rodando em $url"
Write-Host "Feche esta janela para parar."
Start-Process $url

$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.wasm' = 'application/wasm'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.svg' = 'image/svg+xml'; '.md' = 'text/plain; charset=utf-8'
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($path -eq '') { $path = 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $path))
    if (-not $file.StartsWith($root) -or -not (Test-Path $file -PathType Leaf)) {
      $res.StatusCode = 404
    } else {
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $ct = $types[$ext]; if (-not $ct) { $ct = 'application/octet-stream' }
      $res.ContentType = $ct
      $res.Headers.Add('Cross-Origin-Opener-Policy', 'same-origin')
      $res.Headers.Add('Cross-Origin-Embedder-Policy', 'credentialless')
      $res.Headers.Add('Cache-Control', 'no-cache')
      $bytes = [IO.File]::ReadAllBytes($file)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  } catch {
    $res.StatusCode = 500
  } finally {
    $res.OutputStream.Close()
  }
}

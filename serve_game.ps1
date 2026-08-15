$ErrorActionPreference = "Continue"
$root = $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }

function Test-PortFree([int]$p) {
  try {
    $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $p)
    $l.Start()
    $l.Stop()
    return $true
  } catch {
    return $false
  }
}

# منفذ شبه عشوائي مختلف لكل جهاز/تشغيل
$rand = New-Object System.Random
$port = 0
for ($i = 0; $i -lt 40; $i++) {
  $try = 8100 + $rand.Next(0, 900)
  if (Test-PortFree $try) { $port = $try; break }
}
if ($port -eq 0) { $port = 8080 }

$listener = New-Object System.Net.HttpListener
# استمع على كل الواجهات عشان الرابط المحلي/Radmin يشتغل
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Prefixes.Add("http://localhost:$port/")

# أضف IPs الجهاز (LAN / Radmin)
$ips = @()
try {
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    ForEach-Object {
      $ip = $_.IPAddress
      $ips += $ip
      try { $listener.Prefixes.Add("http://$ip`:$port/") } catch {}
    }
} catch {
  try {
    $hostEntry = [System.Net.Dns]::GetHostEntry([System.Net.Dns]::GetHostName())
    foreach ($a in $hostEntry.AddressList) {
      if ($a.AddressFamily -eq 'InterNetwork') {
        $ip = $a.ToString()
        if ($ip -notlike '127.*') {
          $ips += $ip
          try { $listener.Prefixes.Add("http://$ip`:$port/") } catch {}
        }
      }
    }
  } catch {}
}

try {
  $listener.Start()
} catch {
  Write-Host ""
  Write-Host "فشل فتح السيرفر على المنفذ $port"
  Write-Host $_.Exception.Message
  Write-Host "لو ظهرت رسالة صلاحيات: شغّل الملف كمسؤول مرة واحدة"
  Write-Host ""
  pause
  exit 1
}

$pcName = $env:COMPUTERNAME
Write-Host ""
Write-Host "========================================"
Write-Host "  Story Mode - صفحة اللعبة"
Write-Host "  الجهاز: $pcName"
Write-Host "  المنفذ: $port   (خاص بالجهاز ده)"
Write-Host "========================================"
Write-Host ""
Write-Host "افتح واحد من الروابط دي في Chrome:"
Write-Host "  >>>  http://127.0.0.1:$port/"
Write-Host "  >>>  http://localhost:$port/"
foreach ($ip in ($ips | Select-Object -Unique)) {
  Write-Host "  ->  http://$ip`:$port/"
}
Write-Host ""
Write-Host "ملاحظة: الرابط ده لفتح اللعبة عندك فقط."
Write-Host "صاحبك عنده رابط/منفذ مختلف على جهازه - وده طبيعي."
Write-Host "اللعب بينكم بتبادل الأكواد مش بالرابط."
Write-Host ""
Write-Host "سييب النافذة مفتوحة. للإيقاف: Ctrl+C"
Write-Host ""

# افتح المتصفح على رابط الجهاز المحلي
$openUrl = "http://127.0.0.1:$port/"
try { Start-Process $openUrl } catch {}

$mime = @{
  ".html"="text/html; charset=utf-8"
  ".js"="application/javascript; charset=utf-8"
  ".css"="text/css; charset=utf-8"
  ".json"="application/json"
  ".png"="image/png"
  ".jpg"="image/jpeg"
  ".jpeg"="image/jpeg"
  ".gif"="image/gif"
  ".svg"="image/svg+xml"
  ".mp3"="audio/mpeg"
  ".wav"="audio/wav"
  ".ogg"="audio/ogg"
  ".woff"="font/woff"
  ".woff2"="font/woff2"
  ".txt"="text/plain; charset=utf-8"
  ".map"="application/json"
  ".ico"="image/x-icon"
}

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $path = [Uri]::UnescapeDataString($req.Url.LocalPath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($path)) { $path = "index.html" }
    $path = $path -replace '/', '\'
    $full = [System.IO.Path]::GetFullPath((Join-Path $root $path))
    $rootFull = [System.IO.Path]::GetFullPath($root)
    if (-not $full.StartsWith($rootFull)) {
      $res.StatusCode = 403
      $res.Close()
      continue
    }
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
      $res.StatusCode = 404
      $buf = [Text.Encoding]::UTF8.GetBytes("404")
      $res.OutputStream.Write($buf, 0, $buf.Length)
      $res.Close()
      continue
    }
    $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
    $ctype = $mime[$ext]
    if (-not $ctype) { $ctype = "application/octet-stream" }
    $bytes = [System.IO.File]::ReadAllBytes($full)
    $res.ContentType = $ctype
    $res.ContentLength64 = $bytes.LongLength
    $res.AddHeader("Cache-Control", "no-cache")
    $res.AddHeader("Access-Control-Allow-Origin", "*")
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.Close()
  } catch {
    # continue
  }
}

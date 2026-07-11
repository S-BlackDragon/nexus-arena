@echo off
title NEXUS ARENA - Hostear online desde este PC
cd /d "%~dp0"

if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)

if not exist cloudflared.exe (
  echo Descargando cloudflared ^(tunel gratuito de Cloudflare^)...
  powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'"
)

echo Iniciando servidor del juego...
start "NEXUS ARENA - Servidor (no cerrar)" cmd /k node server\server.js

timeout /t 3 /nobreak >nul

echo.
echo ============================================================
echo  Busca abajo la URL https://xxxx.trycloudflare.com
echo  Esa es la direccion que debes compartir con tus amigos.
echo  Manten esta ventana abierta mientras jugais.
echo ============================================================
echo.
cloudflared.exe tunnel --url http://localhost:3000
pause

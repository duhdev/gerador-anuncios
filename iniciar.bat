@echo off
title Gerador de Anuncios
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor.ps1"
pause

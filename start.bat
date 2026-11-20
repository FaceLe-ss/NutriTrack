@echo off
title NutriTrack PWA Launcher
echo Starting NutriTrack PWA local server...
"C:\Users\Vitaliy\AppData\Local\Programs\Python\Python313\python.exe" serve.py
if %ERRORLEVEL% NEQ 0 (
    python serve.py
)
pause

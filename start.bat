@echo off
echo ====================================================
echo Starting Voice AI Agent on http://localhost:8001
echo ====================================================

REM Ensure Ollama is running in background if installed
tasklist | findstr /i "ollama.exe" >nul
if errorlevel 1 (
    echo Starting Ollama service...
    start /B "" "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" serve
)

REM Activate Virtual Environment and Launch Server
if exist "venv\Scripts\python.exe" (
    venv\Scripts\python.exe run_server.py
) else (
    call venv\Scripts\activate.bat
    python run_server.py
)
pause

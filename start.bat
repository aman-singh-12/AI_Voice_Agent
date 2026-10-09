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
call venv\Scripts\activate.bat
python run_server.py
pause

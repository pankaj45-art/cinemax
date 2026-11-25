@echo off
setlocal
cd /d "%~dp0"
title CINEMAX

echo.
echo   CINEMAX - Smooth Playback Windows beta
echo   Keep this window open while CINEMAX is running.
echo.

rem Prefer the Windows Python launcher, then Python on PATH, then Node.
rem Each server binds only to this computer and opens the browser after binding.
py -3 -c "import sys" >nul 2>nul
if not errorlevel 1 (
    py -3 tools\windows_serve.py
    goto :done
)
python -c "import sys" >nul 2>nul
if not errorlevel 1 (
    python tools\windows_serve.py
    goto :done
)
node -e "process.exit(0)" >nul 2>nul
if not errorlevel 1 (
    node tools\serve.js 8000 --local --open
    goto :done
)

echo   Python and Node.js were not found. Opening CINEMAX.html directly.
echo   For best tab-capture support, open it in Chrome or Edge.
echo   If browser-tab capture is blocked, install Python from python.org,
echo   select "Add Python to PATH", and run this launcher again.
echo.
start "" "%CD%\CINEMAX.html"
pause
exit /b 0

:done
echo.
echo   The local server stopped. Close this window or press any key.
pause >nul

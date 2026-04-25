@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Creating venv and installing dependencies...
  py -3 -m venv .venv
  call .venv\Scripts\activate.bat
  python -m pip install -U pip -q
  pip install -r requirements.txt
) else (
  call .venv\Scripts\activate.bat
)
echo.
echo   Open:  http://localhost:5001
echo.
python app.py

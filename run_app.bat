@echo off
ipconfig
call venv\Scripts\activate
start "Waitress Server" /MIN cmd /k "waitress-serve --host=0.0.0.0 --port=8000 app:app"
pause

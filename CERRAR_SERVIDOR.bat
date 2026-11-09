@echo off
chcp 65001 >nul
echo Cerrando servidor Visor SYNOP/METAR...

REM Buscar y cerrar procesos Python que estén ejecutando app.py
for /f "tokens=2" %%a in ('tasklist /fi "imagename eq python.exe" /fo list ^| find "PID:"') do (
    wmic process where "ProcessId=%%a" get CommandLine 2>nul | find "app.py" >nul
    if not errorlevel 1 (
        echo Cerrando proceso %%a...
        taskkill /pid %%a /f >nul 2>&1
    )
)

REM Limpiar archivo temporal
if exist run_server_temp.bat del run_server_temp.bat

echo Servidor cerrado.
timeout /t 2 >nul

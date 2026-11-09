@echo off
chcp 65001 >nul
echo ============================================
echo  Visor SYNOP/METAR Argentina - Modo consola
echo ============================================
echo.
echo Servidor en: http://localhost:8080
echo Presionar Ctrl+C para cerrar.
echo.

if not exist venv (
    echo ERROR: Entorno virtual no encontrado. Ejecutar INSTALAR_WINDOWS.bat primero.
    pause
    exit /b 1
)

call venv\Scripts\activate.bat
python app.py

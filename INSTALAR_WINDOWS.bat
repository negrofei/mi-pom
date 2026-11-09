@echo off
chcp 65001 >nul
echo ============================================
echo  INSTALACION - Visor SYNOP/METAR Argentina
echo ============================================
echo.

REM Verificar Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python no encontrado. Instalar Python 3.12 primero.
    pause
    exit /b 1
)

echo Creando entorno virtual...
if exist venv (
    echo El entorno virtual ya existe. Saltando creacion.
) else (
    python -m venv venv
    if errorlevel 1 (
        echo ERROR: No se pudo crear el entorno virtual.
        pause
        exit /b 1
    )
)

echo.
echo Activando entorno virtual e instalando dependencias...
call venv\Scripts\activate.bat

pip install --upgrade pip
pip install -r requirements.txt

if errorlevel 1 (
    echo ERROR: No se pudieron instalar las dependencias.
    pause
    exit /b 1
)

echo.
echo ============================================
echo  INSTALACION COMPLETADA
echo ============================================
echo.
echo Pasos siguientes:
echo   1. Copiar .env.example a .env y completar credenciales DMA
echo   2. Ejecutar PROBAR_CON_CONSOLA.bat para verificar
echo   3. Ejecutar ABRIR_SYNOP.vbs para uso normal
echo.
pause

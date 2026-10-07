@echo off
setlocal
title Farmeador de cromos de Steam
cd /d "%~dp0"

if not exist "%~dp0programa\farmeador.js" goto sin_archivos

rem Busca Node.js, tambien en su carpeta de siempre por si se acaba de instalar
where node >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if not errorlevel 1 goto librerias

echo.
echo  El farmeador necesita Node.js para funcionar. Es gratis y no esta instalado.
echo.
where winget >nul 2>nul
if errorlevel 1 goto descargar
choice /c SN /n /m " Lo instalo ahora? (S = si, N = no): "
if errorlevel 2 goto descargar
echo.
echo  Instalando Node.js... (si Windows pide permiso, acepta)
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if not errorlevel 1 goto librerias
echo.
echo  Si la instalacion termino bien, cierra esta ventana y vuelve a abrir "Iniciar farmeador.bat".
goto fin

:descargar
echo  Descargalo de https://nodejs.org (el boton "LTS"), instalalo
echo  y vuelve a abrir "Iniciar farmeador.bat".
start "" "https://nodejs.org/"
goto fin

:librerias
rem Si faltan las librerias (o no son las de package-lock.json), las descarga: npm instala las
rem versiones exactas del lock, comprueba su huella y no ejecuta scripts de instalacion
node "%~dp0programa\farmeador.js" --revisar-librerias >nul 2>nul
if not errorlevel 1 goto ejecutar
echo.
echo  Descargando las librerias que necesita el farmeador (solo la primera vez, tarda un minuto)...
pushd "%~dp0programa"
call npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error
popd
node "%~dp0programa\farmeador.js" --revisar-librerias >nul 2>nul
if not errorlevel 1 goto ejecutar
echo.
echo  No se pudieron descargar las librerias. Revisa tu conexion a Internet y vuelve a intentarlo.
goto fin

:ejecutar
node "%~dp0programa\farmeador.js" %*
goto fin

:sin_archivos
echo.
echo  No encuentro los archivos del farmeador.
echo  Primero descomprime el .zip: clic derecho sobre el archivo, "Extraer todo..."
echo  y abre "Iniciar farmeador.bat" desde la carpeta que se crea.

:fin
echo.
pause

@echo off
setlocal
title Farmeador de cromos de Steam
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 goto sin_node

node "%~dp0programa\farmeador.js" --olvidar
goto fin

:sin_node
rem Sin Node.js: borra a mano la carpeta privada de la sesion y la de la version 1.0
if exist "%LOCALAPPDATA%\farmeador-cromos-steam" rmdir /s /q "%LOCALAPPDATA%\farmeador-cromos-steam"
if exist "%~dp0programa\datos" rmdir /s /q "%~dp0programa\datos"
echo.
echo  Listo: se borro la sesion guardada.

:fin
echo.
pause

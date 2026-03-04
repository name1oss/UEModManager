@echo off
setlocal
pushd "%~dp0\.."

echo ==========================================
echo Starting Build Process...
echo ==========================================

REM 1. Execute Build (Pack to win-unpacked)
echo Running npm run dist (Generating Installer)...
call npm run dist
if %errorlevel% neq 0 (
    echo Build failed!
    pause
    exit /b %errorlevel%
)

echo ==========================================
echo Copying Data Folder...
echo ==========================================

REM 2. Copy data folder to win-unpacked
REM Check if data exists
if exist "data" (
    echo Copying data to dist\win-unpacked\data...
    xcopy "data" "dist\win-unpacked\data\" /E /I /Y
) else (
    echo Warning: 'data' folder not found.
)

echo ==========================================
echo Backing up Source Code...
echo ==========================================

REM 3. Backup Source Code
set "BACKUP_DIR=backup_code_%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
set "BACKUP_DIR=%BACKUP_DIR: =0%"
set "TARGET_BACKUP=backup_code\%BACKUP_DIR%"

mkdir "%TARGET_BACKUP%"

echo Backing up to %TARGET_BACKUP%...

REM Robust file copy using robocopy to exclude folders
REM Excludes: node_modules, dist, backup_code, .git, .idea, .vscode
robocopy "." "%TARGET_BACKUP%" /E /XD node_modules dist backup_code .git .idea .vscode data /XF build_and_backup.bat scripts\build_and_backup.bat

echo ==========================================
echo Process Complete!
echo ==========================================
pause
popd

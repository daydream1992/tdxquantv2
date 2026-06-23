@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal EnableDelayedExpansion

echo.
echo ================================================================
echo                  TdxQuant 停止服务
echo ================================================================
echo.

python scripts\dev.py stop
set EXIT_CODE=%ERRORLEVEL%

echo.
if "!EXIT_CODE!"=="0" (
    echo [OK] 服务已停止 ^(FastAPI + Next.js + 健康轮询^)
) else (
    echo [!] 停止脚本返回码 !EXIT_CODE!,可能服务未运行或已停止
)
echo.
pause
endlocal

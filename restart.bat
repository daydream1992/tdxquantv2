@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal EnableDelayedExpansion

echo.
echo ================================================================
echo                  TdxQuant 重启服务
echo ================================================================
echo.

echo [1/2] 停止现有服务...
python scripts\dev.py stop
echo.

echo 等待 3 秒确保端口释放...
timeout /t 3 /nobreak >nul
echo.

echo [2/2] 重新启动服务...
python scripts\dev.py start
set EXIT_CODE=%ERRORLEVEL%

echo.
if "!EXIT_CODE!"=="0" (
    echo [OK] 重启完成
    echo    服务地址: http://127.0.0.1:3000
    echo    API:      http://127.0.0.1:8000/health
) else (
    echo [X] 重启过程有异常 ^(exit=!EXIT_CODE!^)
)
echo.
pause
endlocal

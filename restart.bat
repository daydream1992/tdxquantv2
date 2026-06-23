@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal EnableDelayedExpansion

echo.
echo ================================================================
echo                  TdxQuant 重启服务
echo ================================================================
echo.

REM ---------- R18-B: 强制 UTF-8 环境 ----------
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

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
    echo    QuestDB:  http://127.0.0.1:9000 ^(如已启动^)
) else (
    echo [X] 重启过程有异常 ^(exit=!EXIT_CODE!^)
)
echo.
pause
endlocal

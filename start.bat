@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal EnableDelayedExpansion

echo.
echo ================================================================
echo                  TdxQuant 启动中...
echo ================================================================
echo.
echo 项目目录: %CD%
echo 时间: %DATE% %TIME%
echo.

echo 正在启动 FastAPI (后端 :8000) + Next.js (前端 :3000) ...
echo.
python scripts\dev.py start
set EXIT_CODE=%ERRORLEVEL%

echo.
echo ----------------------------------------------------------------
if "!EXIT_CODE!"=="0" (
    echo [OK] 服务已启动
) else (
    echo [X] 启动过程中有异常 ^(exit=!EXIT_CODE!^),请查看上方日志
)
echo ----------------------------------------------------------------
echo.
echo   服务地址: http://127.0.0.1:3000
echo   API:      http://127.0.0.1:8000/health
echo.
echo 浏览器打开 http://127.0.0.1:3000 即可看到大屏。
echo 关闭终端或 Ctrl+C 不会停止服务,停止请运行 stop.bat。
echo.
pause
endlocal

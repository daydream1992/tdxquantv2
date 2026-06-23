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

REM ---------- R18-B: 强制 UTF-8 环境 (Windows 默认 GBK 会乱码) ----------
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

REM ---------- 可选: 启动 QuestDB (Real 模式推荐) ----------
REM 若 QuestDB 未运行且 docker 可用，提示用户先启动 (不强制)
where docker >nul 2>&1
if "!ERRORLEVEL!"=="0" (
    docker info >nul 2>&1
    if "!ERRORLEVEL!"=="0" (
        REM Docker 可用，探测 QuestDB 是否已启动
        curl -s -o nul http://127.0.0.1:9000/ 2>nul
        if not "!ERRORLEVEL!"=="0" (
            echo [提示] QuestDB (R18 数据库) 未运行，是否现在启动?
            choice /c YN /m "启动 QuestDB (Y=是, N=跳过, Mock 模式可跳过)"
            if errorlevel 2 (
                echo [SKIP] 跳过 QuestDB 启动
            ) else (
                call "%~dp0start-questdb.bat"
            )
            echo.
        ) else (
            echo [OK] QuestDB 已在运行 (http://127.0.0.1:9000)
            echo.
        )
    )
)

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
echo   QuestDB:  http://127.0.0.1:9000 ^(如已启动^)
echo.
echo 浏览器打开 http://127.0.0.1:3000 即可看到大屏。
echo 关闭终端或 Ctrl+C 不会停止服务,停止请运行 stop.bat。
echo.
pause
endlocal

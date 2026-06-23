@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal EnableDelayedExpansion

echo.
echo ================================================================
echo                  TdxQuant 停止服务
echo ================================================================
echo.

REM ---------- R18-B: 强制 UTF-8 环境 ----------
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

python scripts\dev.py stop
set EXIT_CODE=%ERRORLEVEL%

echo.
if "!EXIT_CODE!"=="0" (
    echo [OK] 服务已停止 ^(FastAPI + Next.js + 健康轮询^)
    echo.
    echo [注] QuestDB (R18 数据库, docker 容器) 不停止，保留数据持久化。
    echo      如需停止 QuestDB: docker compose -f docker\questdb\docker-compose.yml down
) else (
    echo [!] 停止脚本返回码 !EXIT_CODE!,可能服务未运行或已停止
)
echo.
pause
endlocal

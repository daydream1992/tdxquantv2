@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal EnableDelayedExpansion

echo.
echo ================================================================
echo                  TdxQuant 健康检查
echo ================================================================
echo.
echo 时间: %DATE% %TIME%
echo.

REM ---------- R18-B: 强制 UTF-8 环境 ----------
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

REM ---------- [1/3] 后端 :8000 ----------
echo [1/3] 后端 FastAPI  (http://127.0.0.1:8000/health)
echo ----------------------------------------------------------------
curl -s -o nul -w "HTTP 状态码: %%{http_code}\n" http://127.0.0.1:8000/health
set BE_EXIT=%ERRORLEVEL%
if "!BE_EXIT!"=="0" (
    echo [OK] 后端可达
) else (
    echo [X] 后端不可达 ^(curl exit=!BE_EXIT!^)
    echo     检查: 1^) 是否运行 start.bat  2^) 端口 8000 是否被占用
)
echo.

REM ---------- [2/3] 前端 :3000 ----------
echo [2/3] 前端 Next.js  (http://127.0.0.1:3000/)
echo ----------------------------------------------------------------
curl -s -o nul -w "HTTP 状态码: %%{http_code}\n" http://127.0.0.1:3000/
set FE_EXIT=%ERRORLEVEL%
if "!FE_EXIT!"=="0" (
    echo [OK] 前端可达
) else (
    echo [X] 前端不可达 ^(curl exit=!FE_EXIT!^)
    echo     检查: 1^) 是否运行 start.bat  2^) 端口 3000 是否被占用
)
echo.

REM ---------- [3/3] QuestDB :9000 (R18) ----------
echo [3/3] QuestDB Web 控制台  (http://127.0.0.1:9000/)
echo ----------------------------------------------------------------
curl -s -o nul -w "HTTP 状态码: %%{http_code}\n" http://127.0.0.1:9000/ 2>nul
set QDB_EXIT=%ERRORLEVEL%
if "!QDB_EXIT!"=="0" (
    echo [OK] QuestDB 可达 (R18 数据库运行中)
) else (
    echo [!] QuestDB 不可达 ^(curl exit=!QDB_EXIT!^)
    echo     Mock 模式可忽略; Real 模式建议双击 start-questdb.bat 启动
    echo     PG wire 端口: 8812 ^(psycopg2 连接^)
)
echo.

echo ================================================================
echo                  打开浏览器...
echo ================================================================
echo.
start http://127.0.0.1:3000
echo.
pause
endlocal

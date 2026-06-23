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

REM ---------- 后端 :8000 ----------
echo [1/2] 后端 FastAPI  (http://127.0.0.1:8000/health)
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

REM ---------- 前端 :3000 ----------
echo [2/2] 前端 Next.js  (http://127.0.0.1:3000/)
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

echo ================================================================
echo                  打开浏览器...
echo ================================================================
echo.
start http://127.0.0.1:3000
echo.
pause
endlocal

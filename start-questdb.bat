@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal EnableDelayedExpansion

echo.
echo ================================================================
echo                  TdxQuant QuestDB 启动 (R18)
echo ================================================================
echo.
echo 项目目录: %CD%
echo 时间: %DATE% %TIME%
echo.

REM ============================================================
REM R18: QuestDB 替代 DuckDB（服务端架构，无文件锁）
REM
REM 本脚本启动 QuestDB 服务，供 FastAPI 引擎通过 PG wire (8812)
REM / HTTP (9000) 访问。两种方式二选一：
REM   方式 A：Docker（推荐，需已装 Docker Desktop）
REM   方式 B：questdb.exe（便携版，无 Docker 时用）
REM
REM 配置见 config/app.yaml 的 questdb 段：
REM   host=127.0.0.1  pg_port=8812  http_port=9000
REM ============================================================

set COMPOSE_FILE=docker\questdb\docker-compose.yml

REM ---------- 方式 A：优先用 docker compose ----------
echo [1/3] 检查 Docker 是否可用 ...
where docker >nul 2>&1
if "!ERRORLEVEL!"=="0" (
    echo [OK] docker 已安装
    docker info >nul 2>&1
    if not "!ERRORLEVEL!"=="0" (
        echo [!] Docker 守护进程未运行，请启动 Docker Desktop 后重试
        echo     或继续用方式 B（questdb.exe），见下方提示
        echo.
        pause
        exit /b 1
    )
    echo.
    echo [2/3] 用 docker compose 启动 QuestDB ...
    echo       compose 文件: %COMPOSE_FILE%
    echo.
    docker compose -f %COMPOSE_FILE% up -d
    set COMPOSE_EXIT=!ERRORLEVEL!
    if not "!COMPOSE_EXIT!"=="0" (
        echo.
        echo [X] docker compose 启动失败 ^(exit=!COMPOSE_EXIT!^)
        echo     检查: 1^) %COMPOSE_FILE% 是否存在  2^) 端口 8812/9000/9009 是否被占用
        echo.
        pause
        exit /b 1
    )
    echo.
    echo [OK] QuestDB 容器已启动
    echo.
    echo [3/3] 等待 QuestDB 就绪 (最多 30s) ...
    set /a TRIES=0
    :WAIT_LOOP
    set /a TRIES+=1
    curl -s -o nul -w "HTTP %%{http_code}" http://127.0.0.1:9000/ 2>nul | findstr 200 >nul
    if "!ERRORLEVEL!"=="0" goto READY
    if !TRIES! GEQ 15 (
        echo.
        echo [!] QuestDB 30s 内未就绪，可能仍在初始化
        echo     Web 控制台: http://127.0.0.1:9000
        echo     日志: docker compose -f %COMPOSE_FILE% logs
        echo.
        pause
        exit /b 0
    )
    echo   等待中 ... ^(!TRIES!/15^)
    timeout /t 2 /nobreak >nul
    goto WAIT_LOOP
    :READY
    echo.
    echo [OK] QuestDB 已就绪
    echo.
    echo ================================================================
    echo                  QuestDB 启动成功
    echo ================================================================
    echo   PG wire   : 127.0.0.1:8812  ^(psycopg2 / engine 用^)
    echo   HTTP/Web  : http://127.0.0.1:9000
    echo   ILP       : 127.0.0.1:9009
    echo.
    echo   停止: docker compose -f %COMPOSE_FILE% down
    echo   日志: docker compose -f %COMPOSE_FILE% logs -f
    echo ================================================================
    echo.
    pause
    exit /b 0
)

REM ---------- 方式 B：无 Docker 时引导用 questdb.exe ----------
echo [!] docker 未安装 / 未加入 PATH
echo.
echo ================================================================
echo                  方式 B: 用 questdb.exe 启动
echo ================================================================
echo.
echo 步骤:
echo   1. 下载 QuestDB Windows 便携版:
echo      https://github.com/questdb/questdb/releases
echo      选 questdb-<version>-bin-windows-amd64.zip
echo.
echo   2. 解压到任意目录，例如: K:\questdb
echo      解压后应有: K:\questdb\questdb.exe
echo.
echo   3. 启动 QuestDB:
echo      cd /d K:\questdb
echo      questdb.exe start -d K:\questdb\data
echo.
echo   4. 验证: 浏览器打开 http://127.0.0.1:9000
echo.
echo   5. 持久化: -d 指定的数据目录会保存表/数据，重启不丢
echo.
echo ================================================================
echo.
echo 也可改用 Docker Desktop ^(推荐^):
echo   https://www.docker.com/products/docker-desktop/
echo.
echo 启动 QuestDB 后再运行 start.bat 启动 TdxQuant 主服务。
echo.
pause
exit /b 0

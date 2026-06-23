@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal EnableDelayedExpansion

echo.
echo ================================================================
echo                  TdxQuant 一键安装
echo ================================================================
echo.
echo 项目目录: %CD%
echo 时间: %DATE% %TIME%
echo.
echo 将依次执行:
echo   1. 预检环境 (Python / pip / 通达信 / 端口)
echo   2. 装依赖 + 初始化数据库 (scripts/dev.py setup)
echo   3. 自动安装 tqcenter (通达信官方 API)
echo   4. 创建桌面快捷方式
echo   5. 输出最终就绪度报告
echo.

REM ========== Step 1: 预检 ==========
echo ----------------------------------------------------------------
echo [1/5] 预检环境 (scripts/precheck.py)
echo ----------------------------------------------------------------
python scripts\precheck.py
set PRECHECK_EXIT=%ERRORLEVEL%
if not "!PRECHECK_EXIT!"=="0" (
    echo.
    echo [X] 预检失败 ^(exit=!PRECHECK_EXIT!^)。请按提示修复后重试。
    echo.
    echo 提示: 运行 `python scripts\precheck.py --fix` 可尝试自动修复部分问题。
    echo.
    pause
    exit /b 1
)
echo.
echo [OK] 预检通过。
echo.

REM ========== Step 2: 装依赖 + 初始化数据库 ==========
echo ----------------------------------------------------------------
echo [2/5] 装依赖 + 初始化数据库 (scripts/dev.py setup)
echo ----------------------------------------------------------------
python scripts\dev.py setup
set SETUP_EXIT=%ERRORLEVEL%
if not "!SETUP_EXIT!"=="0" (
    echo.
    echo [X] 安装依赖失败 ^(exit=!SETUP_EXIT!^)。请查看上方日志。
    echo.
    pause
    exit /b 1
)
echo.
echo [OK] 依赖 + 数据库初始化完成。
echo.

REM ========== Step 3: 安装 tqcenter ==========
echo ----------------------------------------------------------------
echo [3/5] 安装 tqcenter (scripts/install_tqcenter.py)
echo ----------------------------------------------------------------
python scripts\install_tqcenter.py
set TQ_EXIT=%ERRORLEVEL%
if not "!TQ_EXIT!"=="0" (
    echo.
    echo [!] tqcenter 安装失败 ^(exit=!TQ_EXIT!^)。
    echo     tqcenter 是 Windows 专用包,来自通达信终端目录。
    echo     如已手动 pip install,可忽略本提示。
    echo     否则请运行: python scripts\install_tqcenter.py --list
    echo     或手动: python scripts\install_tqcenter.py --path "C:\new_tdx"
    echo.
) else (
    echo.
    echo [OK] tqcenter 处理完成。
)
echo.

REM ========== Step 4: 创建桌面快捷方式 ==========
echo ----------------------------------------------------------------
echo [4/5] 创建桌面快捷方式 (scripts/create_shortcut.py)
echo ----------------------------------------------------------------
python scripts\create_shortcut.py
set SC_EXIT=%ERRORLEVEL%
if not "!SC_EXIT!"=="0" (
    echo.
    echo [!] 快捷方式创建失败 ^(exit=!SC_EXIT!^)。不影响主程序使用。
    echo.
) else (
    echo.
    echo [OK] 桌面快捷方式已创建 (TdxQuant 启动 / 停止 / 大屏.url)。
)
echo.

REM ========== Step 5: 最终预检报告 ==========
echo ----------------------------------------------------------------
echo [5/5] 最终就绪度报告 (scripts/precheck.py)
echo ----------------------------------------------------------------
python scripts\precheck.py
echo.

REM ========== 完成 ==========
echo ================================================================
echo                  安装完成!
echo ================================================================
echo.
echo  下一步: 双击 start.bat 启动
echo  或:    双击桌面 "TdxQuant 启动" 快捷方式
echo.
echo  静默后台启动: 双击 tdxquant-launcher.vbs
echo  健康检查:     双击 tdxquant-healthcheck.bat
echo  开机自启:     见 windows\TdxQuantAutoStart.xml
echo.
echo  详细使用说明: WINDOWS_README.md
echo.
pause
endlocal

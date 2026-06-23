#!/usr/bin/env python3
"""tqcenter 路径配置器 (Windows 专用).

tqcenter 不是 PyPI 包, 是通达信终端目录下的 Python 文件 (通常在
``<通达信>\\PYPlugins\\user\\tqcenter.py``)。RealAdapter 通过 ``sys.path.insert``
动态加入路径后 ``from tqcenter import tq`` 导入, 不需要 pip install。

本脚本的作用:
1. 扫描通达信常见安装路径, 找到含 tqcenter.py 的目录
2. 把找到的路径写入 ``config/app.yaml`` 的 ``tqcenter.python_path`` 字段
3. 验证 tqcenter 可正常 import

用法
----
    python scripts/install_tqcenter.py                  # 自动扫描 + 写入配置
    python scripts/install_tqcenter.py --list           # 只列出候选路径, 不写入
    python scripts/install_tqcenter.py --path <path>    # 手动指定 tqcenter.py 所在目录
    python scripts/install_tqcenter.py --env            # 输出环境变量设置命令 (不写配置)
"""
from __future__ import annotations

import argparse
import platform
import re
import sys
from pathlib import Path
from typing import Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent
IS_WINDOWS = platform.system() == "Windows"

# 通达信终端常见安装路径 (Windows), 含用户实际路径 K:\txdlianghua
TDX_COMMON_PATHS = [
    r"C:\new_tdx", r"D:\new_tdx", r"E:\new_tdx", r"F:\new_tdx",
    r"C:\通达信", r"D:\通达信", r"E:\通达信", r"F:\通达信",
    r"C:\Program Files\通达信", r"D:\Program Files\通达信",
    r"C:\Program Files (x86)\通达信",
    r"K:\txdlianghua",  # 用户实际安装路径
]

# 在通达信根目录下查找 tqcenter.py 的候选子路径
TQCENTER_SUBPATHS = [
    "PYPlugins\\user",            # 新版通达信: K:\txdlianghua\PYPlugins\user\tqcenter.py
    "T0002\\hq_cache\\PythonLib",  # 旧版: T0002\hq_cache\PythonLib\tqcenter.py
    "Python\\site-packages",      # 嵌入式 Python 环境
    "PYPlugins",                  # 简化路径
]


def find_tqcenter_dirs() -> list[Path]:
    """扫描所有通达信常见路径, 返回包含 tqcenter.py 的目录列表."""
    found: list[Path] = []
    for tdx_root in TDX_COMMON_PATHS:
        root = Path(tdx_root)
        if not root.exists():
            continue
        for sub in TQCENTER_SUBPATHS:
            candidate = root / sub
            if (candidate / "tqcenter.py").exists():
                found.append(candidate)
            elif (candidate / "tqcenter" / "__init__.py").exists():
                found.append(candidate / "tqcenter")
    return found


def verify_tqcenter_import(tq_dir: Path) -> tuple[bool, str]:
    """验证从指定目录能否 import tqcenter。返回 (ok, err_msg)。"""
    import os
    import sys as _sys
    tq_dir_str = str(tq_dir)
    if tq_dir_str not in _sys.path:
        _sys.path.insert(0, tq_dir_str)
    try:
        import tqcenter  # noqa: F401,PLC0415
        return True, ""
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


def write_to_app_yaml(tq_dir: Path) -> tuple[bool, str]:
    """把 python_path 写入 config/app.yaml 的 tqcenter 段。返回 (ok, msg)。"""
    app_yaml = PROJECT_ROOT / "config" / "app.yaml"
    if not app_yaml.exists():
        return False, f"配置文件不存在: {app_yaml}"
    text = app_yaml.read_text(encoding="utf-8")
    tq_dir_str = str(tq_dir).replace("\\", "\\\\")  # YAML 中反斜杠需转义
    # 匹配 python_path: "xxx" 或 python_path: "" 或 python_path: (无值)
    pattern = re.compile(r'^(python_path:\s*)(""|\'\'|)[^\n]*$', re.M)
    new_line = f'python_path: "{tq_dir_str}"'
    if pattern.search(text):
        new_text = pattern.sub(lambda m: new_line, text, count=1)
    else:
        # tqcenter 段不存在 python_path 字段, 在 initialize_file 前插入
        new_text = text.replace(
            "  initialize_file:",
            f'  python_path: "{tq_dir_str}"\n  initialize_file:',
            1,
        )
    if new_text == text:
        return False, "配置文件已含相同路径, 无需修改"
    app_yaml.write_text(new_text, encoding="utf-8")
    return True, f"已写入 config/app.yaml: tqcenter.python_path = {tq_dir}"


def print_env_commands(tq_dir: Path) -> None:
    """输出设置环境变量的命令 (cmd + PowerShell 两种)。"""
    print(f"[INFO] 环境变量设置命令 (临时, 当前会话有效):")
    print(f"  cmd:        set TQ_CENTER_PATH={tq_dir}")
    print(f"  PowerShell: $env:TQ_CENTER_PATH = '{tq_dir}'")
    print()
    print(f"[INFO] 永久环境变量 (用户级, 重启终端生效):")
    print(f"  PowerShell: [Environment]::SetEnvironmentVariable('TQ_CENTER_PATH', '{tq_dir}', 'User')")
    print()


def main() -> int:
    parser = argparse.ArgumentParser(description="tqcenter 路径配置器 (Windows 专用)")
    parser.add_argument("--list", action="store_true", help="列出所有候选路径, 不写入配置")
    parser.add_argument("--path", type=str, default="",
                        help="手动指定 tqcenter.py 所在目录")
    parser.add_argument("--env", action="store_true",
                        help="输出环境变量设置命令, 不写 config/app.yaml")
    args = parser.parse_args()

    if not IS_WINDOWS:
        print(f"[INFO] tqcenter 是 Windows 专用, 跳过 (当前: {platform.system()})")
        print("       如需在 Windows 上配置, 请在 Windows 环境运行本脚本")
        return 0

    # 1. 收集候选路径
    if args.path:
        tq_dir = Path(args.path)
        if not tq_dir.exists():
            print(f"[FAIL] 指定路径不存在: {args.path}")
            return 1
        if not (tq_dir / "tqcenter.py").exists() and not (tq_dir / "tqcenter" / "__init__.py").exists():
            print(f"[FAIL] 指定路径下未找到 tqcenter.py 或 tqcenter/__init__.py: {args.path}")
            return 1
        candidates = [tq_dir]
    else:
        candidates = find_tqcenter_dirs()

    # 2. 列出模式
    if args.list:
        if not candidates:
            print("[INFO] 未找到 tqcenter.py")
            print("       请确认通达信终端已安装, 或手动指定: --path <含 tqcenter.py 的目录>")
            print(f"       扫描的通达信根路径: {', '.join(TDX_COMMON_PATHS)}")
            print(f"       在每个根下查的子路径: {', '.join(TQCENTER_SUBPATHS)}")
            return 0
        print(f"[INFO] 找到 {len(candidates)} 个含 tqcenter.py 的目录:")
        for c in candidates:
            print(f"  - {c}")
        return 0

    # 3. 安装/配置模式
    if not candidates:
        print("[FAIL] 未找到 tqcenter.py")
        print("       请确认通达信终端已安装, 或手动指定: --path <含 tqcenter.py 的目录>")
        print(f"       扫描的通达信根路径: {', '.join(TDX_COMMON_PATHS)}")
        return 1

    tq_dir = candidates[0]
    print(f"[INFO] 使用路径: {tq_dir}")

    # 4. 验证 import
    ok, err = verify_tqcenter_import(tq_dir)
    if ok:
        print("[OK]   import tqcenter 验证通过 ✅")
    else:
        print(f"[WARN] import tqcenter 失败 (可能缺 DLL 或终端未启动): {err}")
        print("       不影响配置写入, 但 Real 模式启动时需先启动通达信终端")

    # 5. 写入配置 或 输出环境变量命令
    if args.env:
        print_env_commands(tq_dir)
        return 0

    ok, msg = write_to_app_yaml(tq_dir)
    if ok:
        print(f"[OK]   {msg}")
    else:
        print(f"[WARN] {msg}")
    print()
    print("[INFO] 下一步: 启动通达信终端并登录, 然后双击 start.bat")
    print("       验证: curl http://127.0.0.1:8000/api/monitor?action=status 应返回 adapter=real")
    return 0 if ok else 0  # 即使已存在也返回 0


if __name__ == "__main__":
    sys.exit(main())

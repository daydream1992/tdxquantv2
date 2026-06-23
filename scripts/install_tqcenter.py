#!/usr/bin/env python3
"""tqcenter 自动安装器 (Windows 专用).

扫描通达信终端安装路径, 找到 tqcenter 包并 pip install.
Linux 上跑会提示 "tqcenter 是 Windows 专用, 跳过自动安装".

用法
----
    python scripts/install_tqcenter.py                  # 自动扫描 + 安装
    python scripts/install_tqcenter.py --list           # 只列出候选路径, 不安装
    python scripts/install_tqcenter.py --path <path>    # 手动指定 tqcenter 路径
"""
from __future__ import annotations

import argparse
import platform
import subprocess
import sys
from pathlib import Path
from typing import Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent
IS_WINDOWS = platform.system() == "Windows"

# 通达信终端常见安装路径 (Windows)
TDX_COMMON_PATHS = [
    r"C:\new_tdx",
    r"D:\new_tdx",
    r"C:\通达信",
    r"D:\通达信",
    r"C:\Program Files\通达信",
    r"D:\Program Files\通达信",
]


def find_tdx_roots() -> list[Path]:
    """扫描通达信终端安装路径, 返回存在的根目录列表."""
    return [Path(p) for p in TDX_COMMON_PATHS if Path(p).exists()]


def find_tqcenter_candidates(tdx_root: Path) -> list[tuple[str, Path, Path]]:
    """在通达信根目录下查找 tqcenter 候选位置.

    返回 [(kind, tqcenter_pkg_dir, pip_install_target), ...]:
      - kind="package": tqcenter 本身是包目录 (含 __init__.py), pip install -e <parent>
      - kind="parent":  parent 目录下有 tqcenter/ 子目录, pip install -e <parent>
    """
    candidates: list[tuple[str, Path, Path]] = []
    # 1. <tdx>/T0002/hq_cache/PythonLib/tqcenter/  (tqcenter 是包本身)
    p1 = tdx_root / "T0002" / "hq_cache" / "PythonLib" / "tqcenter"
    if (p1 / "__init__.py").exists():
        candidates.append(("package", p1, p1.parent))
    # 2. <tdx>/T0002/hq_cache/PythonLib/  (包含 tqcenter 子目录)
    p2 = tdx_root / "T0002" / "hq_cache" / "PythonLib"
    if (p2 / "tqcenter" / "__init__.py").exists():
        candidates.append(("parent", p2 / "tqcenter", p2))
    # 3. <tdx>/Python/site-packages/tqcenter/
    p3 = tdx_root / "Python" / "site-packages" / "tqcenter"
    if (p3 / "__init__.py").exists():
        candidates.append(("package", p3, p3.parent))
    return candidates


def find_all_candidates() -> list[tuple[str, Path, Path]]:
    """扫描所有通达信目录, 返回所有候选路径."""
    all_c: list[tuple[str, Path, Path]] = []
    for root in find_tdx_roots():
        all_c.extend(find_tqcenter_candidates(root))
    return all_c


def pip_install_tqcenter(parent_dir: Path) -> tuple[bool, str]:
    """pip install tqcenter. 优先 -e 可编辑模式, 失败则 --find-links."""
    # 优先 -e (可编辑, 适合 tqcenter 是包目录的情况)
    r = subprocess.run(
        [sys.executable, "-m", "pip", "install", "-e", str(parent_dir)],
        capture_output=True, text=True, cwd=PROJECT_ROOT,
    )
    if r.returncode == 0:
        return True, r.stdout
    # 退而求其次: --find-links
    r2 = subprocess.run(
        [sys.executable, "-m", "pip", "install", "--no-index",
         "--find-links", str(parent_dir), "tqcenter"],
        capture_output=True, text=True, cwd=PROJECT_ROOT,
    )
    if r2.returncode == 0:
        return True, r2.stdout
    return False, (r.stderr + "\n" + r2.stderr).strip()


def verify_tqcenter() -> bool:
    """验证 tqcenter 可 import."""
    try:
        import tqcenter  # noqa: F401,PLC0415
        return True
    except ImportError:
        return False


def resolve_candidates_from_path(path_str: str) -> list[tuple[str, Path, Path]]:
    """从用户指定的 --path 解析候选. 返回空列表表示路径无效."""
    p = Path(path_str)
    if not p.exists():
        return []
    if (p / "__init__.py").exists():
        return [("package", p, p.parent)]
    if (p / "tqcenter" / "__init__.py").exists():
        return [("parent", p / "tqcenter", p)]
    return []


def main() -> int:
    parser = argparse.ArgumentParser(description="tqcenter 自动安装器 (Windows 专用)")
    parser.add_argument("--list", action="store_true", help="列出所有候选路径, 不安装")
    parser.add_argument("--path", type=str, default="",
                        help="手动指定 tqcenter 路径 (含 __init__.py 的目录, 或其父目录)")
    args = parser.parse_args()

    if not IS_WINDOWS:
        print(f"[INFO] tqcenter 是 Windows 专用, 跳过自动安装 (当前: {platform.system()})")
        print("       如需在 Windows 上安装, 请在 Windows 环境运行本脚本")
        return 0

    # 1. 收集候选路径
    if args.path:
        candidates = resolve_candidates_from_path(args.path)
        if not candidates:
            print(f"[FAIL] 指定路径不是有效的 tqcenter 目录: {args.path}")
            print("       路径应包含 __init__.py (tqcenter 包目录) 或包含 tqcenter/ 子目录")
            return 1
    else:
        candidates = find_all_candidates()

    # 2. 列出模式
    if args.list:
        if not candidates:
            print("[INFO] 未找到 tqcenter 候选路径")
            print("       请确认通达信终端已安装, 或手动指定: --path <path>")
            print(f"       扫描的路径: {', '.join(TDX_COMMON_PATHS)}")
            return 0
        print(f"[INFO] 找到 {len(candidates)} 个候选路径:")
        for kind, pkg, parent in candidates:
            print(f"  - [{kind}] {pkg}")
            print(f"      安装命令: pip install -e {parent}")
        return 0

    # 3. 安装模式
    if not candidates:
        print("[FAIL] 未找到 tqcenter 候选路径")
        print("       请确认通达信终端已安装, 或手动指定: --path <path>")
        print(f"       扫描的路径: {', '.join(TDX_COMMON_PATHS)}")
        return 1

    print(f"[INFO] 找到 {len(candidates)} 个候选路径, 尝试用第一个安装 ...")
    kind, pkg, parent = candidates[0]
    print(f"       类型: {kind}")
    print(f"       包目录: {pkg}")
    print(f"       pip 目标: {parent}")

    ok, msg = pip_install_tqcenter(parent)
    if ok:
        print("[OK]   pip install 成功")
    else:
        print("[FAIL] pip install 失败:")
        print(msg)
        print("       请手动尝试:")
        print(f"       pip install -e {parent}")
        return 1

    # 4. 验证 import
    if verify_tqcenter():
        print("[OK]   import tqcenter 验证通过 ✅")
        return 0
    else:
        print("[FAIL] import tqcenter 失败 ❌")
        print("       可能需要重启 Python 解释器, 或检查 PYTHONPATH")
        return 1


if __name__ == "__main__":
    sys.exit(main())

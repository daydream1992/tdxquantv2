#!/usr/bin/env python3
"""桌面快捷方式创建器 (Windows 专用).

在桌面创建 TdxQuant 启动/停止/大屏 3 个快捷方式.
Linux 上跑会提示 "快捷方式仅 Windows 支持".

用法
----
    python scripts/create_shortcut.py
"""
from __future__ import annotations

import os
import platform
import subprocess
import sys
from pathlib import Path
from typing import Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent
IS_WINDOWS = platform.system() == "Windows"


def _desktop_dir() -> Path:
    """获取桌面目录 (Windows). 兼容英文 Desktop 与中文 桌面."""
    home = Path(os.environ.get("USERPROFILE", Path.home()))
    desktop = home / "Desktop"
    if desktop.exists():
        return desktop
    desktop_cn = home / "桌面"
    if desktop_cn.exists():
        return desktop_cn
    return desktop  # 返回默认, 由调用方处理不存在的情况


def _ps_escape(s: str) -> str:
    """PowerShell 单引号转义: ' → ''."""
    return s.replace("'", "''")


def _create_lnk_via_powershell(
    lnk_path: Path, target: Path, work_dir: Path,
    icon: Optional[Path] = None, arguments: str = "",
) -> tuple[bool, str]:
    """用 PowerShell WScript.Shell COM 创建 .lnk 快捷方式.

    优先用 PowerShell (避免依赖 pywin32), 返回 (是否成功, 错误信息).
    """
    ps_lines = [
        "$ws = New-Object -ComObject WScript.Shell",
        f"$lnk = $ws.CreateShortcut('{_ps_escape(str(lnk_path))}')",
        f"$lnk.TargetPath = '{_ps_escape(str(target))}'",
        f"$lnk.WorkingDirectory = '{_ps_escape(str(work_dir))}'",
    ]
    if arguments:
        ps_lines.append(f"$lnk.Arguments = '{_ps_escape(arguments)}'")
    if icon and icon.exists():
        ps_lines.append(f"$lnk.IconLocation = '{_ps_escape(str(icon))}'")
    ps_lines.append("$lnk.Save()")
    ps_script = "; ".join(ps_lines)
    r = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
        capture_output=True, text=True,
    )
    return r.returncode == 0, r.stderr.strip()


def _create_url_file(url_path: Path, url: str, icon: Optional[Path] = None) -> bool:
    """创建 .url 文件 (INI 格式, 无需 COM)."""
    content = ["[InternetShortcut]", f"URL={url}"]
    if icon and icon.exists():
        content.append(f"IconFile={icon}")
        content.append("IconIndex=0")
    content.append("")
    try:
        url_path.write_text("\r\n".join(content), encoding="utf-8")
        return True
    except Exception:
        return False


def main() -> int:
    if not IS_WINDOWS:
        print(f"[INFO] 快捷方式仅 Windows 支持 (当前: {platform.system()})")
        return 0

    desktop = _desktop_dir()
    if not desktop.exists():
        print(f"[FAIL] 桌面目录不存在: {desktop}")
        return 1

    print(f"[INFO] 桌面目录: {desktop}")
    print(f"[INFO] 项目根:   {PROJECT_ROOT}")

    icon = PROJECT_ROOT / "public" / "favicon.ico"
    if not icon.exists():
        print(f"[WARN] 图标不存在, 快捷方式将使用系统默认图标: {icon}")
        icon = None

    results: list[tuple[str, Path, bool, str]] = []

    # 1. TdxQuant 启动.lnk → start.bat
    start_bat = PROJECT_ROOT / "start.bat"
    lnk1 = desktop / "TdxQuant 启动.lnk"
    ok1, err1 = _create_lnk_via_powershell(lnk1, start_bat, PROJECT_ROOT, icon)
    results.append(("启动", lnk1, ok1, err1))

    # 2. TdxQuant 停止.lnk → stop.bat
    stop_bat = PROJECT_ROOT / "stop.bat"
    lnk2 = desktop / "TdxQuant 停止.lnk"
    ok2, err2 = _create_lnk_via_powershell(lnk2, stop_bat, PROJECT_ROOT, icon)
    results.append(("停止", lnk2, ok2, err2))

    # 3. TdxQuant 大屏.url → http://127.0.0.1:3000
    url_file = desktop / "TdxQuant 大屏.url"
    ok3 = _create_url_file(url_file, "http://127.0.0.1:3000", icon)
    results.append(("大屏", url_file, ok3, ""))

    # 汇总
    print()
    n_ok = 0
    for name, path, ok, err in results:
        if ok:
            print(f"  [OK]   {name}: {path.name}")
            n_ok += 1
        else:
            print(f"  [FAIL] {name}: {path.name} — {err}")

    print()
    if n_ok == len(results):
        print(f"[OK] 已创建 {n_ok} 个桌面快捷方式")
        return 0
    else:
        print(f"[WARN] 成功 {n_ok}/{len(results)}, 失败的请手动创建")
        return 1


if __name__ == "__main__":
    sys.exit(main())

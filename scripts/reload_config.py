#!/usr/bin/env python3
"""热加载配置（策略 YAML / 通道 / 清洗规则等）。

用法
----
    python scripts/reload_config.py            # 重载并打印策略清单
    python scripts/reload_config.py --json     # JSON 输出

触发 ``ConfigLoader.reload()``，重新扫描 ``config/*.yaml`` 与 ``strategies/*.yaml``。
引擎自身的 mtime 监听器（2s 间隔）会自动发现变更，本脚本用于"立即触发"或离线环境验证。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def main() -> None:
    parser = argparse.ArgumentParser(description="热加载 YAML 配置")
    parser.add_argument("--json", action="store_true", help="JSON 输出")
    args = parser.parse_args()

    try:
        from engine.config.loader import ConfigLoader
        from engine.utils.logger import setup_logging
    except ImportError as exc:
        print(f"[ERROR] 导入引擎失败: {exc}", file=sys.stderr)
        sys.exit(1)

    setup_logging(level="INFO")
    cfg = ConfigLoader()

    # 重载前快照
    before_strategies = set((cfg.strategies() or {}).keys())
    before_files: set[str] = set()
    try:
        before_files = {str(p) for p in cfg._file_mtimes.keys()}  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass

    cfg.reload()

    after_strategies = cfg.strategies() or {}
    after_files: set[str] = set()
    try:
        after_files = {str(p) for p in cfg._file_mtimes.keys()}  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass

    added = after_strategies.keys() - before_strategies
    removed = before_strategies - after_strategies.keys()
    new_files = after_files - before_files

    strategies_summary = [
        {
            "strategy_id": sid,
            "strategy_name": getattr(sc, "strategy_name", ""),
            "enabled": bool(getattr(sc, "enabled", True)),
            "yaml_path": getattr(sc, "yaml_path", ""),
        }
        for sid, sc in after_strategies.items()
    ]

    if args.json:
        print(json.dumps({
            "ok": True,
            "strategies_count": len(after_strategies),
            "added": sorted(added),
            "removed": sorted(removed),
            "changed_files": sorted(new_files),
            "all_files": sorted(after_files),
            "strategies": strategies_summary,
        }, ensure_ascii=False, indent=2))
        return

    print("配置已重新加载")
    print(f"策略数: {len(after_strategies)}")
    if added:
        print(f"  新增: {sorted(added)}")
    if removed:
        print(f"  移除: {sorted(removed)}")
    print()
    for s in strategies_summary:
        flag = "启用" if s["enabled"] else "禁用"
        print(f"  - {s['strategy_id']}: {s['strategy_name']} ({flag}) [{s['yaml_path']}]")
    print()
    print(f"涉及的配置文件（共 {len(after_files)} 个）:")
    for p in sorted(after_files):
        print(f"  - {p}")


if __name__ == "__main__":
    main()

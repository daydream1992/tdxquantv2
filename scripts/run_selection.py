#!/usr/bin/env python3
"""手动执行选股策略。

用法
----
    python scripts/run_selection.py                 # 执行所有启用的策略
    python scripts/run_selection.py dbqzt           # 仅执行指定策略
    python scripts/run_selection.py dbqzt qszsl     # 执行多个策略
    python scripts/run_selection.py --all           # 包括已禁用的策略
    python scripts/run_selection.py --json          # JSON 输出（便于下游消费）

依赖：P1-3 ConfigLoader / DuckDBStore / BaseDataAdapter + P1-4 StrategyRunner
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def _format_summary(sid: str, ctx: Any) -> dict[str, Any]:
    n_final = 0 if ctx.final is None else len(ctx.final)
    return {
        "strategy_id": sid,
        "run_id": getattr(ctx, "run_id", ""),
        "count": n_final,
        "duration_sec": round(getattr(ctx, "duration_sec", 0.0) or 0.0, 3),
        "started_at": getattr(ctx, "started_at", None).isoformat() if getattr(ctx, "started_at", None) else None,
        "finished_at": getattr(ctx, "finished_at", None).isoformat() if getattr(ctx, "finished_at", None) else None,
        "warnings": (getattr(ctx, "metadata", {}) or {}).get("warnings", []),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="手动执行选股策略")
    parser.add_argument(
        "strategy_ids",
        nargs="*",
        help="策略 ID 列表（不传则执行所有启用的策略）",
    )
    parser.add_argument("--all", action="store_true", help="包括已禁用的策略")
    parser.add_argument("--json", action="store_true", help="JSON 输出")
    args = parser.parse_args()

    try:
        from engine.config.loader import ConfigLoader
        from engine.data_adapter.factory import get_adapter
        from engine.pipeline.runner import StrategyRunner
        from engine.storage.duckdb_store import DuckDBStore
        from engine.utils.logger import setup_logging
    except ImportError as exc:
        print(f"[ERROR] 导入引擎模块失败: {exc}", file=sys.stderr)
        print("请确认在项目根目录运行：cd /home/z/my-project", file=sys.stderr)
        sys.exit(1)

    setup_logging(level="INFO")

    cfg = ConfigLoader()
    storage = DuckDBStore()
    adapter = get_adapter()
    runner = StrategyRunner(
        adapter=adapter,
        storage=storage,
        strategies_dir=cfg.get("paths.strategies_dir", "./strategies"),
    )

    # 决定要执行的策略列表
    if args.strategy_ids:
        target_ids = args.strategy_ids
    else:
        all_strategies = cfg.strategies() or {}
        if args.all:
            target_ids = sorted(all_strategies.keys())
        else:
            target_ids = sorted(
                sid for sid, sc in all_strategies.items() if getattr(sc, "enabled", True)
            )

    if not target_ids:
        msg = "无可执行的策略（strategies/ 目录为空或全部被禁用）"
        if args.json:
            print(json.dumps({"ok": False, "message": msg, "results": []}, ensure_ascii=False))
        else:
            print(msg)
        sys.exit(0)

    if not args.json:
        print(f"准备执行 {len(target_ids)} 个策略: {target_ids}")
        print("-" * 60)

    summaries: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    for sid in target_ids:
        if not args.json:
            print(f"→ 执行策略 {sid} ...")
        try:
            ctx = runner.run_strategy(sid)
            summary = _format_summary(sid, ctx)
            summaries.append(summary)
            if not args.json:
                print(f"  ✓ 策略 {sid} 完成: 选出 {summary['count']} 只, 耗时 {summary['duration_sec']}s")
        except Exception as exc:  # noqa: BLE001
            failed.append({"strategy_id": sid, "error": str(exc)})
            if not args.json:
                print(f"  ✗ 策略 {sid} 失败: {exc}")

    if not args.json:
        print("-" * 60)
        print(f"完成: 成功 {len(summaries)}, 失败 {len(failed)}, 共 {len(target_ids)} 个")
        for s in summaries:
            print(f"  - {s['strategy_id']}: {s['count']} 只 (run_id={s['run_id']})")
        for f in failed:
            print(f"  - {f['strategy_id']}: ERROR {f['error']}")
    else:
        print(json.dumps({
            "ok": len(failed) == 0,
            "total": len(target_ids),
            "success_count": len(summaries),
            "failed_count": len(failed),
            "results": summaries,
            "errors": failed,
        }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

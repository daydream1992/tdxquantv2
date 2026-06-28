"""CSV 日志通道 - 把每条信号追加到 ``logs/signals.csv``。

默认开启，不可关闭（``force_enabled=True``），用于审计与回溯。
"""

from __future__ import annotations

import csv
import logging
import os
import threading
from pathlib import Path

from engine.channels.base import BaseChannel, ChannelPayload, ChannelResult

logger = logging.getLogger(__name__)

_CSV_HEADER = [
    "signal_id",
    "time",
    "type",
    "strategy_id",
    "strategy_name",
    "stock_code",
    "stock_name",
    "severity",
    "priority",
    "title",
    "content",
]

_LOCK = threading.Lock()


class CsvLogChannel(BaseChannel):
    """CSV 文件日志通道。"""

    name = "csv_log"
    force_enabled = True

    def __init__(self, config: dict | None = None) -> None:
        super().__init__(config)
        # 默认 logs/signals.csv，可被 config["path"] 覆盖
        cfg_path = self.config.get("path", "")
        if cfg_path:
            self.path = Path(cfg_path)
        else:
            self.path = Path(os.getcwd()) / "logs" / "signals.csv"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # 首次写入时自动加表头
        if not self.path.exists() or self.path.stat().st_size == 0:
            try:
                with self.path.open("w", newline="", encoding="utf-8") as f:
                    writer = csv.writer(f)
                    writer.writerow(_CSV_HEADER)
            except OSError as exc:
                logger.warning("CsvLogChannel 初始化表头失败: %s", exc)

    def send(self, payload: ChannelPayload) -> ChannelResult:
        try:
            with _LOCK, self.path.open("a", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(
                    [
                        payload.signal_id,
                        payload.triggered_at.isoformat(timespec="seconds"),
                        payload.signal_type,
                        payload.strategy_id,
                        payload.strategy_name,
                        payload.stock_code,
                        payload.stock_name,
                        payload.severity,
                        payload.priority,
                        payload.display_title,
                        payload.content,
                    ]
                )
            return ChannelResult(
                channel=self.name,
                ok=True,
                message=f"appended to {self.path.name}",
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("CsvLogChannel 写入失败: %s", exc)
            return ChannelResult(channel=self.name, ok=False, message=str(exc))

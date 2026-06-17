"""日志配置工具。

日志路径来自 ``config/app.yaml`` 的 ``paths.logs``；日志级别来自
``app.log_level``。``setup_logging()`` 幂等，重复调用不会重复添加 handler。

约定：
- 控制台 handler：INFO 及以上彩色输出
- 文件 handler：``<logs>/engine.log``，按 10MB 轮转，保留 7 份
- 子 logger 自动继承 root 配置，无需业务模块自行设置
"""

from __future__ import annotations

import logging
import logging.handlers
import os
import sys
from pathlib import Path

# 复用 ConfigLoader，避免硬编码路径
_CONFIG_IMPORTED = False
try:
    from engine.config.loader import ConfigLoader

    _CONFIG_IMPORTED = True
except Exception:  # noqa: BLE001
    _CONFIG_IMPORTED = False


# 控制台彩色 formatter
class _ColorFormatter(logging.Formatter):
    """ANSI 颜色日志 formatter（仅 TTY 输出彩色，重定向时自动降级）。"""

    _COLORS = {
        "DEBUG": "\033[36m",  # cyan
        "INFO": "\033[32m",  # green
        "WARNING": "\033[33m",  # yellow
        "ERROR": "\033[31m",  # red
        "CRITICAL": "\033[1;31m",  # bold red
    }
    _RESET = "\033[0m"

    def __init__(self, fmt: str, datefmt: str | None = None, use_color: bool = True) -> None:
        super().__init__(fmt=fmt, datefmt=datefmt)
        self.use_color = use_color and sys.stderr.isatty()

    def format(self, record: logging.LogRecord) -> str:
        if self.use_color:
            color = self._COLORS.get(record.levelname, "")
            if color:
                record.levelname = f"{color}{record.levelname}{self._RESET}"
        return super().format(record)


_CONFIGURED = False


def setup_logging(
    *,
    level: str | None = None,
    log_dir: str | os.PathLike | None = None,
    log_file: str = "engine.log",
    max_bytes: int = 10 * 1024 * 1024,
    backup_count: int = 7,
    force: bool = False,
) -> logging.Logger:
    """初始化全局日志配置（幂等）。

    Args:
        level: 日志级别，默认从 ``config/app.yaml`` 的 ``app.log_level`` 读取。
        log_dir: 日志目录，默认从 ``config/app.yaml`` 的 ``paths.logs`` 读取。
        log_file: 日志文件名（位于 log_dir 下）。
        max_bytes: 单文件最大字节数，超过则轮转。
        backup_count: 轮转保留份数。
        force: 强制重新配置（移除已有 handler）。

    Returns:
        配置好的 root logger。
    """
    global _CONFIGURED
    if _CONFIGURED and not force:
        return logging.getLogger()

    # 从配置读取默认值
    cfg_level = "INFO"
    cfg_log_dir = "./data/logs"
    if _CONFIG_IMPORTED:
        try:
            loader = ConfigLoader()
            cfg_level = loader.get("app.log_level", cfg_level) or cfg_level
            cfg_log_dir = loader.get("paths.logs", cfg_log_dir) or cfg_log_dir
        except Exception:  # noqa: BLE001
            pass

    final_level = level or cfg_level
    final_log_dir = Path(log_dir) if log_dir is not None else _resolve_path(cfg_log_dir)
    final_log_dir.mkdir(parents=True, exist_ok=True)

    root = logging.getLogger()
    # 清理旧 handler
    for h in list(root.handlers):
        root.removeHandler(h)
    root.setLevel(final_level)

    fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    datefmt = "%Y-%m-%d %H:%M:%S"

    # 控制台 handler
    console = logging.StreamHandler(stream=sys.stderr)
    console.setLevel(final_level)
    console.setFormatter(_ColorFormatter(fmt=fmt, datefmt=datefmt))
    root.addHandler(console)

    # 文件 handler（轮转）
    try:
        file_path = final_log_dir / log_file
        file_handler = logging.handlers.RotatingFileHandler(
            filename=file_path,
            maxBytes=max_bytes,
            backupCount=backup_count,
            encoding="utf-8",
        )
        file_handler.setLevel(final_level)
        file_handler.setFormatter(logging.Formatter(fmt=fmt, datefmt=datefmt))
        root.addHandler(file_handler)
    except OSError as exc:
        # 文件系统不可写时仅控制台输出
        root.warning("无法创建日志文件 %s: %s", final_log_dir, exc)

    _CONFIGURED = True
    root.debug("logging 已初始化: level=%s, dir=%s", final_level, final_log_dir)
    return root


def get_logger(name: str) -> logging.Logger:
    """获取子 logger。

    使用前请确保已调用 ``setup_logging()``（一般由引擎入口自动调用）。
    """
    return logging.getLogger(name)


def _resolve_path(p: str) -> Path:
    """把配置中的相对路径解析为项目根的绝对路径。"""
    path = Path(p)
    if path.is_absolute():
        return path
    # 项目根 = engine/ 的父目录 = <root>/engine/utils/logger.py → 向上三级
    root = Path(__file__).resolve().parent.parent.parent
    return root / path

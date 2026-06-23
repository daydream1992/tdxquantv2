"""跨平台编码工具（Windows 默认 GBK，沙箱/容器默认 UTF-8）。

R18-B 引入：把"打开文件 / 读字符串 / 写字符串"统一到这里，避免每个调用点
都重复 ``encoding="utf-8"`` 和 try/except 降级。Windows 上仍可能遇到老的 GBK
日志或通达信返回的 GBK 字符串，本模块提供 ``safe_decode`` 做兜底。

约定
====

- **文本文件**：一律 UTF-8 读写。如果 UTF-8 解码失败，回退到 ``GBK`` / ``CP936``
  （Windows 中文系统默认），再不行就用 ``errors="replace"`` 防止崩溃。
- **stdin/stdout/stderr**：``set_utf8_stdio()`` 在 Windows 上把控制台编码
  切到 UTF-8，避免 ``print('中文')`` 抛 ``UnicodeEncodeError``。
- **环境变量**：``ensure_utf8_env()`` 设置 ``PYTHONIOENCODING=utf-8``，
  ``scripts/dev.py`` 启动时调用一次即可。

典型用法
========

.. code-block:: python

    from engine.utils.encoding import safe_read, safe_write, safe_decode

    text = safe_read("config/app.yaml")          # 自动 UTF-8，失败回退 GBK
    safe_write("data/logs/x.log", "中文内容\n")  # 强制 UTF-8
    name = safe_decode(some_bytes)               # bytes → str，自动尝试多编码

    # Windows 控制台中文不乱码
    from engine.utils.encoding import set_utf8_stdio
    set_utf8_stdio()
"""

from __future__ import annotations

import io
import os
import sys
from pathlib import Path
from typing import Iterable, Optional

# Windows 中文系统的常见编码（按优先级）
_FALLBACK_ENCODINGS: tuple[str, ...] = ("utf-8", "utf-8-sig", "gbk", "cp936", "latin-1")

# 默认写入编码（全平台统一 UTF-8）
DEFAULT_WRITE_ENCODING = "utf-8"


def safe_decode(data: bytes, encodings: Optional[Iterable[str]] = None) -> str:
    """把 bytes 解码为 str，按优先级尝试多种编码。

    Args:
        data: 原始字节串。
        encodings: 自定义编码列表，默认 ``("utf-8", "utf-8-sig", "gbk", "cp936", "latin-1")``。

    Returns:
        解码后的字符串。所有编码都失败时，用 ``utf-8`` + ``errors="replace"``
        兜底（保证不抛异常，但乱码字符会被替换）。
    """
    if data is None:
        return ""
    if isinstance(data, str):
        return data
    if not isinstance(data, (bytes, bytearray)):
        return str(data)

    encs = tuple(encodings) if encodings else _FALLBACK_ENCODINGS
    for enc in encs:
        try:
            return data.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    # 全部失败：用 replace 兜底，绝不抛异常
    return data.decode("utf-8", errors="replace")


def safe_encode(text: str, encoding: str = DEFAULT_WRITE_ENCODING) -> bytes:
    """把 str 编码为 bytes，UTF-8 优先，失败时用 replace 兜底。"""
    if text is None:
        return b""
    if isinstance(text, (bytes, bytearray)):
        return bytes(text)
    try:
        return text.encode(encoding)
    except UnicodeEncodeError:
        return text.encode(encoding, errors="replace")


def safe_read(
    path: str | os.PathLike,
    encodings: Optional[Iterable[str]] = None,
) -> str:
    """读文本文件，UTF-8 优先，失败回退 GBK/CP936。

    Args:
        path: 文件路径（``str`` / ``Path``）。
        encodings: 自定义编码列表，默认见 ``_FALLBACK_ENCODINGS``。

    Returns:
        文件文本内容。文件不存在或不可读时返回空串（不抛异常，便于调用方兜底）。
    """
    p = Path(path)
    if not p.exists() or not p.is_file():
        return ""
    try:
        raw = p.read_bytes()
    except OSError:
        return ""
    return safe_decode(raw, encodings)


def safe_write(
    path: str | os.PathLike,
    content: str,
    encoding: str = DEFAULT_WRITE_ENCODING,
    append: bool = False,
    ensure_parent: bool = True,
) -> bool:
    """写文本文件，强制 UTF-8。

    Args:
        path: 目标文件路径。
        content: 要写入的文本。
        encoding: 写入编码，默认 UTF-8（跨平台统一）。
        append: ``True`` 时追加，``False`` 时覆盖。
        ensure_parent: ``True`` 时自动创建父目录。

    Returns:
        ``True`` 写入成功；``False`` 失败（不抛异常，调用方自行决定如何兜底）。
    """
    p = Path(path)
    if ensure_parent:
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
        except OSError:
            return False
    mode = "a" if append else "w"
    try:
        with open(p, mode, encoding=encoding, newline="") as f:
            f.write(content)
        return True
    except OSError:
        return False


def safe_read_lines(
    path: str | os.PathLike,
    encodings: Optional[Iterable[str]] = None,
) -> list[str]:
    """读文本文件按行分割（保留行尾 ``\\n``）。

    文件不存在时返回空列表。
    """
    text = safe_read(path, encodings)
    if not text:
        return []
    return text.splitlines(keepends=True)


def set_utf8_stdio() -> bool:
    """把 stdin/stdout/stderr 重配为 UTF-8（Windows 控制台中文不乱码）。

    Returns:
        ``True`` 至少一个流被成功重配；``False`` 全部失败或非 TTY。

    实现：
        - Windows 上 ``sys.stdout`` 多为 ``cp936`` 编码，``print("中文")`` 抛
          ``UnicodeEncodeError``。本函数用 ``io.TextIOWrapper`` 重新包装底层
          buffer 为 UTF-8。
        - 若底层 buffer 不可用（如重定向到文件），返回 ``False`` 但不抛异常。
    """
    changed = False
    for stream_name in ("stdout", "stderr", "stdin"):
        stream = getattr(sys, stream_name, None)
        if stream is None:
            continue
        # 已经是 UTF-8 则跳过
        cur_enc = getattr(stream, "encoding", "") or ""
        if cur_enc.lower().replace("-", "") == "utf8":
            continue
        buffer = getattr(stream, "buffer", None)
        if buffer is None:
            continue
        try:
            new_stream = io.TextIOWrapper(
                buffer,
                encoding="utf-8",
                errors="replace",
                line_buffering=getattr(stream, "line_buffering", False),
            )
            setattr(sys, stream_name, new_stream)
            changed = True
        except (AttributeError, io.UnsupportedOperation):
            continue
    return changed


def ensure_utf8_env() -> None:
    """设置 ``PYTHONIOENCODING=utf-8`` 环境变量（影响子进程的默认编码）。

    供 ``scripts/dev.py`` 在派生 uvicorn / bun 子进程前调用一次。
    不会覆盖用户已显式设的值。
    """
    if not os.environ.get("PYTHONIOENCODING"):
        os.environ["PYTHONIOENCODING"] = "utf-8"
    # Windows Python 3.7+ 支持 -X utf8 模式（PYTHONUTF8=1）
    if not os.environ.get("PYTHONUTF8"):
        os.environ["PYTHONUTF8"] = "1"


__all__ = [
    "DEFAULT_WRITE_ENCODING",
    "safe_decode",
    "safe_encode",
    "safe_read",
    "safe_write",
    "safe_read_lines",
    "set_utf8_stdio",
    "ensure_utf8_env",
]

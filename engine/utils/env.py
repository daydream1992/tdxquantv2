"""零依赖 ``.env`` 加载器（无 python-dotenv 时的轻量替代）。

读取项目根的 ``.env``（``KEY=VALUE``），仅注入 **尚未存在** 的键到 ``os.environ``
（不覆盖已有环境变量，部署环境优先级最高）。幂等：多次调用安全。

设计动机：项目多处用 ``os.environ.get(X) or cfg.get(...)`` 模式（questdb / tqcenter），
凭证（飞书 App Secret / 邮件密码 / QuestDB 密码）应放 ``.env``（已 gitignore）而非
被 git 追踪的 ``config/*.yaml``。

用法::

    from engine.utils.env import load_env
    load_env()  # 模块导入时调一次即可
"""

from __future__ import annotations

import os
from pathlib import Path

_LOADED = False


def load_env(path: str | Path | None = None) -> int:
    """加载 ``.env`` 到 ``os.environ``（不覆盖已有值）。

    Args:
        path: 指定 .env 路径；默认项目根（本文件上两级）的 ``.env``。

    Returns:
        新注入的键数量。
    """
    global _LOADED
    p = Path(path) if path else Path(__file__).resolve().parents[2] / ".env"
    if not p.is_file():
        _LOADED = True
        return 0
    n = 0
    for line in p.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        key, _, val = s.partition("=")
        key = key.strip()
        # 去掉可选的成对引号
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
            val = val[1:-1]
        if key and key not in os.environ:
            os.environ[key] = val
            n += 1
    _LOADED = True
    return n


def ensure_env_loaded() -> None:
    """确保 .env 已加载（幂等）。供多处调用安全。"""
    if not _LOADED:
        load_env()

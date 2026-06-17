"""因子插件包 (L3 组件抽象层)。

每个因子一个独立 ``.py`` 文件，实现 :class:`engine.factors.base.Factor` 接口。
``engine.factors.registry.FactorRegistry`` 在启动时自动扫描本目录所有插件并注册。

新增因子只需：
1. 在本目录下新建 ``<factor_id>.py``
2. 实现 ``Factor`` 子类（设置 ``factor_id`` 类属性）
3. 在策略 YAML ``factors`` 列表中引用 ``factor_id``
"""
from engine.factors.base import Factor
from engine.factors.registry import FactorRegistry, FactorNotFoundError

__all__ = ["Factor", "FactorRegistry", "FactorNotFoundError"]

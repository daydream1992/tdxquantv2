"""因子注册表 - 自动扫描插件并注册。

启动时扫描 ``engine/factors/`` 目录下所有 ``.py`` 文件（排除 ``base.py`` /
``registry.py`` / ``__init__.py``），实例化其中所有 :class:`Factor` 子类，
按 ``factor_id`` 建立索引。

用法
----
>>> from engine.factors.registry import FactorRegistry
>>> registry = FactorRegistry()
>>> registry.list_factors()
['momentum_5d', 'momentum_10d', 'breakout_ma20', ...]
>>> factor = registry.get_factor('momentum_5d')
>>> series = factor.calculate(df, {'window': 5})

新增因子
--------
1. 在 ``engine/factors/`` 目录新建 ``my_factor.py``
2. 实现 ``class MyFactor(Factor): factor_id = "my_factor"; ...``
3. 注册表下次扫描自动注册，无需修改本文件
"""
from __future__ import annotations

import importlib
import inspect
import logging
import pkgutil
from pathlib import Path
from typing import Any

from engine.factors.base import Factor

logger = logging.getLogger(__name__)


class FactorNotFoundError(KeyError):
    """请求的 ``factor_id`` 未注册。"""


class FactorRegistry:
    """因子注册表。

    Parameters
    ----------
    package:
        因子插件所在 Python 包，默认 :mod:`engine.factors`。
    auto_scan:
        是否在构造时立即扫描注册，默认 True。
    """

    def __init__(
        self,
        package: str = "engine.factors",
        auto_scan: bool = True,
    ) -> None:
        self._package = package
        self._factors: dict[str, Factor] = {}
        self._classes: dict[str, type[Factor]] = {}
        if auto_scan:
            self.scan()

    # ---- 扫描与注册 ----
    def scan(self) -> None:
        """扫描 ``engine/factors/`` 目录，自动注册所有 Factor 子类。

        幂等：重复调用会清空旧注册再扫描。
        """
        self._factors.clear()
        self._classes.clear()

        try:
            pkg = importlib.import_module(self._package)
        except ImportError as exc:
            logger.error("无法导入因子包 %s: %s", self._package, exc)
            return

        pkg_path = self._resolve_package_path(pkg)
        if pkg_path is None or not pkg_path.is_dir():
            logger.warning("因子包路径不可用: %s", pkg_path)
            return

        logger.info("开始扫描因子插件目录: %s", pkg_path)

        for module_info in pkgutil.iter_modules([str(pkg_path)]):
            module_name = module_info.name
            if module_name in ("base", "registry", "__init__"):
                continue
            if not module_info.ispkg:
                self._scan_module(module_name)

        logger.info("因子扫描完成，共注册 %d 个因子: %s", len(self._factors), sorted(self._factors.keys()))

    def _resolve_package_path(self, pkg: Any) -> Path | None:
        """兼容 PEP 451 namespace package 与常规 package。"""
        paths = getattr(pkg, "__path__", None)
        if paths:
            return Path(list(paths)[0])
        # 兜底：用 __file__ 推导
        file_attr = getattr(pkg, "__file__", None)
        if file_attr:
            return Path(file_attr).parent
        return None

    def _scan_module(self, module_name: str) -> None:
        full_name = f"{self._package}.{module_name}"
        try:
            module = importlib.import_module(full_name)
        except Exception as exc:  # noqa: BLE001
            logger.exception("导入因子模块 %s 失败: %s", full_name, exc)
            return

        for attr_name in dir(module):
            attr = getattr(module, attr_name, None)
            if not inspect.isclass(attr):
                continue
            if not issubclass(attr, Factor) or attr is Factor:
                continue
            # 排除从其他模块 import 进来的基类/别名
            if getattr(attr, "__module__", "") != full_name:
                continue
            # 抽象类不实例化
            if inspect.isabstract(attr):
                continue
            self._register_class(attr)

    def _register_class(self, cls: type[Factor]) -> None:
        factor_id = getattr(cls, "factor_id", "") or ""
        if not factor_id:
            logger.warning("因子类 %s 未设置 factor_id，跳过", cls.__name__)
            return
        if factor_id in self._classes:
            logger.warning("因子 ID 冲突: %s 已注册为 %s，被 %s 覆盖",
                           factor_id, self._classes[factor_id].__name__, cls.__name__)
        try:
            instance = cls()
        except Exception as exc:  # noqa: BLE001
            logger.exception("实例化因子 %s (%s) 失败: %s", factor_id, cls.__name__, exc)
            return
        self._classes[factor_id] = cls
        self._factors[factor_id] = instance
        logger.debug("注册因子: %s -> %s", factor_id, cls.__name__)

    # ---- 查询 ----
    def get_factor(self, factor_id: str) -> Factor:
        """根据 ``factor_id`` 获取因子实例。

        Raises
        ------
        FactorNotFoundError
            ``factor_id`` 未注册。
        """
        if factor_id not in self._factors:
            raise FactorNotFoundError(
                f"因子 {factor_id!r} 未注册。已注册: {sorted(self._factors.keys())}"
            )
        return self._factors[factor_id]

    def has_factor(self, factor_id: str) -> bool:
        return factor_id in self._factors

    def list_factors(self) -> list[str]:
        """返回所有已注册的 ``factor_id`` 列表。"""
        return sorted(self._factors.keys())

    def list_factors_by_category(self, category: str) -> list[str]:
        """按分类过滤已注册因子。"""
        return sorted(
            fid for fid, f in self._factors.items()
            if f.factor_category == category
        )

    def get_factor_info(self, factor_id: str) -> dict[str, Any]:
        """获取因子元信息（不含实例）。"""
        factor = self.get_factor(factor_id)
        return {
            "factor_id": factor.factor_id,
            "factor_name": factor.factor_name,
            "factor_category": factor.factor_category,
            "factor_description": factor.factor_description,
            "required_fields": factor.get_required_fields(),
            "default_params": factor.get_default_params(),
            "class_name": type(factor).__name__,
        }

    def all_factors_info(self) -> list[dict[str, Any]]:
        """返回所有因子的元信息。"""
        return [self.get_factor_info(fid) for fid in self.list_factors()]

    def __len__(self) -> int:
        return len(self._factors)

    def __contains__(self, factor_id: object) -> bool:
        return isinstance(factor_id, str) and factor_id in self._factors

    def __repr__(self) -> str:
        return f"<FactorRegistry count={len(self)} factors={self.list_factors()}>"

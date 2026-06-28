"""FastAPI 路由模块集合。

每个子模块负责一个业务域，所有路由都挂载在 ``/api`` 前缀下：

- ``strategies`` -> ``/api/strategies``
- ``selection``  -> ``/api/selections``
- ``monitor``    -> ``/api/monitor``
- ``sectors``    -> ``/api/sectors``
- ``signals``    -> ``/api/signals``
- ``config``     -> ``/api/config``
- ``theme``      -> ``/api/theme``
"""

from __future__ import annotations

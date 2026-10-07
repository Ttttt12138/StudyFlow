# 验证记录

最近一次用户要求的完整复跑见 [测试复跑记录](verification-rerun-1791124268386.md)：B 46 项、C 130 项全部通过，数据库真实重启恢复与 HTTP 服务恢复通过。

验证日期：2026-10-04（Asia/Bangkok）。主环境为 Windows / Python 3.13.5，实际数据库为 Docker 中的 PostgreSQL 17。容器服务使用 Python 3.13 slim。

| 验证项 | 结果 |
|---|---|
| B 的计算、业务、权限、事务与 C 契约测试 | 46 项通过；包含 17 项纯计算测试，其余使用真实 PostgreSQL |
| 原 C 项目回归 | 130 项通过，C 源码与契约未修改 |
| 并发放款／还款 | 4 路并发，同键重放和不同键重复操作均只记账一次 |
| 失败回滚 | 注入放款记账后的异常，余额、贷款、流水、审计及成功幂等记录全部回滚 |
| 不可变记录 | 数据库触发器拒绝修改或删除报价、流水、审计和成功幂等记录 |
| B/C 演示 | 缺资料复核、补齐批准、放款、补充模拟资金、12 期还款、结清；报价与 C 解释数据完全相同 |
| 数据库真实重启 | 重启 `studyflow-b-db-1` 后，余额、版本、贷款、流水、审计快照一致；旧放款键返回原结果，不执行新入账 |
| Alembic | 新数据库升级至 0002 成功，`alembic check` 无 ORM 差异 |
| 代码与依赖 | Ruff 检查通过；`pip check` 无冲突 |
| 容器部署 | Compose 构建与启动成功；localhost:8000 `/health` 返回 ok；OpenAPI 导出成功 |

初次运行原 C 回归时，Windows 沙箱阻止 pytest 访问共享临时目录，导致 12 项 setup error；改为专用工作区临时目录后 130 项全部通过。没有修改 C 来绕过测试。

演示报告位于 `output/demo-with-c.json`，包含模拟资料状态、B 报价、C 解释、到账、结清和账本，未写入令牌。`output/restart-snapshot.json` 保存重启前的业务快照摘要。当前 OpenAPI 静态快照位于 `docs/openapi.json`；实际服务 `/openapi.json` 为运行时契约。

重现数据库重启验证（仅操作本项目 Compose 服务）：

```powershell
# 先按 README 设置 DEMO_DATABASE_URL 并运行 --with-c 演示
.venv/Scripts/python.exe scripts/verify_restart.py capture
docker compose restart db
docker compose up -d --wait db
.venv/Scripts/python.exe scripts/verify_restart.py verify
```

本验证不代表真实贷款审批、支付或完整 A/B/C readiness 系统验收。预算仍为显式夹具；Python 3.11/3.12 未在本机逐一验证。公开服务没有演示时钟控制接口。

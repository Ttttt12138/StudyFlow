# B 借款替换 Django 借款功能

2026-10-05，按用户确定的方向：保留 `/api/v2`，以独立 B 的业务规则替换原 Django 借款功能，旧独立项目 `studyflow-backend` 留作参考，现位于 [`legacy/studyflow-backend/`](../legacy/studyflow-backend/)，不属于本次提交。

## 代码边界

- `backend/finance/lending_core/`：从 B 迁入的 Pydantic 输入模型、Decimal 等额本息和逐月还款能力算法，不依赖 FastAPI/SQLAlchemy。
- `loan_engine.py`：调用 B 核心，将同一还款表投影到 Django 原预算消费格式，没有第二套利息算法。
- `lending_applications.py`：B 的自动审批、版本控制、取消和放款前复核。
- `lending_models.py`、`lending_ledger.py`：Django 贷款账户与分期，复用原钱包、资金占用、流水和状态快照。
- `c_adapter.py`：Django 记录映射到现有 C 契约，保留原金额、真实模拟到账日期、实际状态版本。

原 Django 的资本化宽限期、外币借款创建及管理员手动审批代码已退出运行路径。预算与换汇仍支持其原有币种；借款只支持 B 的 THB 范围。旧报价只读，不重新测算历史合同。

## 持久化与迁移

`0005` 新增月度资料、账户、分期、申请版本与评估，以及还款账本来源。`0006` 将旧申请状态转换为 B 枚举，给历史已放款贷款补建账户与分期；已通过旧支付流程结算的分期按真实账本标记已付。已有流水、金额和余额不重写，不重复入账。

旧 processing/unknown 放款需先在旧服务解决，否则迁移明确停止。旧未放款合同不能再审批或放款，应创建新 B 报价。该迁移不可自动逆转，保留迁移前备份。

PostgreSQL 触发器继续保护账本、审计、状态历史，新增保护报价和成功幂等记录。写请求按用户加锁；运营人员操作同时按固定顺序锁定操作者及学生，避免跨学生幂等竞争。

## Django 检查修复

1. 取消、拒绝的借款来源不能继续投入预算筹资计划。
2. 已结算支出和合同还款额不能被场景 overrides 改写。
3. 超出共享 Django 金额精度的月供在报价阶段拒绝，避免放款时数据库报错。
4. 借款金额、利率拒绝浮点；报价和成功幂等记录增加数据库不可变约束。
5. 启动脚本改为当前工作区的 Docker PostgreSQL，凭据文件补入 gitignore。
6. OpenAPI 补齐必填 `Idempotency-Key` 请求头，Swagger 可以正确提交工作流命令。

## 验证入口

`manage.py test finance auto_test` 覆盖 Django 回归、C 契约、事务回滚、四路并发、迁移保留历史；`pytest auto_test/test_lending_core.py` 覆盖 B 原计算测试。`manage.py demo_bc --runs 3` 通过 Token 认证的 Django 路由和 PostgreSQL 完成三轮模拟生命周期。

C 目前使用 mock 模式；所选 Django 场景是实际保存的预算，但不是完整 readiness 的多场景预算。没有声称真实授信、支付或前端端到端验收。

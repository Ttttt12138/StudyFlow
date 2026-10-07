# StudyFlow B：模拟借贷后端

独立 Python 项目，提供借款测算、自动审核、资料复核、模拟放款、学生钱包、逐期还款与结清。所有金额操作均为模拟。C 只在可选适配层中使用；核心服务无需模型密钥或 C 包。

## 本地启动（Windows PowerShell）

需要 Python 3.11+ 和已启动的 Docker Desktop。本次验证使用 Python 3.13、PostgreSQL 17。在本目录执行：

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.lock
.venv/Scripts/python.exe -m pip install --no-deps --no-build-isolation -e .
docker compose up -d db
$env:DATABASE_URL='postgresql+psycopg://studyflow:local-simulation-only@localhost:55432/studyflow_b'
.venv/Scripts/python.exe -m alembic upgrade head
.venv/Scripts/python.exe -m studyflow_backend.cli init-identities
.venv/Scripts/python.exe -m uvicorn studyflow_backend.api:create_app --factory --host 127.0.0.1 --port 8000
```

如果 `python` 是 Windows Store 占位程序，可用真实 Python 路径创建环境；当前工作区也可使用 `../.venv/Scripts/python.exe -m venv .venv`。

`init-identities` 创建 `student_001` 和 `admin_001`，只在此次输出中显示随机令牌；数据库仅保存 SHA-256 摘要。重复初始化相同 ID 会失败，且不会重置身份或令牌。使用 `--student-id`、`--admin-id` 创建其他演示身份。不要把令牌提交到代码库。

交互文档：[Swagger UI](http://127.0.0.1:8000/docs)，机器契约：[OpenAPI](http://127.0.0.1:8000/openapi.json)，就绪检查：[Health](http://127.0.0.1:8000/health)。Swagger 的 Authorize 填入令牌，写接口还需填写 `Idempotency-Key`。

也可以全部容器化：

```powershell
docker compose up -d --build
docker compose exec api studyflow-b init-identities
```

Compose 只绑定本机回环地址，数据库使用命名卷。默认密码仅供本地模拟；修改 `.env` 中 `POSTGRES_PASSWORD` 后，连接 URL 必须一致。服务读取进程环境，不自动加载 `.env`；Compose 按自身规则读取 `.env`。启动迁移不创建身份，不清空数据。

## 测试和独立演示

首次创建专用数据库（已存在时 `createdb` 会报告错误，不覆盖数据）：

```powershell
docker compose exec -T db createdb -U studyflow studyflow_b_test
docker compose exec -T db createdb -U studyflow studyflow_b_demo
$env:TEST_DATABASE_URL='postgresql+psycopg://studyflow:local-simulation-only@localhost:55432/studyflow_b_test'
$env:DEMO_DATABASE_URL='postgresql+psycopg://studyflow:local-simulation-only@localhost:55432/studyflow_b_demo'
.venv/Scripts/python.exe -m pytest -p no:cacheprovider
.venv/Scripts/python.exe -m ruff check --no-cache src auto_test migrations scripts
.venv/Scripts/python.exe -m studyflow_backend.cli demo --output output/demo.json
```

测试只接受名称以 `_test` 结尾的 PostgreSQL 数据库；每个测试创建独立随机 schema，结束后只删除该 schema。不设置数据库 URL 时集成测试会跳过，不能据此宣称事务验收通过。演示只接受 `DEMO_DATABASE_URL` 且库名以 `_demo` 结尾；每次创建新身份，保留历史运行，不清空业务数据。

演示通过真实 HTTP 路由和 PostgreSQL，以注入时钟走完：缺资料复核 → 补齐后批准 → 余额仍为零 → 净到账 30,000 → 重放放款不重复入账 → 模拟充值 600 → 按月还 12 期各 2,550 → 余额为零且贷款结清。演示报告不包含令牌。HTTP 服务没有修改时钟的接口。

与当前 C 项目联调：

```powershell
.venv/Scripts/python.exe -m pip install -e ../studyflow-ai
.venv/Scripts/python.exe -m pytest -p no:cacheprovider
.venv/Scripts/python.exe -m studyflow_backend.cli demo --with-c --output output/demo-with-c.json
```

`../studyflow-ai` 是与 B 同级的 C 项目路径；独立移动 B 后替换为实际 C 路径。联调使用 C 0.2.0 的 `ReadinessAI.mock()`，不请求模型网络。未安装 C 时，其专属测试会跳过，普通 B 演示仍可运行。

## 规则与边界

- 金额为 THB 两位小数字符串，拒绝 JSON 浮点输入；金额最多 18 位有效数字。年利率使用小数比例，例如 `"0.12"` 表示 12%，模拟输入范围为 0—1，不表示真实产品或法规限制。期限 1—60 月。手续费预扣，净到账为本金减手续费。
- 等额本息使用年利率除以 12，不计按日利息；每期利息按期初剩余本金计算并四舍五入到分，最后一期吸收尾差。无法形成每期正本金的极小金额请求返回 `INSTALLMENT_TOO_SMALL`。收费与利息分别展示，总还款不重复加预扣费用。
- 月还款日沿用首期日号，短月取月末，后续月份恢复原日号。首期日期在测算、提交、复核、放款时均须晚于曼谷业务日期；时间戳带时区。
- 资料按 `YYYY-MM` 覆盖全部还款期，收入、生活支出、已有外部债务还款均需明确填写。`null`/省略表示未知，`"0.00"` 表示确认没有该项。资料每次完整替换，采用版本校验。
- `existing_repayments` **只填 B 模块外的债务**。B 自动计入其他已批准申请和已放款未还的月供，避免多笔贷款共享同一还款额度。资料不完整优先进入复核；完整但任一期不足拒绝；全部足额才批准。这是模拟规则，非授信结论。
- 报价不可修改或复用创建第二个申请；被拒绝、取消或过期后，重新测算并创建新申请。审批与取消不改变余额。放款前资料变化时重新判断，不通过则回到复核。
- 还款只能支付最早一笔已到期未付账单的全额；不支持部分还款、提前还款或罚息。逾期是账单日期派生状态，不会自动扣款。申请放款后保持 `DISBURSED`，贷款账户另有 `ACTIVE/CLOSED`。
- `expected_version` 是操作对象的版本：申请操作使用申请版本，还款使用贷款版本，充值使用钱包版本，首次保存资料使用 0。钱包版本也随资料及申请变化递增，不能把版本当作流水数量。
- 幂等键按身份隔离，跨写接口共用命名空间；同键同请求返回原始成功结果，同键不同请求返回 409。失败且回滚的请求可重试。成功结果可能是旧快照，展示最新状态时重新 GET。所有写操作在数据库提交后才返回。

完整接口见 [API 接入说明](docs/api.md)，B/C 边界见 [C 联调说明](docs/c-integration.md)，执行记录见 [验证记录](docs/verification.md)。

## 代码结构

`calculations` 负责确定性金额与还款能力计算；`applications/lending` 负责业务状态；`models/repository/transactions` 负责 PostgreSQL 存储、锁和幂等；`api/schemas/responses` 负责 HTTP；`c_adapter` 负责可选 C 契约映射。正式数据库结构由 Alembic 迁移维护，不在服务启动时调用 `create_all()`。

事务采用 SQLAlchemy 显式事务与 PostgreSQL 行锁；幂等键使用事务级 advisory lock，财务操作按学生钱包串行。只读聚合使用 repeatable-read 快照。参考：[SQLAlchemy 事务文档](https://docs.sqlalchemy.org/en/20/orm/session_transaction.html)、[PostgreSQL 锁文档](https://www.postgresql.org/docs/current/explicit-locking.html)、[Alembic 迁移文档](https://alembic.sqlalchemy.org/en/latest/tutorial.html)。

当前交付不包含真实授信、支付、正式登录注册、完整 B 预算/汇率引擎或 A 页面；它是可持久化并可独立运行的模拟借贷服务。

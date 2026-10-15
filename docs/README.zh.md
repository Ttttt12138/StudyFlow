> Current student flow (2026-10-15): [shared contract](student-loan-contract.md). User-entered loan amount, mandatory application, automatic simulated admission notice, DRAFT/CONFIRMED only. Older descriptions of family funding, budgets, bookkeeping, enrollment and no-loan confirmation below are historical platform documentation.

# StudyFlow 工作区（中文说明）

> 本文件为中文参考说明。提交评审以英文文档为准：[README](../README.md)、[Technical Overview](technical-overview.md)、[Security Self-Assessment](security-self-assessment.md)。

**命题 C 增量**：
- 多币种钱包与服务端定价的换汇；
- 汇款订单状态机；
- 参考汇率接入；
- T0–T3 权限分级、按币种限额、二次验证、分权审批与限流；
- 生产加固；
- 可执行工具调用的 Agent（T2 动作须学生确认）；
- 中英文错误信息；
- 模拟信用建立。

完成情况、验证结果和剩余风险见 [命题 C 补齐情况](proposition-c.md)。演示命令为 `manage.py demo_remittance --runs 3` 和 `manage.py demo_agent --runs 3`，Agent 评估为 `manage.py evaluate_agent`。本地检查统一用 `scripts/run_gates.py` 运行。

Financial Copilot 增量：What-if 比较与确认应用、四层解释、统一 Review Queue、通知已读及完整支付 Demo 已接入。运行 `manage.py demo_copilot --mode live --env-file ../studyflow-ai/.env --runs 3`；接口、前端交互与评估方式见 [Copilot 接入说明](copilot.md)。真实模型与 OCR 验收状态以本轮验证报告为准。

消费学习与资金执行扩展已加入：CSV 导入、消费分类、周期支出、预算校准、Financial Calendar / Briefing、家庭资助确认、模拟汇款比较和 readiness 学费对账。启动与前端契约见 [消费学习接入说明](consumption.md)，完整 HTTP 演示使用 `manage.py demo_consumption --runs 3`。扫描件支持可选的 [Gemini 中英文 OCR](gemini-ocr.md)，默认关闭，需服务端配置及逐文件同意，并保留人工转录；不包含真实银行、真实支付或前端应用。

已新增入学预算与主动资金规划后端：PSU 模板、材料上传确认、学期预算、30–90 天预测、筹资组合和持久 worker。启用方式、API 顺序及真实模型演示见 [Readiness 接入说明](readiness.md)。

Django 是统一 B 后端，所有接口使用 `/api/v2/`。原 Django 借款引擎已由独立 B 项目的计算与状态规则替换；预算、换汇、支付和对账继续使用现有 Django 服务。C 以本地 Python 包接入，共用 Django 用户、钱包、账本和事务。

| 目录 | 用途 |
|---|---|
| `frontend/` | A 模块：React 学生端（[前端说明](../frontend/README.md)） |
| `backend/` | B 模块：统一 Django 后端（`manage.py`、依赖清单、`.env.example`） |
| `backend/finance/`、`backend/config/` | Django 应用与配置；`backend/finance/lending_core` 为迁入的 B 纯计算与契约 |
| `studyflow-ai/` | C 模块，独立开发和测试 |
| `backend/auto_test/` | 替换后的借款、C 适配、迁移、并发和缺陷回归测试 |
| `output/` | 本地验证结果，gitignored；入库的证据副本在 `evidence/` |

## 一键演示（Docker）

需要 Docker Compose v2.17+，端口 8080、8000、55433 空闲（`STUDYFLOW_WEB_PORT` 可改 8080）。在仓库根目录执行：

```powershell
docker compose up --build
docker compose exec app cat .demo-credentials.json  # seed_demo 生成的示例账号
```

启动 `db`（PostgreSQL）、`app`（Django + gunicorn，自动 migrate、createcachetable、seed_demo）、`worker`（`readiness_worker --mode mock`）和 `web`（nginx 托管前端构建产物，同源转发 `/api/`、`/admin/`、`/health/` 并提供 Django 登录页静态文件）。打开 <http://localhost:8080>，点击 **Sign in to StudyFlow** 以 `demo-student` 登录。全部为 mock 模式，不调用外部服务。`docker compose down` 停止；`-v` 会同时删除数据库卷。凭据文件在容器重建后丢失，用户仍在数据库中，可用 `docker compose exec app python manage.py changepassword demo-student` 重设。

## 启动 Django

Python 3.11+、Docker Desktop。虚拟环境建在工作区根目录，Django 命令在 `backend/` 下运行：

```powershell
python -m venv --prompt studyFlow studyFlow
docker compose up -d --wait db
Set-Location backend
../studyFlow/Scripts/python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env  # 仅首次创建；已有 .env 时保留原配置
# 编辑 backend/.env，设置随机 DJANGO_SECRET_KEY；示例 DB_PORT=55433 对应 Compose。
../studyFlow/Scripts/python.exe manage.py migrate
../studyFlow/Scripts/python.exe manage.py createcachetable  # 限流计数表 studyflow_cache
../studyFlow/Scripts/python.exe manage.py runserver 127.0.0.1:8000 --noreload
```

动钱的接口（付款提交、换汇、还款）需要 step-up 二次验证，超出按币种限额时还需第二名运营人员审批；接口限流计数存放在数据库缓存表中，部署时同样要执行 `createcachetable`。生产环境设置 `DJANGO_SECURE=true` 启用 HTTPS、HSTS 和安全 Cookie。详见 [权限分级、限额与生产加固](permissions.md)。

推荐使用 `studyFlow/Scripts/python.exe`；启动脚本也兼容已安装依赖的 `.venv` 环境。根 Compose 使用独立 `studyflow-django` 服务、55433 端口和命名卷，不依赖旧 B 的 55432 端口。原 FastAPI 后端与团队设计文件可保留为本地参考，不属于本次集成提交。

`/health/` 为公开就绪检查；`/api/docs/` 和 `/api/schema/` 需要登录。认证使用 `Authorization: Token ...` 或 Django session；session 写请求需要 CSRF。Token 可用 `POST /api/v2/auth/token/`（用户名和密码，有限流）获取。工作流写接口需要 `Idempotency-Key`。

`manage.py seed_demo` 可创建学生、运营和审批运营三个示例用户及本地 `.demo-credentials.json`，不会覆盖已有用户；该文件不得提交。`scripts/start-postgres.ps1` 和 `backend/scripts/start-backend.ps1` 可复用已配置环境。

## 测试与 B/C 联调

配置专用开发 PostgreSQL 后在 `backend/` 下执行（测试数据库为 `test_studyflow`）：

```powershell
Set-Location backend  # Django commands run inside backend/
../studyFlow/Scripts/python.exe manage.py test finance auto_test --noinput --keepdb
../studyFlow/Scripts/python.exe -m pytest auto_test/test_lending_core.py -q -p no:cacheprovider
../studyFlow/Scripts/python.exe manage.py makemigrations --check --dry-run
New-Item -ItemType Directory -Path output -Force | Out-Null
../studyFlow/Scripts/python.exe manage.py spectacular --validate --fail-on-warn --file output/openapi.yaml
../studyFlow/Scripts/python.exe manage.py demo_bc --runs 3 --output output/django-bc-demo.json
```

测试角色需有建测试库权限，或由管理员预建测试库后使用 `--keepdb`。SQLite 仅用于局部轻量检查，不能证明 PostgreSQL 精度、锁和触发器行为。

`demo_bc` 每轮创建新模拟身份，使用真实 Token 认证、Django HTTP 路由和 PostgreSQL，执行缺资料复核、补齐批准、幂等放款、模拟补充资金、12 期还款与结清。每期还款都先经 `auth/step-up/` 重新输入密码；由于 12 个月的还款在几秒内完成，演示把 step-up 限流临时调到 30 次/小时并在报告 `throttling` 字段中注明，各演示命令的限流计数按次隔离。C 使用明确的 mock 模式；报告不输出令牌。调用通过 Django APIClient 在进程内完成，不是浏览器或外部网络端到端验收。

本轮结果见 [Django 与 B/C 验证记录](verification-django-b-20261005.md)。

## 借款替换及迁移

新借款只接受 B 的 THB、1–60 期、比例年利率和首期日期，不再接受旧 `annual_rate_percent`、宽限期或外币借款创建字段。新流程详见 [API 指南](api/guide.md) 和 [替换说明](django-b-lending.md)。

`0005/0006` 迁移保留旧报价和账本，给已结算贷款建立还款账户，不重复入账。未放款的旧引擎报价保留只读，需重新创建 B 报价。若旧放款仍处于 processing/unknown，迁移会停止并要求先用旧版解决结果，避免未知资金状态被当成失败或成功；迁移不支持自动倒退。

## C 独立运行

在 `studyflow-ai` 内运行：

```powershell
../studyFlow/Scripts/python.exe -m pytest -p no:cacheprovider
../studyFlow/Scripts/python.exe -m studyflow_ai --mode mock readiness-demo --output output/readiness-demo.json
```

C 的 live 模型配置仍在 `studyflow-ai/.env`，只在显式使用 `--env-file` 时加载。Django 借款解释目前使用 mock，预算来自所选 Django 场景，并明确标记尚不是完整 readiness 预算。全部资金操作为模拟。

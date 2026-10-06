# StudyFlow 工作区

消费学习与资金执行扩展已加入：CSV 导入、消费分类、周期支出、预算校准、Financial Calendar / Briefing、家庭资助确认、模拟汇款比较和 readiness 学费对账。启动与前端契约见 [消费学习接入说明](docs/consumption.md)，完整 HTTP 演示使用 `manage.py demo_consumption --runs 3`。扫描件支持可选的 [Gemini 中英文 OCR](docs/gemini-ocr.md)，默认关闭，需服务端配置及逐文件同意，并保留人工转录；不包含真实银行、真实支付或前端应用。

已新增入学预算与主动资金规划后端：PSU 模板、材料上传确认、学期预算、30–90 天预测、筹资组合和持久 worker。启用方式、API 顺序及真实模型演示见 [Readiness 接入说明](docs/readiness.md)。

Django 是统一 B 后端，所有接口使用 `/api/v2/`。原 Django 借款引擎已由独立 B 项目的计算与状态规则替换；预算、换汇、支付和对账继续使用现有 Django 服务。C 以本地 Python 包接入，共用 Django 用户、钱包、账本和事务。

| 目录 | 用途 |
|---|---|
| `finance/`、`config/` | 统一 Django 后端；`finance/lending_core` 为迁入的 B 纯计算与契约 |
| `studyflow-ai/` | C 模块，独立开发和测试 |
| `auto_test/` | 替换后的借款、C 适配、迁移、并发和缺陷回归测试 |
| `output/` | 本地验证结果，gitignored |

## 启动 Django

Python 3.11+、Docker Desktop。在工作区根目录运行：

```powershell
python -m venv --prompt studyFlow studyFlow
studyFlow/Scripts/python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env  # 仅首次创建；已有 .env 时保留原配置
# 编辑 .env，设置随机 DJANGO_SECRET_KEY；示例 DB_PORT=55433 对应下方 Compose。
docker compose up -d --wait db
studyFlow/Scripts/python.exe manage.py migrate
studyFlow/Scripts/python.exe manage.py runserver 127.0.0.1:8000 --noreload
```

推荐使用 `studyFlow/Scripts/python.exe`；启动脚本也兼容已安装依赖的 `.venv` 环境。根 Compose 使用独立 `studyflow-django` 服务、55433 端口和命名卷，不依赖旧 B 的 55432 端口。原 FastAPI 后端与团队设计文件可保留为本地参考，不属于本次集成提交。

`/health/` 为公开就绪检查；`/api/docs/` 和 `/api/schema/` 需要登录。认证使用 `Authorization: Token ...` 或 Django session；session 写请求需要 CSRF。工作流写接口需要 `Idempotency-Key`。

`manage.py seed_demo` 可创建初始示例及本地 `.demo-credentials.json`，不会覆盖已有用户；该文件不得提交。`scripts/start-postgres.ps1` 和 `scripts/start-backend.ps1` 可复用已配置环境。

## 测试与 B/C 联调

配置专用开发 PostgreSQL 后执行（测试数据库为 `test_studyflow`）：

```powershell
studyFlow/Scripts/python.exe manage.py test finance auto_test --noinput --keepdb
studyFlow/Scripts/python.exe -m pytest auto_test/test_lending_core.py -q -p no:cacheprovider
studyFlow/Scripts/python.exe manage.py makemigrations --check --dry-run
New-Item -ItemType Directory -Path output -Force | Out-Null
studyFlow/Scripts/python.exe manage.py spectacular --validate --fail-on-warn --file output/openapi.yaml
studyFlow/Scripts/python.exe manage.py demo_bc --runs 3 --output output/django-bc-demo.json
```

测试角色需有建测试库权限，或由管理员预建测试库后使用 `--keepdb`。SQLite 仅用于局部轻量检查，不能证明 PostgreSQL 精度、锁和触发器行为。

`demo_bc` 每轮创建新模拟身份，使用真实 Token 认证、Django HTTP 路由和 PostgreSQL，执行缺资料复核、补齐批准、幂等放款、模拟补充资金、12 期还款与结清。C 使用明确的 mock 模式；报告不输出令牌。调用通过 Django APIClient 在进程内完成，不是浏览器或外部网络端到端验收。

本轮结果见 [Django 与 B/C 验证记录](docs/verification-django-b-20261005.md)。

## 借款替换及迁移

新借款只接受 B 的 THB、1–60 期、比例年利率和首期日期，不再接受旧 `annual_rate_percent`、宽限期或外币借款创建字段。新流程详见 [API 指南](API_GUIDE.md) 和 [替换说明](docs/django-b-lending.md)。

`0005/0006` 迁移保留旧报价和账本，给已结算贷款建立还款账户，不重复入账。未放款的旧引擎报价保留只读，需重新创建 B 报价。若旧放款仍处于 processing/unknown，迁移会停止并要求先用旧版解决结果，避免未知资金状态被当成失败或成功；迁移不支持自动倒退。

## C 独立运行

在 `studyflow-ai` 内运行：

```powershell
../studyFlow/Scripts/python.exe -m pytest -p no:cacheprovider
../studyFlow/Scripts/python.exe -m studyflow_ai --mode mock readiness-demo --output output/readiness-demo.json
```

C 的 live 模型配置仍在 `studyflow-ai/.env`，只在显式使用 `--env-file` 时加载。Django 借款解释目前使用 mock，预算来自所选 Django 场景，并明确标记尚不是完整 readiness 预算。全部资金操作为模拟。

# Django 借款替换与 B/C 验证记录

> 路径说明（2026-10-11 更新）：B 模块已移入 `backend/`。下文 Django 命令在 `backend/` 下运行，`manage.py`、`finance/`、`auto_test/`、`openapi.yaml` 等路径均相对 `backend/`；测试结果保留当时的记录。

日期：2026-10-05（Asia/Bangkok）。环境：Windows、Python 3.13.5、Django 5.2.17、PostgreSQL 17.11。

统一服务为 Django `/api/v2`，借款计算与状态规则采用原 B 实现。旧 FastAPI 项目保留参考，不作为运行依赖。验证使用新建的 `studyflow-django` PostgreSQL 容器（localhost:55433），测试库 `test_studyflow`；没有把其他现有业务数据库作为测试库。

| 验证项 | 结果 |
|---|---|
| Django 完整回归 | **92 通过，0 失败，0 跳过**，含预算、换汇、支付、对账及替换后的借款 |
| 迁入 B 的原计算测试 | **17 通过**，金额、利率、尾差、月份日期及还款能力 |
| C 独立回归 | **130 通过**，C 业务源码和契约未改动 |
| 三轮 B/C 模拟流程 | 全部通过：缺资料复核 → 自动批准 → 净到账 30,000 → 补充模拟资金 600 → 12 × 2,550 还款 → CLOSED、余额 0 |
| 并发与事务 | 四路放款只入账一次；同键还款重放、不同键竞争只扣一次；失败回滚与版本冲突通过 |
| 旧数据迁移 | 独立 PostgreSQL schema 从 0004 升级到 0006，已放款贷款建立账户且保留原流水，不重复入账 |
| C 数据边界 | 报价及还款表保真；实际模拟到账日期不随后续查询变化；已到账资金候选 INVALID |
| HTTP 冒烟 | 实际 Django 临时服务：health=200，匿名账户=401，认证账户=200/CLOSED，OpenAPI=200（47 个路径） |
| 系统与契约 | Django check、迁移漂移检查、OpenAPI validate/fail-on-warn、依赖检查均通过 |
| 静态检查 | 新增模块及测试通过 Ruff E4/E7/E9/F/I/B；全部 Django 代码通过 E9/F63/F7/F82/B |

## 已复现并修复的问题

1. 取消或拒绝的借款还能投入筹资计划。
2. 场景覆盖可改写已结算支出及合同还款额，导致预算与实际账本不一致。
3. 极大报价的计算月供超过共享 Django 存储精度，可能在后续写库时失败。
4. Swagger 缺少必填 `Idempotency-Key` 参数，无法按契约提交工作流命令。

同时保留 B 的金额字符串校验、幂等与版本控制，将报价和成功幂等记录纳入 PostgreSQL 不可变触发器，并更新当前目录的数据库启动脚本及凭据忽略规则。

## 可检查证据

- [Django 测试日志](../evidence/django-bc-20261005/django-tests.txt)
- [B 计算 JUnit](../evidence/django-bc-20261005/b-core-junit.xml)
- [C 回归 JUnit](../evidence/django-bc-20261005/c-junit.xml)
- [三轮联调完整报告](../evidence/django-bc-20261005/demo.json)
- [HTTP 检查结果](../evidence/django-bc-20261005/http-smoke.json)
- [已更新 OpenAPI](../backend/openapi.yaml)

以上文件原为本机 `output/` 产物，现原样复制到 `evidence/` 入库。最初 C 测试的 JUnit 写入工作区外层输出目录被环境拒绝；改在 C 自己的 output 中生成后复制，完整重跑退出码为 0。

C 联调为 mock 模式，不调用真实模型或支付。三轮流程使用 Token 认证的 Django APIClient 和真实 PostgreSQL；另有实际 HTTP 只读冒烟，不包含浏览器/A 前端验收。单个 Django 预算场景导出到 C 时明确 complete=false，不冒充完整 readiness 多场景预算。

迁移尚未应用到其他既有部署。旧 processing/unknown 放款必须先解决，迁移才允许继续；旧未放款报价需重新创建 B 报价。详见 [替换说明](django-b-lending.md) 和 [API 指南](api/guide.md)。

# StudyFlow AI 与数据模块

C 模块提供数据导入、证据校验、周期识别、Jev 路由、OpenAI 候选方案和主动检查。可独立离线演示，也可作为 Python 包接入 B 的后端。财务状态、最终去重、授权、支付和对账由 B 提供。

## 快速启动

要求 Python 3.11 或以上。先进入本文件所在的 `studyflow-ai` 目录，再执行下列 Windows PowerShell 命令；本文所有相对路径均以此目录为基准：

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.lock
.venv/Scripts/python.exe -m pip install --no-deps -e .
.venv/Scripts/python.exe -m studyflow_ai --mode mock demo --output output/demo.json
.venv/Scripts/python.exe -m pytest
```

若系统 `python` 是 Windows Store 占位程序，使用真实 Python 可执行文件路径创建环境。开发时也可以 `pip install -e ".[dev,http]"`；锁定文件记录本次验证所用依赖，包含测试和可选 HTTP 依赖。

当前工作区迁移前的虚拟环境保留在上一级 `.venv`，已更新到本目录的源码。复用它时，将上述 `.venv/Scripts/python.exe` 替换为 `../.venv/Scripts/python.exe`；新建本模块自己的 `.venv` 时使用原命令即可。

演示时钟固定为曼谷时间 2026-10-02 20:00。输入包含 7—9 月各 9,000 THB 房租、80,000 THB 余额、65,000 THB 学费和 15,000 THB 储备。输出为预计余额 6,000、缺口 9,000；重复检查复用结果，模拟收到 10,000 后才增加余额。每次 demo 创建全新内存状态，即为重置。

`DemoBackend` 和 `MemoryJobStore` 只用于单进程演示。demo 不执行支付，也不代表 A/B 全链路已经验收。

## 模型配置

默认 `mock` 模式使用明确标记的规则实现，不请求模型网络。`live` 必须同时配置 `OPENAI_API_KEY` 和 `TYPESAFE_API_KEY`，读取当前进程环境，不自动扫描 `.env`；也可通过全局参数 `--env-file .env` 显式加载。`.env.example` 是部署配置清单，不要把真实密钥提交到代码库或聊天。

项目默认 `OPENAI_BASE_URL=https://ai.psu.blue/v1`、`OPENAI_MODEL=openai/gpt-6-luna`、`TYPESAFE_DEFAULT_MODEL=jev-latest`，均可用环境变量覆盖。`OPENAI_API_KEY` 应配置为该 LLM 服务签发的密钥。模型响应记录实际版本、用量、耗时、错误码；不允许 live 静默回退 mock。

LLM 使用 OpenAI SDK 的 Responses API，请求发往 `https://ai.psu.blue/v1/responses`。当前已通过模拟 HTTP 测试验证地址和模型名的传递；服务端是否支持 Responses API 和严格结构化输出，仍需配置有效密钥后实际验证。不会自动切换到其他协议、模型或官方地址。

配置后运行：

```powershell
.venv/Scripts/python.exe -m studyflow_ai --mode live verify-live --output output/live-verification.json
.venv/Scripts/python.exe -m studyflow_ai --mode live ingest src/studyflow_ai/data/tuition.txt --kind email --output output/tuition-live.json
```

`verify-live` 返回码：0 表示两家调用成功；1 表示供应商调用失败；2 表示配置或输入错误。鉴权错误、拒绝及不完整输出均有明确状态。网络暂时错误最多初次请求加两次重试；OpenAI 单次超时 30 秒，Jev 10 秒。

## 输入和输出

```powershell
.venv/Scripts/python.exe -m studyflow_ai ingest src/studyflow_ai/data/rent_history.csv --kind csv --output output/history.json
.venv/Scripts/python.exe -m studyflow_ai ingest src/studyflow_ai/data/tuition.pdf --kind pdf --output output/pdf.json
.venv/Scripts/python.exe -m studyflow_ai schemas --output contracts/schemas-v1.json
```

CSV 必需列：`account_id,date,amount,currency,counterparty,description`；可选 `transaction_id`。日期使用 ISO 格式，币种为 THB，金额支持规范千位分隔符，支出为负数。余额快照单独传递，不能从历史流水反复扣减。

邮件输入为 UTF-8 文本；PDF 必须有可提取的文字层。单文件最多 5 MiB，提取文本最多 100,000 字符，PDF 最多 50 页。加密、损坏、无文字或部分页面无文字的 PDF 会被明确拒绝。原始字段证据和页／行位置保留在结果中。

结果包含 `schema_version`、`trace_id`、来源和处理状态。`READY` 表示结构及当前校验允许提交，最终写入仍由 B 决定；`NEEDS_REVIEW` 表示待确认；`REJECTED` 表示输入不可处理。`VERIFIED` 需要可信来源或明确用户确认；资助承诺的确认永远不等于实际到账。

模型金额、币种、日期和收款方必须有原文支持。缺失年份不自动补齐。推断房租为 `INFERRED`，采用三个连续月、金额中位数 5% 范围、付款日 ±3 天的规则；两个月或同月多笔进入复核。

## 接入 B 与 A

详见 [接入契约](docs/integration.md)。稳定 Python 门面为 `studyflow_ai.api.StudyFlowAI`：

```python
from studyflow_ai.api import StudyFlowAI
from studyflow_ai.config import Settings, providers

classifier, llm = providers(Settings.from_env())
ai = StudyFlowAI(classifier, llm, backend=your_backend_adapter)
# ai.ingest(source, context)
# ai.detect_recurring(transactions, as_of)
# ai.route(context)
# ai.generate_plans(planning_context)
# ai.run_check(student_id, trigger, now)
```

核心包不依赖 FastAPI 或数据库。可选 HTTP Router 由 B 挂载，B 必须注入认证依赖。所有前端调用先到 B。

## 评估与验证

```powershell
.venv/Scripts/python.exe -m studyflow_ai --mode mock evaluate --split test --output output/evaluation-smoke.json
.venv/Scripts/python.exe -m studyflow_ai --mode live evaluate --split test --output output/evaluation-live.json
.venv/Scripts/python.exe -m pytest --cov=studyflow_ai --cov-report=term-missing
.venv/Scripts/python.exe -m ruff check src auto_test scripts
```

120 个合成标注案例按模板家族分成 40 个开发案例和 80 个测试案例。标注来自预设场景，尚未经过人工复核；不能用于宣称真实银行材料上的效果。文件哈希和分组隔离由测试校验。指标、分母、逐例失败、模型及提示词版本均保留。

live 对比包括规则、OpenAI、Jev＋OpenAI 三条路径，三者共用相同字段校验、B 模拟适配器和规划校验。mock 仅检验评估程序可运行，不代表三种模型实际效果，`live_acceptance` 始终为 false。实际验收还要求人工复核标注、真实调用成功及性能指标达标。

当前执行记录见 [验证状态](docs/verification.md)。[原始三人开发计划](../deliverables/StudyFlow三人团队开发计划.docx)保留在工作区共享交付目录。

## 官方接口依据

- [TypeSafe Python SDK](https://docs.typesafe.ai/sdk/python/api/clients/sync)
- [TypeSafe 置信度含义](https://docs.typesafe.ai/confidence)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

## 入学预算与借款辅助 v2

0.2.0 新增独立 `ReadinessAI`：录取资料/官网链接提取、费用完整度、多币种汇率数据、组合筹资候选、B 借款测算解释与版本化检查。保留 v1 接口。

```powershell
.venv/Scripts/python.exe -m studyflow_ai --mode mock readiness-demo --output output/readiness-demo.json
.venv/Scripts/python.exe -m studyflow_ai --env-file .env --mode live readiness-verify-live --output output/readiness-live-verification.json
```

接入与完整命令见 [C v2 接入说明](docs/readiness-v2.md)，结果见 [v2 验证报告](docs/readiness-verification.md)。B 的正式预算、换汇、还款计算与模拟申请状态机，A 的页面，均需另行集成。

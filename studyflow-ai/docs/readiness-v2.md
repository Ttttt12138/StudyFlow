# C v2：入学预算数据与筹资辅助

本模块交付 C 的数据与 AI 能力，不是预算、换汇或还款计算引擎。A 页面、B 正式数据库与财务计算、申请审批和放款接口尚未接入。所有演示学校、费用、资助和贷款条款都是合成样例。

## 安装与一键运行

```powershell
.venv/Scripts/python.exe -m pip install -r requirements.lock
.venv/Scripts/python.exe -m pip install --no-deps -e .
.venv/Scripts/python.exe -m studyflow_ai --mode mock readiness-demo --output output/readiness-demo.json
.venv/Scripts/python.exe -m studyflow_ai readiness-schemas --output contracts/schemas-v2.json
```

真实调用显式读取 `.env`，不自动寻找凭据。文件只接受已定义的模型配置键，不执行变量展开或命令；显式文件值覆盖当前子进程同名环境变量。不要将真实密钥放进 `.env.example`。

```powershell
.venv/Scripts/python.exe -m studyflow_ai --env-file .env --mode live readiness-verify-live --output output/readiness-live-verification.json
.venv/Scripts/python.exe -m studyflow_ai --env-file .env --mode live readiness-extract examples/readiness/offer-en.txt --kind text --output output/semester-extraction.json
.venv/Scripts/python.exe -m studyflow_ai --env-file .env --mode live readiness-extract examples/readiness/offer-zh.txt --kind text --language zh --output output/semester-zh.json
```

PDF 使用 `--kind pdf`；官网 URL 使用 `--kind url`。网页只读取指定地址及最多三次重定向，不发现或跟随页面内链接。仅接受公开 HTTP(S)、80/443 端口、UTF-8 HTML/文本与文字型 PDF，限制 5 MiB、100,000 字符、50 页。源读取失败时改用上传或手动补充。每次解析 DNS 后固定连接到经检查的公网 IP，TLS 使用原域名验证，不使用环境代理绕过地址检查。

## Python 门面

```python
from studyflow_ai.config import Settings
from studyflow_ai.readiness.api import ReadinessAI
from studyflow_ai.readiness.models import ExtractionContext, MaterialSource, FxRequest, CurrencyPair

ai = ReadinessAI.from_settings(Settings.from_env("live"), backend=your_backend)
try:
    extraction = ai.extract_semester_material(
        MaterialSource(source_id="offer-1", kind="text", text=uploaded_text),
        ExtractionContext(reference_date="2026-10-02", student_id=authenticated_student),
    )
    completeness = ai.assess_cost_completeness(extraction.draft)
    fx = ai.fetch_fx_quotes(FxRequest(
        pairs=[CurrencyPair(base="CNY", quote="THB")], as_of="2026-10-02"
    ))
finally:
    ai.close()
```

`generate_funding_candidates(context)` 只接受 B 的同版本预算、资金来源及借款测算。`run_readiness_check(student_id, trigger, aware_now)` 编排 B 读取、完整度检查、预算获取、候选生成、版本复核和审计。所有学生身份必须来自 B 的认证上下文。

离线使用 `ReadinessAI.mock()`；借助 `FixtureBackend` 可运行固定场景。mock 不在网络失败时自动接管 live。`ReadinessAI` 是独立 v2 门面，原 `StudyFlowAI` 和 `schemas-v1.json` 保持兼容。

## 契约与来源

`contracts/schemas-v2.json` 是按模型名称索引的完整 JSON Schema，每个模型保留自己的 `$defs`。`contracts/readiness-examples.json` 提供完整草稿、预算、资金/借款上下文和候选示例。

- `MoneyValue` 保留币种，金额以十进制字符串序列化，按 Babel 币种精度校验；计算不使用浮点数。CostItem 保留原始金额字符串与上下限，C 不计算区间中点或总额。
- `Known / Estimated / Missing` 描述费用信息完整度；`VERIFIED / INFERRED / UNCONFIRMED` 描述证据性质；`READY / NEEDS_REVIEW / REJECTED` 描述处理状态，三者不可混同。
- 模型无权设置 VERIFIED；认证用户修正或可信来源核验后，由 B 写入 verification_reference。上传与官网域名本身都不表示已核验。
- 学年、校区、收费周期、已付、可退押金均单独保存。C 不默认已付、不默认可退，不把缺项改成零。
- 同类别的多个费用保守标记重复或冲突并保留记录；B 确认后合并、选择或拆分，不能直接全量相加。多份材料的 profile 不得以“最后上传覆盖”方式解决冲突。
- 来源保留 URL、抓取时间、内容指纹和逐字段引用。模型行标记可规范化，但金额、日期、币种和原文定位仍须通过确定性检查。
- 收到汇率时记录方向、日期和来源。超过 7 天标记过期，未来日期拒绝；人工汇率必须带依据。C 不将汇率写进余额，B 必须固化预算使用的汇率快照与费用假设。

## B 必须实现的端口

`ReadinessBackendPort` 不包含 C 自有数据库或 HTTP 服务：

| 方法 | B 必须保证的行为 |
|---|---|
| `read_readiness_state` | 返回本学生的草稿、财务状态版本和预算版本；认证与权限在 B 执行 |
| `calculate_budget` | 返回同版本低/基准/高情景、按日期缺口、风险、假设和汇率快照；应用已支付、押金、储备及未来到账规则 |
| `funding_context` | 提供资金来源、可分配额度、条件、预计日期、借款报价和完整还款期测算；不把未到账承诺计入余额 |
| `validate_funding` | 计算组合覆盖、币种换算、到账时间、费用、分期付款表及偿还能力；校验版本，返回 PENDING/CONDITIONAL/VALID/INVALID/STALE |
| `get/claim/release_readiness_check` | 使用持久缓存及可过期任务租约；跨进程幂等 |
| `save_readiness_check` | 同一事务 CAS 财务和预算两版本，保存结果、审计与 outbox，释放租约；旧版本返回 false |
| `audit` | 保存脱敏事件；来源原文和审计日志分开存储 |

缓存键包含学生、两个版本和曼谷日期。B 必须在费用、汇率、借款条件或申请状态变化时递增相关版本。版本竞争最多重做一次，继续变化则返回 stale。模型失败、校验不可用及持久化失败保留已有风险，供下一次检查重试。

无 B 时提取与完整度检查仍可用，run_readiness_check 返回 BACKEND_UNAVAILABLE；直接生成的候选始终 PENDING。正式 HTTP 端点与状态持久化由 B 实现，不新增与 v1 冲突的 imports/plans 路由。

## 借款与界面展示

`FundingSource.funding_id` 是分配对象；`LoanQuote.quote_id` 是测算引用，两者不能互换。已计入余额的 received 来源不能再次分配。C 校验单项额度与引用，B 校验组合金额、到款时间和整体可行性。

`LoanExplanation.quote` 原样复制 B 的净到账、费用、总利息和完整还款表。缺少收入/生活支出/条款时明确“无法判断还款能力”。模型解释文本只辅助说明，不作为审批、计算结果或资格证明。

A 展示规则：

- 查看完整度和预算两个结果；任一不完整，都不能仅凭低情景小计显示“钱够了”。
- 低/基准/高是预算情景，不是置信概率。展示每项来源、缺项、汇率日期、报告币种和 B 的假设。
- 仅展示 B 校验后的可行性状态；INVALID 方案不能作为可选行动，PENDING/CONDITIONAL 展示所缺条件。
- loan_explanations 中的结构化报价是数字来源，不能从 explanation 文本解析金额。
- ApplicationSnapshot 仅用于读取模拟状态；用户操作交给 B。APPROVED 不增加余额，DISBURSED 由 B 的隔离模拟账本记录一次。
- stale 结果禁用操作并刷新。C 的 CLI 无支付、申请提交或审批命令。

## 演示、评估及失败恢复

固定演示时钟为 2026-10-02 Asia/Bangkok。合成四个月预算的低/基准/高是 178,200 / 190,200 / 202,200 THB，固定初始资金 140,200，基准缺口 50,000。固定组合：家庭资助 20,000 + 借款净到账 30,000。模拟报价本金 30,600，预扣费用 600，零利息，12 期每期 2,550；未来收入缺失，因此不认定可承担。

上述数字是演示响应，不是生活成本建议或贷款产品。FixtureBackend 校验其固定输入，不对任意学校执行计算。演示明确记录用户补充和确认步骤，提取资料必须与固定样例吻合才标记 material_linked。

```powershell
.venv/Scripts/python.exe -m studyflow_ai --mode mock readiness-evaluate --split test --output output/readiness-evaluation-smoke.json
.venv/Scripts/python.exe -m studyflow_ai --env-file .env --mode live readiness-evaluate --split dev --output output/readiness-evaluation-dev-live.json
.venv/Scripts/python.exe -m studyflow_ai --env-file .env --mode live readiness-evaluate --split test --output output/readiness-evaluation-test-live.json
```

48 条案例为人工编写规则生成的合成标签，16 开发/32 测试按家族隔离、哈希冻结；不是经过独立人工复核的真实学生样本。新评估不覆盖或替换原 v1 的 120 条数据与三路径脚本。指标包含逐例断言、失败案例、延迟、用量、模型和提示词版本，live_acceptance 保持 false，直到人工复核与 A/B 集成验收完成。

错误处理：UNSUPPORTED_FIELD/MISSING_COST_FIELD 要求用户确认，UNSAFE_URL/FETCH_FAILED 改用上传，STALE_FX_RATE 更新或人工录入汇率，INVALID_ALLOCATION_AMOUNT/UNKNOWN_REFERENCE 拒绝该候选，BACKEND_*_UNAVAILABLE 保留风险等待恢复，STATE_CHANGED 重新读取状态。完整错误码见 `contracts/readiness-error-codes.json`。

交接未完成项：B 正式预算/换汇/还款计算、数据库事务、持久任务和申请状态机；A 页面与交互；学校费用代表性与人工标注复核；真实贷款产品/审批/放款；除中英文之外的语言效果。C 的三次固定演示不能替代 A/B/C 全链路验收。

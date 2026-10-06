# Financial Copilot 后端与前端接入契约

本次新增 What-if、确认应用、四层解释、Review Queue、通知已读和完整 HTTP Demo。沿用 Django `/api/v2/`、PostgreSQL、现有 worker 与 Token/session 认证。所有资金操作仍为模拟，没有新增前端应用。

最新独立盲测与真实 OCR 状态见 [2026-10-06 后续验证](verification-independent-20261006.md)。评估命令新增 `--dataset` 支持选择新的冻结数据集；旧数据重跑必须标为 regression。

## 启动与一次演示

在仓库根目录使用 `studyFlow/Scripts/python.exe`：

```powershell
studyFlow/Scripts/python.exe manage.py migrate --noinput
studyFlow/Scripts/python.exe manage.py createcachetable
$env:STUDYFLOW_READINESS_ENABLED='true'
studyFlow/Scripts/python.exe manage.py runserver 127.0.0.1:8000 --noreload
# 另开终端启动常驻 worker
studyFlow/Scripts/python.exe manage.py readiness_worker --mode live --env-file studyflow-ai/.env
```

完整演示命令自行启动随机端口 HTTP 服务并执行持久 worker 工作，不依赖浏览器：

```powershell
studyFlow/Scripts/python.exe manage.py demo_copilot --mode live --env-file studyflow-ai/.env --runs 3
studyFlow/Scripts/python.exe manage.py demo_copilot --mode mock --scenario all
studyFlow/Scripts/python.exe manage.py sync_review_queue
```

`demo_copilot` 默认生成唯一报告，显式 `--output` 指向已有文件时拒绝覆盖。每轮新建隔离的学生和运营身份，业务日期固定。主线为合成录取材料 → 用户确认 → 50,000 THB 缺口 → Sponsor 确认及 20,000 模拟到账 → 剩余 30,000 净借款 → 学费支付、对账 → 自动预测。为清楚展示资金链，主线固定关闭消费校准；消费学习集成另由原 `demo_consumption` 及回归覆盖。

`--scenario` 支持 `main`、`all`、`conflicting_tuition`、`abnormal_amount`、`duplicate_payment`、`insufficient_funds`、`beneficiary_changed`、`model_failure`、`payment_failure`、`ocr_failure`、`stale_version`、`reconciliation_mismatch`。故障注入仅存在于命令进程，无公共故障开关。OCR 异常模拟的是 OCR 不可用后转人工；真实 Gemini 错误由 OCR 测试单独覆盖。主线 live 失败不会降级到 mock。

报告包含角色、路由、结果记录 ID、版本、耗时、逐步状态、预期拒绝、故障注入标记与失败原因。Sponsor 令牌与登录令牌不写报告。只有支付已对账且后续 worker 完成才能算主线通过。

## What-if 与确认应用

所有 POST 使用 `Idempotency-Key`；同键同请求重放返回 200，首次成功返回 201。模拟请求必须携带 `semester_id/state_version/budget_version/analysis_version`。JSON 金额使用十进制字符串。

`POST readiness/what-if/`：

```json
{
  "semester_id": "当前学期 UUID",
  "state_version": 8,
  "budget_version": 5,
  "analysis_version": 0,
  "scenarios": [
    {"name": "房租改为 10000", "costs": [{"cost_id": "housing", "amount": "10000.00", "effective_on": "2026-11-01"}]},
    {"name": "父母只提供 20000", "family_support": [{"source_id": "已有资金源 UUID", "amount": "20000.00", "available_on": "2026-11-01"}]},
    {"name": "不新增贷款", "allow_new_loan": false}
  ]
}
```

最多三个独立方案，共享同一基准快照。`family_support.source_id` 省略表示新增假设；提供时替换对应未到账家庭资金源。不得修改已到账资金、已付费用和存量贷款。

费用必须已有基准金额或范围；完全 Missing 的项目先走原预算人工补充流程，避免把未知期间当成零支出。

贷款比较添加 `loan` 与 `loan_available_on`。`loan` 沿用 B 合同：`currency=THB`、`principal`、`fees`、比例 `annual_rate`、`months=1..60`、`first_due_date`。12／24 期方案分别传入两个 scenario；首期必须晚于预计到账日。

响应 `data` 包含 `id/baseline/scenarios/dependencies/stale/applied_index/application/is_simulated`。每个方案返回：

| 字段 | 前端解释 |
|---|---|
| `maximum_reserve_gap` | 剩余学期内最大的储备缺口，考虑同日先支出后收入 |
| `semester_funding_gap` | 学期末余额相对储备底线的缺口 |
| `loan_needed` | 加入拟议贷款前、非借款条件资金后的净借款需求；禁用新借款时为零 |
| `unmet_gap` | 方案实施假设下仍未覆盖的最大缺口；不能因 `loan_needed=0` 宣称安全 |
| `minimum_balance/first_below_reserve/first_negative_date` | 最低余额、首次低于储备和首次负余额日期 |
| `remaining_expenses/daily/monthly` | 剩余支出及完整学期日/月预测 |
| `conditional/conditions/confirmed` | 条件结果、待满足条件和排除未确认收入的对照；`confirmed` 仍沿用该方案的支出假设，并不意味着支出已核验 |
| `loan` | 完整还款表、净到账、总利息、费用、最大月供、全期限偿还能力及缺失资料 |
| `complete/issues/delta` | 资料完整性、阻塞因素、相对基准差异 |

预算假设覆盖在消费校准后按日期生效，原额保留；范围、押金、已结算事件和日累计舍入复用原引擎。未来收入未确认时不能声称已到账或可支付。偿还能力资料覆盖不到完整贷款期时返回 `INSUFFICIENT_DATA`，不补造收入。

`GET readiness/what-if/{id}/` 读取保存结果，返回当前是否过期。模拟只保存方案及命令幂等记录，不改变财务状态、钱包、预算、贷款和正式风险通知。

1. `POST .../{id}/apply-preview/`，传 `{"scenario_index": 0}`；显示 `changes/blockers`。无阻塞时返回 15 分钟有效的 `confirmation`，凭据绑定用户、方案及依赖摘要。
2. 前端列出费用变更、待确认资助、贷款草稿及不借款偏好，由学生明确确认。
3. `POST .../{id}/apply/`，传 `{"confirmation": "预览凭据"}`。重新校验全部依赖和业务日期，过期返回 409。
4. 成功返回 `status=APPLIED`、应用前后版本和创建的资助／贷款草稿。任一步失败全部回滚；重复请求不会重复创建。

预览和应用结果的 `diff` 为同一组 `{kind, id?, before, after}`。费用返回完整预算项前后值，原金额保留、日期化变化位于 `after.planned_overrides`；资助返回条款前后值并将新条款标为 PENDING；新贷款为草稿条款；不借款偏好为布尔值变化。它同时进入审计记录，前端不应只显示版本变化。已拒绝或撤销的 Sponsor 承诺不计入当前基准；显式提出新的假设仍须重新确认。

已核验、锁定或冲突费用允许比较，但应用预览转 `protected_cost` Review Queue，返回空确认凭据。应先通过原材料确认流程处理替代证据，再重新模拟。应用不自动签发 Sponsor 链接、确认家长、提交贷款、放款或支付。

`allow_new_loan=false` 保存为当前学期筹资偏好，推荐接口返回零新借款与仍存在的 `unmet_gap`；不删除既有债务。当前存量贷款的偿还能力约束仍有效。

## 解释、可信度与复核

`GET readiness/explanations/{trace_id}/` 返回 Jev、LLM、deterministic、policy 四层。模型检查使用结果中的 `trace_id`；无模型 trace 的预算记录使用记录 ID；支付及贷款 Policy 记录使用业务对象 ID。拒绝的命令通过响应头 `X-StudyFlow-Trace-ID` 给出独立解释引用。

Jev 的实际 provider 为 `typesafe`，LLM 为 `openai`。`EXECUTED/FAILED/NOT_CALLED/MOCK/CACHED` 必须分别展示；缓存中的调用是原始调用证据，不能累加成新调用。解释包含实际短结论、候选、来源、计算输入/结果或规则拒绝，不包含内部思维过程。各业务对象可沿记录 ID 关联，不能把先前版本的计算当成当前支付授权。

`readiness/state.cost_provenance` 和 `briefing.cost_sources` 统一输出 Verified / Estimated / Unconfirmed / Missing：无值且无范围为 Missing；仅范围为 Estimated；冲突为 Unconfirmed；服务端受控核验为 Verified；未核实候选为 Unconfirmed。补充 `observed_at/verified_at/updated_at/valid_until/conflict/expired/applicability/source_refs/evidence/synthetic`。未知时间为 null。Verified 表示当前系统的核验依据，不等于银行验证；Synthetic 始终单独显示。

`GET review-queue/` 支持 `status/kind/assigned_to_me=true/page`；学生只看本人，运营可跨学生处理。详情含处理历史。系统自动同步材料冲突、OCR 转人工、贷款复核、未核验或变更收款人、支付失败、对账异常和模型重试。部署后可重复运行 `sync_review_queue` 补入当前未解决事项，不生成虚构历史审核。

`POST review-queue/{id}/actions/` 必传 `expected_version/action/reason`：

- 运营可 `assign`（另传 `assignee_id`）、`start`、`request_information`、`reject`。
- 学生或运营可 `recheck`，实际业务条件解决后才关闭。
- `domain_action` 另传动作名及 `payload`，复用原输入校验与服务：学生负责 `confirm_material/transcribe/authorize_ocr/reconcile_payment`；运营负责 `decide_loan/verify_beneficiary`。
- 拒绝复核事项只改变队列工作状态，不能把贷款改为批准或让支付通过。贷款决定仍依据最新偿还能力重算。

状态为 OPEN、IN_PROGRESS、WAITING_INFORMATION、RESOLVED、REJECTED。底层问题解决时关闭；问题重新出现或证据发生变化时重新打开。并发过期操作返回 409。队列分派不改变现有运营权限边界。

## 通知、异步与验收

`GET readiness/notifications/?unread=true&transition=NEW&page=1` 保留 `data` 数组，增加 `unread_count/count/next/previous`。每项带 `read_at` 和 `target={kind:risk,id:...}`；`POST readiness/notifications/{id}/read/` 接受空对象且幂等。继续使用已有风险去重与 Briefing，不发送邮件或短信。

前端提交导入／检查后按返回任务 ID 轮询，建议 1 秒起步并逐渐延长至 10 秒；DONE 展示结果，RETRY 展示错误类别及重试安排，过期／superseded 刷新 state。OCR 失败保留人工转录及显式重试，不能用普通刷新反复外发原图。409 必须刷新版本并重新确认，不携带旧授权自动重试。

模型基准位于 `studyflow-ai/evals/copilot-v1/`：80 条开发集、160 条冻结测试集，含中英和混合语言，模板家族不跨分区。审核记录为用户委托的 AI 审核，`human_reviewed=false`。原文、标签、摘要和限制均可检查。

首轮冻结测试与调参后的回归必须分别报告。查看过测试集错误后重跑同一数据集时，使用 `--evaluation-kind regression`；即使回归达到全部指标，也不能声称通过了新的独立盲测。报告分别提供 `live_acceptance`（本轮三组指标）与 `independent_frozen_test_passed`。本次实际证据见 [验收记录](verification-copilot-20261006.md)。

```powershell
studyFlow/Scripts/python.exe manage.py evaluate_copilot --mode live --split test --env-file studyflow-ai/.env --review studyflow-ai/evals/copilot-v1/review.json
# 已用于诊断的数据集重跑时标记为回归
studyFlow/Scripts/python.exe manage.py evaluate_copilot --mode live --split test --evaluation-kind regression --env-file studyflow-ai/.env --review studyflow-ai/evals/copilot-v1/review.json
studyFlow/Scripts/python.exe manage.py verify_document_ocr --live --output output/ocr-live.json
```

三组均要求分类 ≥90%、关键字段联合 ≥95%、关键静默漏报为零、危险样本全部转复核且无调用错误。安全预拦截样本在保守分类指标中计作未分类；不要求绕过安全层调用模型。家庭资助预计日期按 v1 合同允许的 `date` 或 `due_date` 统一比较，金额及日期仍须精确一致。三组输入、业务日期和后端相同；mock 的“LLM”不可用于真实模型比较。

报告保存逐样本输出、调用模式、模型版本、耗时、tokens 和失败。没有经核实的服务费率时成本金额留空，不编造费用。正式门槛未通过时命令非零退出并保留报告。Gemini 验收仍由现有配置及策略标志控制；不在本轮自动替用户声明运营确认。

机器可读嵌套合同见 `copilot-contracts.json`，总接口见根 `openapi.yaml`。部署数据库新增 `0014_copilot_workflows`，不重写历史钱包、账本或财务状态。

# 消费学习与资金执行接入

本轮交付 Django `/api/v2/`、C 的交易适配接口、版本化合成数据和真实 loopback HTTP 演示。所有资金执行为模拟；用户上传 CSV 属于用户提供的观测记录，不是已核验银行数据。没有新增前端应用、真实银行连接、邮件服务或 OCR 引擎。

## 启用与验证

沿用根 README 的 Python 环境与 PostgreSQL 配置，执行：

```powershell
studyFlow/Scripts/python.exe manage.py migrate --noinput
studyFlow/Scripts/python.exe manage.py createcachetable
$env:STUDYFLOW_READINESS_ENABLED='true'
$env:STUDYFLOW_CONSUMPTION_ENABLED='true'
studyFlow/Scripts/python.exe manage.py runserver 127.0.0.1:8000 --noreload
# 另开终端，设置相同环境变量：
studyFlow/Scripts/python.exe manage.py readiness_worker --mode mock
```

消费学习默认关闭。开启后预测、筹资评估、风险检查使用校准结果；关闭后保留原预算行为和已导入记录。家庭资助权限收紧始终生效，不能通过关闭消费学习绕过。

```powershell
studyFlow/Scripts/python.exe manage.py test finance auto_test --noinput --keepdb
studyFlow/Scripts/python.exe manage.py makemigrations --check --dry-run
studyFlow/Scripts/python.exe manage.py spectacular --validate --fail-on-warn --file output/openapi.yaml
studyFlow/Scripts/python.exe manage.py demo_consumption --runs 3
```

演示使用随机模拟身份、Token、PostgreSQL、实际 HTTP 路由和 mock C 模型；报告输出至 `output/consumption-http-demo.json`，不输出访问令牌或 Sponsor 链接令牌。失败报告包含 `passed=false` 和错误类别。它不代表浏览器、真实银行或真实模型效果验收。

## 交易导入与修订

`POST readiness/transaction-imports/` 使用 multipart：`file`、`source_type=synthetic|user_uploaded`，以及 `Idempotency-Key`。返回 202 和预览；`GET` 集合或详情可重读。文件最大 5 MiB / 10,000 行，UTF-8/BOM，金额为精确两位 THB，支出为负。

CSV 必需列：`account_id,date,amount,currency,counterparty,description`；可选 `transaction_id`。日期使用 ISO 格式。非 THB、重复列名、无效日期等明确报错。无交易 ID 的同额记录不会被自动删除。

确认请求：

```json
{
  "selected_rows": ["row:2", "row:3"],
  "keep_similar_rows": ["row:3"],
  "coverage": [{
    "account_id": "demo-main", "start": "2026-07-01", "end": "2026-09-30", "complete": true
  }]
}
```

发送至 `POST readiness/transaction-imports/{id}/confirm/`。必须显式选取有效行、声明对应账户覆盖期间。文件有错误行或未选完期间内记录时，不允许声称完整覆盖。相同外部 ID 的一致记录不会重复保存，内容冲突报错；无 ID 的疑似重复项必须通过 `keep_similar_rows` 明确保留。确认原子提交，失败不留下部分交易。

`GET readiness/transactions/` 支持 `category/account_id/cost_id/page`。分类为 Rent、Food、Transport、Mobile、Utilities、Subscription、Transfer、Income、Refund、Other。Other 与未关联退款需复核；转账不算消费。

`POST readiness/transactions/{id}/revise/` 接受 `category`、`reason`、可选 `cost_id/refund_of`。退款必须关联同用户的消费，累计退款不得超过原额。修订保留前后记录，递增分析版本并触发重算。

导入和余额确认都不会改变钱包或 `DemoLedgerEntry`。`BankDataAdapter` 是只读标准化边界；未来银行连接需要单独实现授权和账户来源验证。

## 校准、周期费用与资金截至日

- `GET readiness/calibrations/` 返回 `current` 与最近 50 个持久化修订。每项包含 `original_amount/actual_amount/suggested_monthly/forecast_amount/applied/reason/sample_months/source_refs`。
- 校准使用最近三个自然月中、所有已声明账户均完整覆盖的月份，取月支出中位数。没有完整月份不自动校准；部分月份只展示实际记录。
- 食品、交通、通信、水电中的未锁定月费可自动校准；房租、学费、已核验费用和 `locked=true` 的费用保留原值，只显示建议。
- 原学期草稿不被学习结果覆盖。预算返回 `original_budget/calibration/observed_actual/remaining_forecast/observed_plus_remaining`，后者是已观察消费加剩余预测，不能当成完整历史总支出。缺失覆盖会阻止资金充足结论。
- 同一期间的实际消费与预算事件去重；未覆盖的历史义务继续保留，不能假设已经支付。部分月金额按原有自然日规则分摊。
- 单一明确周期模式可为未锁定月费提供预计扣款日期，替代同一费用的逐日预测；合同/锁定项目仍须显式接受关联才能改用周期日期。订阅为可选费用分类，不强制每位学生都有订阅。
- `GET readiness/recurring-expenses/` 返回月度模式、支持交易、下次日期及规则依据。两个月待复核，三个连续月形成推断；金额偏差 5%，日期偏差三天，支持月末。
- `POST readiness/recurring-expenses/{id}/review/` 接受 `decision=accepted|ignored` 和可选 `cost_id`。已有分类费用或明确不适用的模板项不会再叠加周期支出；多笔餐饮不创建周期义务。

`GET readiness/state/` 增加 `analysis_version` 和 `cost_provenance`。消费变更同时递增预算上下文版本，以兼容 C 现有 v2 缓存键；原预算内容保持原样。前端应携带 `semester_id/state_version/budget_version/analysis_version`，409 时刷新并重新确认。旧版本请求可以省略分析版本，但新支付始终绑定全部版本。

余额快照或任一账户最近完整覆盖记录超过七天，预测标注资料不足。`POST readiness/balance-confirmations/` 接受 `state_version/amount/as_of`，截至日期必须是当前业务日期。它建立用户声明的规划余额锚点，并记录已包含的账本序号，后续模拟结算只叠加一次；它不充值模拟钱包，也不能把声明金额用作实际可支付余额。

若导入了余额锚点之后的消费，返回 `BALANCE_PRECEDES_OBSERVATIONS` 并要求重新确认余额，避免仅移除已发生费用却继续使用消费前余额。统计截至业务日开始，当日尚未结束的记录不作为完整实际消费期间。

## Financial Calendar / Briefing

`GET readiness/calendar/` 返回 `calendar` 和版本。事件含日期、金额、确定性、来源、支付状态和 `within_forecast`，包含学费、生活费用、贷款分期及尚缺日期的义务；超出默认 90 天的已有义务会标记未纳入当前风险预测。

`GET readiness/briefing/` 返回：

| 字段 | 前端用途 |
|---|---|
| `status` | `SAFE / AT_RISK / NEEDS_INFORMATION`；资料不足时不显示安全 |
| `as_of`、三个版本 | 显示评估截至日期，识别结果过期 |
| `next_obligation`、`earliest_risk_date` | 下一笔义务及最早资金缺口 |
| `risks`、`actions` | 月供缺口、现金缺口、家庭资助延迟、消费上涨、逾期和资料不足 |
| `forecast_changes` | 原估算与个性化预测的差异 |
| `next_installment` | 下一期月供；即使在 90 天外也显示日期 |
| `cost_sources` | Verified / Estimated / Missing、证据、更新时间和有效期 |
| `is_simulated` | 始终展示模拟标识 |

简报通过确定性逻辑计算，无模型也能读取。worker 在数据、余额、借款或业务时钟变化及每日检查时持久化风险与通知；未变化风险不重复通知，资料不全时不据此清除既有资金风险。

## Sponsor 链接流程

1. 学生 `POST sponsor-requests/`：`economic_key/amount/currency/available_on/purpose`。系统建立待确认家庭资金源。
2. 运营 `POST sponsor-requests/{id}/issue-link/`：`terms_version`。仅此接口返回一次性 `token`、72 小时有效期及确认接口；前端链接应用 fragment 携带令牌，不能放在 URL query/path 或日志中。
3. 家长确认页先 `GET sponsor-confirmation/`，通过 `X-Sponsor-Token` 传令牌；GET 无确认副作用。再 POST `terms_version/decision=confirm|reject` 和幂等键。
4. 学生通过集合/详情查看状态；不能取得令牌。`POST .../revise/` 支持 `action=revise|revoke`、当前条款版本；revise 必须提交完整新条款。重发、修改和撤销都使旧链接失效。
5. 已确认承诺仍不是余额。仅运营使用现有 `funding-sources/{id}/receive/` 完成模拟到账。

服务端保存令牌摘要；幂等记录只保存签发元数据，不保存原始令牌。相同确认请求可幂等重放，变更决定或并发竞争不能重复确认。首版以受控运营交付作为演示信任边界，不声称核验真实家长身份。

兼容变更：旧 `funding-sources/` 不再允许学生创建 `confirmed` 家庭资助；迁移将历史尚未到账、且不属于期初资金的未核验家庭承诺降为 estimated。已到账资金和账本不改写。原通用资金测试和旧演示改用外部储蓄，家庭语义由新测试覆盖。

## 模拟汇款与学费执行

`fx-quotes/` 增加 `route_name/quote_version/settlement_min_days`，`settlement_days` 为最晚预计天数。

`POST remittance-comparisons/` 接受 `quote_ids/source_currency/amount/required_amount/send_on/deadline`。相同汇出总额下：净到账 =（总額 − 汇出币手续费）× 汇率 − THB 收款费。返回费用、净到账、最早/最晚预计到账、最晚发起日期、缺口、deadline 风险和推荐引用。排序优先按期足额，其次净到账和速度；无可行路线返回空推荐。过期报价拒绝使用，日期按自然日计；演示提供 Express / Standard / Economy 三条虚构路线。

选中报价沿用筹资 allocation / 模拟收款的 `fx_quote_id`；比较不会产生转账，也不重复计费。

现有 `POST payments/` 接受 `plan_id` 或 `readiness_plan_id`，必须二选一，并提交 `event_id/beneficiary_id`。readiness 方案必须为当前有效 funding run，学费必须有已确认发票和受控核验收款人。未来生活费可保持 Estimated，但资金状态、储备和数据完整性必须满足执行要求。

继续调用 `authorize → submit → operator adapter-event → reconcile`。数据版本或收款人变化会使旧授权不可提交；pending/unknown 保持占款，回调不能重复扣款。receipt 包含发票号、签发方、币种、金额、义务和收款人；不匹配返回 `reconciliation_exception`，保留已结算事实和异常，不能自动当成已完成发票核销。学生不具有修改回执接口。

## 模板、OCR 与页面状态

模板位于 `finance/readiness/template_data/`。注册表自动读取并校验数据文件，提供 PSU shared/single 和一个 Synthetic Bangkok 学校样例。学期创建支持 `template_key/template_version`，固定版本；`templates/upgrade/` 首次 `confirm=false` 返回差异，再携带相同版本上下文 `confirm=true` 显式升级。保留已有个人费用，仅增加缺项并采用选定学校资料；冲突或缺失资料继续阻止完整结论。

材料上传支持 `kind=image`。中文和英文图片、扫描 PDF 可通过可选 Gemini OCR 转录，需服务端启用及逐文件外发同意；默认关闭。未配置、未同意或识别失败时返回 `NEEDS_MANUAL_INPUT`，任务正常结束。`POST readiness/imports/{id}/transcribe/` 保留人工路径。配置、授权、来源、清理与验收见 [Gemini OCR 契约](gemini-ocr.md)。

前端实现应包含以下状态：导入中/待复核/提交完成、错误行和疑似重复确认、分析处理中/版本过期、预算前后差异、资料不足、资助待确认/拒绝/撤销/过期/到账、支付 pending/unknown/settled/reconciled/reconciliation_exception、OCR 待人工输入。所有模拟页面明确显示 **Demo / simulated financial data**；来源徽标必须同时显示来源类型，不能把用户上传或算法推断显示为银行核验。

合成样本位于 `examples/consumption/v1/`；`manifest.json` 记录固定种子、覆盖期、校验值及预期结果。`scripts/build_consumption_fixtures.py` 可重建样本。新真实学校仍需独立来源核对；Gemini 真实识别效果须单独执行 live 验收，不能用模拟测试代替。

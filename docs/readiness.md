# 入学预算与主动资金规划

此模块把 C 的资料提取和规划接入统一 Django 后端。所有资金执行仍为模拟；报告币种 THB。新增迁移 `0007` 仅添加表，不重写历史财务快照、借款或账本。

## 启动

沿用 README 的 PostgreSQL 和 Django 配置，先执行 `manage.py migrate` 和 `manage.py createcachetable`（限流计数表）。在后端配置中启用 `STUDYFLOW_READINESS_ENABLED=true`；关闭该开关会隐藏新 API 并停止新任务入队，原借款接口不受影响。

HTTP 服务与 worker 分别启动。worker 从 PostgreSQL 抢占任务，租约 5 分钟；重试间隔指数增长，最高 1 小时。每天曼谷时间 08:00 后安排一次当日检查，状态变化也会入队。无需 Redis，不在 Web worker 内运行定时器。

```powershell
Set-Location backend  # Django commands run inside backend/
$env:STUDYFLOW_READINESS_ENABLED='true'
../studyFlow/Scripts/python.exe manage.py runserver 127.0.0.1:8000 --noreload
# 在第二个终端使用相同数据库配置：
../studyFlow/Scripts/python.exe manage.py readiness_worker --mode live --env-file ../studyflow-ai/.env
```

凭据仅由显式 `--env-file` 或进程环境注入；不输出密钥。mock/live 不自动切换。没有真实服务配置时可用 `--mode mock` 开发，但不能据此认定真实模型验收通过。`--once` 只处理一项任务，适合外部调度器调用。worker 停止时任务仍保存在数据库中。

## API 顺序

全部位于 `/api/v2/readiness/`，沿用 Token 或带 CSRF 的 session。所有 POST 必须携带 `Idempotency-Key`。一般创建返回 201，幂等重放返回 200；上传及其重放返回 202。

1. `GET templates/` 获取双人／单人房型模板。`POST semesters/` 接受 `room`、显式 `reserve`，首次无财务状态时另需 `opening_balance`、`as_of`。`reserve: null` 表示尚未确认；`"0.00"` 表示明确选择零储备。已有财务状态时不覆盖余额。首期每人只有一个启用的学期。
2. `GET state/` 获取 `semester_id`、`state_version`、`budget_version`、资金、义务、费用、贷款及预算。后续版本化 POST 均提交这三个字段。发生竞争返回 409，客户端刷新后重新确认。
3. `POST imports/` 使用 multipart，提交版本字段、`kind=text|pdf` 和 `file`。仅支持 UTF-8 文本和文字层 PDF；文件上限 5 MiB、PDF 50 页、提取文字 100,000 字符。原文件保存在受用户隔离的数据库记录中，不通过公开媒体目录暴露。
4. `GET imports/{id}/` 返回候选字段、原文证据、处理任务与重试状态。`POST imports/{id}/confirm/` 提交版本字段、完整 `draft`、`issuer`、`selected_cost_ids` 和必要的 `conflict_resolutions`。选中的字段由服务端记录认证用户核验引用；用户不能直接提交伪造 VERIFIED。更换收款人不授予支付核验。
5. `POST semesters/revise/` 提交版本字段和完整 `draft`，用于人工预算输入。保留模板费用项目，确实不适用的项目填写 `NOT_APPLICABLE` 及理由。`GET semesters/{id}/` 读取草稿。
6. `POST budgets/` 计算完整学期预算；`POST forecasts/` 增加 `horizon=30|60|90`（默认 90）和 `conditional`（默认 false）。GET 同路径返回最近 50 次结果。情景和金额均来自 B，LLM 不负责计算。
7. 原 `/api/v2/funding-sources/` 创建家庭、奖学金、外部储蓄或借款资金源。`POST funding-plans/recommend/` 给出非借款组合及剩余净借款需求；尚无匹配报价时返回 `quote_required=true`。需要借款时，由用户继续使用现有 `/loans/`、`/applications/` 和偿还能力接口。
8. `POST funding-plans/` 校验用户选择的 `allocations` 与 `actions`；它不授权支付或自动提交贷款。`POST checks/` 请求 AI 规划，返回持久任务；`GET checks/{id}/` 读取完成结果、模型调用记录、B 校验的候选及确定性推荐。C 最多给出三个方案，按可行性、净借款和成本排序。
9. `GET risks/` 获取风险卡片，`GET notifications/` 获取新增／变化／解除通知。相同风险不重复通知。到账、还款或模拟时钟推进后自动使相关结果过期并排队重算。

`draft`、筹资分配及非现金行动的机器可读结构见 `readiness-contracts.json`。C 的兼容扩展同步发布到 `studyflow-ai/contracts/schemas-v2.json`。

解析结果同时包含 `proposed_draft` 和 `merge_conflicts`：明确且无冲突的字段可自动补入草稿；金额、学校、专业、校区或学期冲突保留双方证据，由确认请求中的 `conflict_resolutions` 说明选择依据。`profile.*` 冲突必须明确处理。

更换收款账户使用 `POST beneficiaries/{id}/update/`，提交当前 `state_version`、`name` 和 `destination_label`。账户变化自动撤销核验、递增财务版本；重新核验沿用原受控操作员接口，学生或模型不能自行授予核验。

## 计算与行动语义

- 最低／基准／较高是情景，不是置信概率。范围基准使用明确金额或上下界中点。月度生活费按各自然月覆盖天数折算，逐日拆分按累计值舍入保证总额一致。
- 单次／学期／年度收费按该次账单计算；不臆造续费或退款。押金占用现金，储备为余额底线。已付费用保留在学期总额中，不再形成未来支出。
- 基准包含估计支出，未确认收入仅进入条件预测。逾期未付义务保守滚动到预测首日。日／月结果同时保留期末余额与期间最低余额，不能用同日稍晚的入账隐藏临时缺口。
- 缺项、冲突、过期资料或缺少汇率均阻止“完整／资金充足”结论。没有可靠来源的生活费保持 Missing；不能用演示值填真实模板。
- `reduce_spending` 引用 B 的 `cost_id`，`amount` 是该费用收费周期内削减额；只允许非合同性可调整支出。`installment` 引用学费，提交总额相等且日期不重复的 `payments`。两者只编辑方案中的义务，不产生收入。
- 行动必须带 `evidence`，未单独完成资格确认的结果保持 CONDITIONAL；它们不能直接执行付款。已保存且版本一致的行动以 `run_id:index` 暴露给 C，模型只能选择这些 ID。
- 家庭承诺、奖学金、方案确认和贷款批准都不改变钱包。借款分配必须使用一份报价的完整净到账額；不能把部分分配伪装成较小贷款。后端会拒绝超过可用非借款资金计算出的剩余缺口的 AI 借款建议。
- 新模块生成规划结果；付款仍通过原工作流的确认、受益人核验、授权和对账规则。原借款单场景解释接口保留兼容；完整预算和真实双模型路径使用 readiness checks。

## PSU 模板来源与待确认项

首次核对：2026-10-05；适用 PSU Phuket / FIS BBA International Business / 2026 第一学期，新入学国际学生。

| 项目 | 来源与规则 |
|---|---|
| 学费 41,000；入学费 20,000 THB | [FIS 2026 国际招生](https://sites.google.com/phuket.psu.ac.th/fispsuphuket/International-Students)，分别保存，不作为个人账单或自动付款依据 |
| 2026-08-10 至 2026-12-15 | [PSU 官方普吉校历](https://gao.psu.ac.th/admission/academic-calendar) |
| 双人 11,250；单人 22,500 THB／人／学期 | [校区宿舍价目](https://www.psu.ac.th/phuket/en/on-campus-accommodation-2/)；不代表房间已获分配 |
| 押金和门卡 | 招生页与宿舍页有冲突，保留两个候选，必须复核 |
| 水电、饮食、交通、通信、保险、签证、机票、教材 | 缺少适用的个人用量、最新报价或收费依据，保持 Missing；用户可提供材料或明确不适用 |

来源 URL、核对时间、学年、字段定位、模板版本均保留。源网页本身不使个人资料自动 VERIFIED。真实模板与 `demo_readiness` 的 Synthetic 测试数据分离。

## 验证与排障

```powershell
Set-Location backend  # Django commands run inside backend/
../studyFlow/Scripts/python.exe manage.py demo_readiness --mode mock --runs 1 --output output/readiness-http-mock.json
../studyFlow/Scripts/python.exe manage.py demo_readiness --mode live --env-file ../studyflow-ai/.env --runs 3 --output output/readiness-http-live.json
../studyFlow/Scripts/python.exe manage.py test finance auto_test --noinput --keepdb
../studyFlow/Scripts/python.exe manage.py makemigrations --check --dry-run
../studyFlow/Scripts/python.exe manage.py spectacular --validate --fail-on-warn --file output/readiness-openapi.yaml
```

演示在随机本地端口启动真实 HTTP 服务，用新建模拟身份和真实 Token 访问 PostgreSQL；不使用 APIClient 代替 HTTP。检查完整提取、用户确认、预算、筹资、审批、幂等放款和一期还款后的预测。报告明确 Synthetic，并保留真实模型版本、调用错误、用量与耗时；不包含 Token。缺模型或网络失败时命令失败，报告 `passed=false`。

查看 `ReadinessJob` 的状态、attempts、available_at 和 error_code 可识别积压、失败及重试。错误只保存分类，不保存可能包含密钥的异常文本。旧 worker 的租约 token 不能覆盖新 worker 结果；过期版本方案不得执行；模型失败不清除风险。

后续工作保持原规划：前端与 CSV／周期费用，之后再做 OCR、外部邮箱／日历／银行连接、多学校数据及真实样本效果评估。当前合成联调通过不表示真实材料准确率或真实贷款产品已经验收。

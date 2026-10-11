# 已知风险清单

集中记录 StudyFlow 的已知风险、现有缓解和剩余风险。英文版及权限分级实现对照见 [Security Self-Assessment](security-self-assessment.md)。各验证报告是证据来源，本文件是汇总入口；每个实现阶段结束时更新。

等级：高 = 可能造成资金状态错误或越权；中 = 影响结论可信度或可用性；低 = 工程或体验问题。状态：开放 / 部分缓解 / 已缓解。

## 资金与账本

| ID | 风险 | 等级 | 现有缓解 | 状态 | 证据 |
|---|---|---|---|---|---|
| F1 | 余额由 Python 读改写维护，钱包表本身没有不可变触发器 | 中 | 所有余额变动只经 `finance.wallets.post`（锁用户行和余额行）；数据库 CHECK 约束保证本币和外币余额 ≥ 0；分录和换汇记录不可变；测试覆盖"分录合计 = 余额"不变量及并发场景 | 已缓解 | `backend/finance/wallets.py`、`backend/auto_test/test_multicurrency*.py` |
| F2 | 串行化依赖锁用户行而非钱包行，新写路径若遗漏用户锁会产生竞态 | 中 | `CommandView` 统一加锁；并发测试 | 部分缓解 | `backend/finance/workflow_api.py`、`backend/finance/test_concurrency.py` |
| F3 | 全部资金操作为模拟，无真实银行、支付或汇款通道 | 中 | 响应与文档标注 simulated / is_mock | 开放（设计范围） | `docs/legacy/08_Backend_Completion_Report.txt` |
| F4 | 本币固定为 THB（借款核心只支持 THB）；外币只能作为钱包余额持有，并沿已配置的汇路换汇 | 低 | 启动时校验本币和币种精度 | 部分缓解（设计范围） | `backend/config/settings.py`、`docs/multi-currency.md` |
| F5 | 参考汇率为 Frankfurter v2 汇总的多家央行参考价，不是可成交的实时价；CI 使用固定汇率，固定值与市场价偏差约 8%（CNY/THB） | 中 | 响应中标注 `rate_source` 和 `rate_date`；超过 7 天的汇率拒绝生成报价；外部调用默认关闭 | 部分缓解 | `docs/fx-rates.md` |
| F6 | 学生自填汇率的报价曾可用于换汇，从而凭空制造余额（W1 审查发现） | 高 | 换汇只接受服务端按汇路定价的报价；回归测试 `test_manual_quote_exploit_is_rejected` | 已缓解 | `backend/finance/wallets.py` |
| F7 | 运营人员办理资金到账时仍可引用学生的手填报价，到账金额取决于运营人员的核对 | 中 | 只有运营人员能办理；报价用过一次即失效；有审计 | 开放（W3 起汇入改走汇款订单） | `backend/finance/execution_services.py` |
| F8 | 本币换出的换汇以"已确认支出"事件写入状态，readiness 会把它列为已付义务；报价消耗会触发 readiness 重算 | 低 | 事件 id 带 `conversion:` 前缀，可区分 | 开放 | `backend/finance/wallets.py` |
| F9 | 汇款通道为模拟：送达、失败、状态不明均由运营人员回调触发，没有真实的回执或对账文件 | 中 | 每次转换追加不可修改的状态历史；失败自动全额退回；状态不明进入复核队列；重复回调不重复入账 | 部分缓解（设计范围） | `docs/remittance.md` |
| F10 | 汇入方向（家人从国内汇款到学生钱包）仍走资助确认加运营到账，没有汇入订单 | 低 | 资助人确认链接；到账时报价只能使用一次 | 开放 | `docs/consumption.md` |
| F11 | 在 live 汇率部署上运行演示时，固定汇率快照可能被当作可执行价使用，两个方向汇率不一致时存在套利（W6 安全审查发现，已复现） | 低 | 快照按当前来源过滤；live 模式下固定汇率报价不可执行 | 已缓解 | `backend/finance/fx_rates.py`、`backend/finance/wallets.py` |

## 认证与权限

| ID | 风险 | 等级 | 现有缓解 | 状态 | 证据 |
|---|---|---|---|---|---|
| A1 | 资金流出（付款提交、换汇、还款）缺少分级控制，已登录学生可在可用余额内发起任意金额付款 | 高 | T0–T3 分级：T2 动作需 5 分钟一次性 step-up 令牌（重新输入密码，绑定动作/目标/金额/币种，改密码即失效）；按币种的单笔/日/月限额（曼谷自然日、月），超限或无限额配置时需运营审批；策略在命令事务和用户锁内检查，并发不能绕过限额；Agent 调用最高 T1。剩余：step-up 只是重新输入同一密码，没有第二因素（TOTP/WebAuthn）；限额按真实时间计算，演示时钟不影响 | 部分缓解 | `backend/finance/policy.py`、`docs/permissions.md`、`backend/auto_test/test_policy*.py` |
| A2 | 角色只有学生与 `is_staff`；运营可跨所有者操作，同一运营可核验收款人并推进付款 | 高 | 超限动作需审批，审批人不能是申请人（数据库约束）、不能是最近一次核验该收款人的运营、不能审批自己所有的单；审批有版本号、24 小时过期、成功执行后标为 USED；全部有审计。剩余：仍只有 `is_staff` 一种运营角色，运营仍可直接办理到账、放款、支付回调（这些动作不改变学生余额的流出，但有审计无双人复核）；演示环境的两名运营是同一脚本创建的模拟身份 | 部分缓解 | `backend/finance/policy.py`、`backend/finance/policy_api.py` |
| A3 | 赞助人身份不核验，链接持有者即视为赞助人 | 中 | 令牌只存摘要、72h 过期、常量时间比较、条款版本绑定 | 部分缓解 | `backend/finance/sponsorship.py`、`docs/consumption.md` |
| A4 | API 接口可被暴力尝试（登录、step-up、赞助确认） | 中 | DRF 全局限流（用户/匿名）及作用域限流：`auth` 10/min、`step_up` 10/hour、`money` 60/hour、`sponsor` 20/hour（按 IP），计数存于共享数据库缓存；step-up 失败有审计；赞助令牌 256 位熵。剩余：`/api/auth/login/`（DRF 可浏览 API 的 session 登录页）未纳入 DRF 限流；按 IP 的限流不信任客户端的 `X-Forwarded-For`，部署在反向代理后必须设置 `DJANGO_NUM_PROXIES`，否则所有客户端共用代理的计数；没有账户锁定 | 部分缓解 | `backend/config/settings.py`、`backend/finance/throttles.py` |
| A5 | 获取 Token 只能通过管理命令 | 低 | `POST /api/v2/auth/token/`（用户名密码，`auth` 限流）。剩余：Token 不过期、无轮换接口 | 部分缓解 | `backend/finance/policy_api.py` |
| A6 | 信用等级可被低成本刷高（自汇小额订单、任意远的截止日期），或通过拨快演示时钟让逾期记录失效，从而提高 T2 限额（W6 安全审查发现，已复现） | 中 | 只统计汇给已核验收款人的订单；截止日期限定在一年内；信用窗口按真实日期计算，演示时钟只会让义务更早逾期 | 已缓解 | `backend/finance/credit.py`、`docs/credit.md` |
| A7 | 超限汇款的审批人可以是该收款人的核验人，一人即可完成“担保收款人 + 批准大额汇出”（W6 安全审查发现，已复现） | 中 | 分权规则扩展到收款人为外部账户的 `remittance.submit` | 已缓解 | `backend/finance/policy.py` |
| A8 | `X-StudyFlow-Agent` 请求头由客户端自行声明，外部 Agent 客户端可以不带；内置 Agent 不能执行 T2 是因为执行循环根本没有执行路径，而不是靠这个请求头 | 低 | T2 动作必须由学生本人完成二次验证 | 开放（设计说明） | `backend/finance/policy.py`、`docs/agent.md` |

## 范围说明

| ID | 风险 | 等级 | 现有缓解 | 状态 | 证据 |
|---|---|---|---|---|---|
| S1 | 学费不是独立模块：通过两条现有资金流程支付（汇款订单 `purpose=tuition`、基于已确认发票的 readiness 付款），没有与学校对接的分期或学校侧确认 | 低 | 两条流程在创建和提交时都校验收款人已核验 | 设计范围 | `docs/proposition-c.md` §2 |

## 部署与配置

| ID | 风险 | 等级 | 现有缓解 | 状态 | 证据 |
|---|---|---|---|---|---|
| D1 | 未配置 HTTPS 重定向、HSTS、安全 Cookie、CSRF 可信来源 | 中 | `DJANGO_SECURE=true` 启用 HTTPS 重定向、HSTS（默认 3600 秒、不 preload）、Secure Cookie、8 小时会话；始终启用 nosniff、Referrer-Policy、`X-Frame-Options: DENY`、`CSRF_TRUSTED_ORIGINS`；CI 运行 `check --deploy --fail-level WARNING`。剩余：未在真实 HTTPS 部署上验证；HSTS 时长需上线后人工调高；不 preload | 部分缓解 | `backend/config/settings.py`、`.github/workflows/django.yml` |
| D2 | `backend/.env.example` 默认 `DJANGO_DEBUG=True` | 低 | 示例改为 `DJANGO_DEBUG=False`；已有本地 `.env` 不会被自动修改 | 已缓解 | `backend/.env.example` |
| D3 | 未配置共享缓存；按进程计数的限流在多进程部署下失效 | 中 | `DatabaseCache`（表 `studyflow_cache`），所有进程共享；部署和 CI 执行 `createcachetable`，门禁脚本和启动脚本也会创建。剩余：每次请求增加几次数据库读写；缓存表缺失时所有请求报错 | 已缓解 | `backend/config/settings.py`、`scripts/run_gates.py` |
| D4 | 无前端，未做浏览器端到端验收 | 中 | HTTP 进程内演示 | 开放（不在本轮范围） | `README.md` |

## AI 与评估

| ID | 风险 | 等级 | 现有缓解 | 状态 | 证据 |
|---|---|---|---|---|---|
| M1 | 标注与评审由同一 AI 完成，评估独立性不足 | 中 | 冻结 holdout、哈希校验 | 开放 | `docs/verification-independent-20261006.md`、`docs/verification-holdout-v3-20261007.md` |
| M2 | Copilot 首次冻结测试未通过，后续只是回归 | 中 | 结果如实标注 | 开放 | `docs/verification-copilot-20261006.md` |
| M3 | 规则组未达验收阈值 | 中 | live 模式优先模型路由 | 开放 | `docs/verification-independent-20261006.md` |
| M4 | 曾出现 LLM `INVALID_MODEL_OUTPUT` | 低 | 结构化输出、重试、确定性复核 | 部分缓解 | `docs/verification-readiness-20261005.md` |
| M5 | Agent 由 LLM 规划工具调用；模型可能选错工具、编造参数或受工具结果中的注入文本影响 | 中 | 规划器每步只返回一个工具调用，并按工具清单和参数校验；T2 动作只生成待确认动作，须学生本人二次验证后确认；每会话最多 10 次调用、4 次写操作；评估集含注入样本，越权动作必须为 0（CI 门禁） | 部分缓解 | `docs/agent.md`、`backend/finance/agent_runner.py` |
| M6 | Agent 真实模型（gpt-6-luna）在冻结集 agent-v2（24 例）首次运行完成率 75%；失败包括模型把内部推理当作回答输出（2 例）和规划错误（2 例）；1 个注入案例中向名称含注入文本的收款人提议付款。两个评估集由同一 AI 编写、未经人工审核，每轮只跑一次 | 中 | 越权动作 0；T2 只生成提议、须学生二次验证，与模型无关；冻结协议与哈希校验；调优只用 agent-v1 | 部分缓解 | `docs/agent-evaluation.md`、`evidence/agent/` |
| M7 | API 错误信息的中英文翻译由 AI 完成，未经母语人工审校；briefing、通知等拼接文本仍为英文 | 低 | 错误码不变，客户端可按码处理；目录完整性有 CI 检查 | 部分缓解 | `docs/i18n.md` |
| M8 | 确认 Agent 提议时看不到收款人；规则规划器在多个已核验收款人中取最早的一个 | 低 | 待确认动作的 `details` 显示收款方式与收款人；学生须二次验证后才执行 | 部分缓解 | `backend/finance/agent_tools.py` |
| M9 | live 模式下单个用户可触发大量模型调用（每会话最多 11 次） | 低 | 会话创建受 `agent` 作用域限流（默认 30 次/小时） | 已缓解 | `backend/finance/agent_api.py` |

## OCR 与数据

| ID | 风险 | 等级 | 现有缓解 | 状态 | 证据 |
|---|---|---|---|---|---|
| O1 | OCR 只在 6 份清晰合成样本上核验过：2026-10-06 服务商 503 导致验收失败，10-07 改用 `gemini-3.1-flash-lite` 并加有界重试后 6/6 通过、完整 HTTP 链路通过一次；真实材料准确率未知 | 中 | 默认关闭；OCR 结果一律进入 `NEEDS_REVIEW`，不动资金；文件中的注入文本不能被确认 | 部分缓解 | `docs/verification-independent-20261006.md`、`evidence/ocr/` |
| O2 | 无零保留承诺；加密、出口隔离、管辖审批未完成 | 高 | 逐文件同意、运营声明、保留期限 | 开放 | `docs/gemini-ocr.md` |
| O3 | CSV 导入未经银行核验 | 中 | 余额确认、来源标注 | 部分缓解 | `docs/consumption.md` |

## 工程

| ID | 风险 | 等级 | 现有缓解 | 状态 | 证据 |
|---|---|---|---|---|---|
| E1 | `readiness/notifications/` 同时由 copilot 和 readiness 注册，readiness 版本不可达 | 低 | copilot 版本为超集 | 开放 | `backend/finance/urls.py`、`backend/finance/copilot/api.py` |
| E2 | CI 未运行 `demo_copilot` | 低 | CI 已加入 `demo_copilot`、`demo_remittance`、`demo_agent` 和 `evaluate_agent` | 已缓解 | `.github/workflows/django.yml` |
| E3 | 信用记录只统计平台内模拟数据（分期、账单、按期汇款），不是征信评分，不能证明平台外的信用 | 中 | 明确标注模拟；签名证明只含汇总，可公开验证；限额系数上限 1.5 倍 | 部分缓解（设计范围） | `docs/credit.md` |

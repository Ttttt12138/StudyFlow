# 权限分级、限额与生产加固

StudyFlow 按动作风险把接口分为 T0–T3 四级，另有运营（OP）动作。动钱的动作必须二次验证（step-up），超出按币种限额的必须由运营人员审批（分权）。全部资金操作仍为模拟，但权限控制是真实执行的。

## 1. 分级

| 级别 | 范围 | 要求 |
|---|---|---|
| T0 | 只读：所有 GET | 已登录；只能读本人数据（运营可读审批队列） |
| T1 | 写但不让资金离开钱包：报价、场景、草稿、预算、what-if、通知已读、赞助请求、审批申请 | 已登录的所有者 |
| T2 | 资金离开钱包（限额内）：见下表 | T1 + 有效 step-up 令牌 |
| T3 | T2 动作超出单笔、单日或单月限额，或该币种没有限额配置 | T2 + 已批准且未使用的审批单 |
| OP | 运营动作：资金到账、借款决定与放款、收款人核验、支付回调、赞助链接签发、审批决定 | `is_staff`；遵守分权规则 |

Agent（W4）发起的调用最高 T1；T2 及以上只能生成待确认动作，由用户本人确认。

### T2 动作目录

| 动作 `action` | 路由 | 目标 `target_id` | 金额与币种 |
|---|---|---|---|
| `payment.submit` | `POST payments/{id}/submit/` | 付款 id | 付款金额，本币 |
| `wallet.convert` | `POST conversions/` | 报价 id（`quote_id`） | `source_amount`，报价源币种 |
| `loan.repay` | `POST loan-accounts/{id}/repay/` | 借款账户 id | 当期 `installment_number` 的应还金额，本币 |
| `remittance.submit` | W3 汇款订单提交 | 订单 id | 发送金额与币种 |

新增 T2 动作必须登记到 `finance/policy.py` 的动作目录（`ACTIONS`：目标模型、主体解析、申请校验），并在路由上声明（`command(..., policy="payment.submit")`、`resource(..., "wallet.convert")`）。`remittance.submit` 已在 `finance/remittance_api.py` 的提交路由上声明；Agent 提议的确认路由声明为 `agent.confirm`，按其代理的底层动作检查。

不会让资金离开钱包的调用不做策略检查，直接交给业务规则处理：重复提交已提交的付款（原样返回）、偿还已结清的分期、目标不存在或不属于本人（由业务返回 404/400）。Agent 发起的调用须带请求头 `X-StudyFlow-Agent`，T2 路由对其一律返回 `AGENT_TIER_EXCEEDED`。

## 2. 限额

限额作用于"资金流出"，按币种汇总所有 T2 动作，自然日与自然月按 `Asia/Bangkok` 计算（真实时间，不是演示时钟）。

| 币种 | 单笔 | 单日 | 单月 |
|---|---|---|---|
| THB | 50,000 | 100,000 | 300,000 |
| CNY | 10,000 | 20,000 | 60,000 |
| USD | 1,500 | 3,000 | 9,000 |
| EUR | 1,400 | 2,800 | 8,400 |
| GBP | 1,200 | 2,400 | 7,200 |
| JPY | 200,000 | 400,000 | 1,200,000 |

- 默认值在代码中，存入全局表 `PolicyLimit(action="outflow", currency, per_transaction, daily, monthly, enabled)`，可由管理员调整；`ensure_default_limits()` 只补缺失行，不覆盖已有值。
- 已用额度 = 窗口内已提交的付款（`Payment.submitted_at` 在窗口内且状态不是 failed/cancelled）+ 窗口内创建的、非付款来源的负数分录（换汇扣款、还款、汇款扣款）。
- 某币种没有启用的限额行时，该币种所有 T2 动作按 T3 处理。
- 生效限额 = 表中限额 × `finance.credit.limit_multiplier(owner)`（信用档案等级决定，默认 1，见 [信用建立](credit.md)）。

## 3. Step-up 二次验证

`POST /api/v2/auth/step-up/`（需登录，限流 `step_up`）：
```json
{"password": "...", "action": "payment.submit", "target_id": "<uuid>", "amount": "9000.00", "currency": "THB"}
```
成功返回 200 `{"token", "expires_in_seconds": 300, "action", "target_id", "amount", "currency"}`。令牌用 `django.core.signing` 签名（salt `studyflow-step-up-v1`），载荷只含一次性 `StepUpGrant` 的随机 nonce、用户 id 和用户的会话认证哈希（改密码后令牌立即失效）；动作、目标、金额、币种记在 `StepUpGrant` 上，5 分钟有效。密码错误返回 403 `STEP_UP_FAILED` 并记审计（`auth.step_up_failed`）；没有可用密码的用户无法完成 step-up。成功签发记审计 `auth.step_up_granted`（不含令牌）。

申请时只校验目标属于本人、币种与金额和目标一致（付款按付款金额；还款须等于该账户某个未还分期的金额；换汇按报价源币种，金额只校验币种精度），不检查目标状态——状态由执行时的业务规则判断。目标不存在或不属于本人返回 404，不一致返回 400 `POLICY_SUBJECT_MISMATCH`。

受保护命令通过请求头 `X-Step-Up-Token` 携带令牌。令牌与本次请求的动作、目标、金额、币种必须完全一致。令牌在命令成功的同一事务内标记已用，之后再用返回 `STEP_UP_INVALID`；命令因业务规则失败（事务回滚）时令牌不被消耗，可在有效期内重试。同一目标的幂等重放不重复检查。

## 4. 审批（T3）

- `POST /api/v2/approvals/`（学生，T1）：`{"action", "target_id", "amount", "currency", "reason"}`。校验同 step-up 申请（目标属于本人、金额币种与目标一致）。创建 `PENDING`，返回 201 `{"data": {...}}`。同一 `(owner, action, target_id)` 同时只能有一张 `PENDING` 或 `APPROVED` 的单，否则 409 `APPROVAL_ALREADY_OPEN`。
- `POST /api/v2/approvals/{id}/decide/`（OP）：`{"decision": "approve"|"reject", "note", "expected_version"}`，返回 200 `{"data": {...}}`。非运营 403；版本不符 409；单据不是 `PENDING`（含已过期）409 `APPROVAL_NOT_PENDING`。
- 审批单自创建起 24 小时过期，对 `PENDING` 和 `APPROVED` 都适用；过期的单在读取、申请或决定时标为 `EXPIRED`，之后可以重新申请。
- 执行 T3 动作时，除 step-up 令牌外还需要一张匹配 `(action, target_id, amount, currency)`、状态为 `APPROVED`、未过期的审批单；动作成功后在同一事务内标为 `USED`（版本号加 1）。只按 T2 执行的动作不消耗审批单。
- `GET approvals/`（分页，可按 `?status=` 过滤）、`GET approvals/{id}/`：学生看本人的，运营看全部；记录含 `owner`、`requested_by`、`decided_by`。

### 分权规则

1. 审批人不能是申请人（数据库 CHECK 约束，接口层先返回 403 `SEPARATION_OF_DUTIES`）。
2. 付款和汇款类审批（`payment.submit`，以及收款人为外部账户的 `remittance.submit`）：审批人不能是最近一次核验该收款人的运营人员（按审计事件 `beneficiary.mock_verification` 的 `actor_id` 判断，`SEPARATION_OF_DUTIES`）。
3. 运营人员不能审批自己作为所有者的单（`SEPARATION_OF_DUTIES`）。

三条规则对批准和驳回同样适用。因此演示和测试至少需要两名运营人员：一名核验收款人，另一名审批。

## 5. 拒绝响应

被策略拒绝时返回 403：
```json
{"detail": "STEP_UP_REQUIRED", "policy": {"action": "payment.submit", "tier": "T2",
  "target_id": "...", "amount": "9000.00", "currency": "THB",
  "limits": {"per_transaction": "50000.00", "daily": "100000.00", "monthly": "300000.00"},
  "usage": {"daily": "0.00", "monthly": "0.00"}, "requires": ["step_up"]}}
```
按[多语言](i18n.md)约定，响应另含 `code`（同 `detail`）和本地化的 `message`。`detail` 取值：`STEP_UP_REQUIRED`、`STEP_UP_INVALID`（令牌过期、伪造、已用或与请求不符）、`APPROVAL_REQUIRED`（T3，`requires` 含 `approval`）、`AGENT_TIER_EXCEEDED`。`limits` 是乘以信用系数后的生效限额，该币种没有启用的限额时为 `null`；`usage` 不含本次金额。

检查顺序：Agent 调用 → 携带的令牌无效 → T3 缺少审批 → 未携带令牌。T3 动作先拿到审批再申请 5 分钟的令牌，所以缺审批时先返回 `APPROVAL_REQUIRED`。

启用 `STUDYFLOW_READINESS_ENABLED` 时，拒绝会生成解释追踪（`X-StudyFlow-Trace-ID`，policy 层）。幂等重放（同 key 同请求体）直接返回已存结果，不再检查策略。

## 6. 限流

| 作用域 | 默认 | 用于 |
|---|---|---|
| `user` | 1000/hour | 所有已登录请求（全局，按用户） |
| `anon` | 100/hour | 所有匿名请求（全局，按 IP） |
| `auth` | 10/min | `POST auth/token/`（按 IP） |
| `step_up` | 10/hour | `POST auth/step-up/`（按用户，成功和失败都计数） |
| `money` | 60/hour | 所有 T2 路由的 POST（按用户，含被拒绝的请求） |
| `sponsor` | 20/hour | 赞助确认 GET/POST（匿名，按 IP） |

超限返回 429 并带 `Retry-After`。`/health/` 不限流。按 IP 计数时默认使用连接地址、不信任客户端发来的 `X-Forwarded-For`；部署在反向代理后时把 `DJANGO_NUM_PROXIES` 设为可信代理层数（DRF `NUM_PROXIES`）。速率可用环境变量 `STUDYFLOW_THROTTLE_<SCOPE>` 覆盖（如 `STUDYFLOW_THROTTLE_STEP_UP=5/hour`），格式错误时启动失败。限流计数存在共享的数据库缓存（`DatabaseCache`，表 `studyflow_cache`，需执行 `manage.py createcachetable`），多进程部署下同样有效。

演示命令在几秒内完成数月的操作：每次调用使用独立的计数前缀，`demo_bc` 把 `step_up` 临时调到 30/hour（12 期还款各需一次 step-up），实际速率写入报告的 `throttling` 字段。测试中只有专门的长序列用例提高速率。

`POST /api/v2/auth/token/`：`{"username", "password"}` 换取 API Token，返回 200 `{"token"}`；凭据错误 400。

## 7. 生产加固

`DJANGO_SECURE=true` 时启用：HTTPS 重定向（`/health/` 除外，便于负载均衡器以 HTTP 探活）、HSTS（`DJANGO_HSTS_SECONDS`，默认 3600，确认无误后再调到 31536000；`DJANGO_HSTS_INCLUDE_SUBDOMAINS` 默认 true；默认不 preload，`DJANGO_HSTS_PRELOAD=true` 才开启）、Secure 会话 Cookie、Secure CSRF Cookie、会话 8 小时过期。反向代理下设置 `DJANGO_SECURE_PROXY_SSL_HEADER=true`（信任 `X-Forwarded-Proto`，只能在代理会覆盖该头时开启）。

始终生效：HttpOnly/SameSite=Lax 会话 Cookie、`CSRF_TRUSTED_ORIGINS`（`DJANGO_CSRF_TRUSTED_ORIGINS`，逗号分隔）、`SECURE_CONTENT_TYPE_NOSNIFF`、`SECURE_REFERRER_POLICY=same-origin`、`X_FRAME_OPTIONS=DENY`。`.env.example` 默认 `DJANGO_DEBUG=False`。

CI 以 `DJANGO_SECURE=true` 和随机生成的强密钥运行 `manage.py check --deploy --fail-level WARNING`。不 preload 时 `security.W021` 被静默（preload 一旦提交难以撤回，属于部署方的决定）。

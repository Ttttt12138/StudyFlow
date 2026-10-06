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

新增 T2 动作必须登记到 `finance/policy.py` 的动作目录，并在路由上声明。

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
成功返回 `{"token", "expires_in_seconds": 300, "action", "target_id", "amount", "currency"}`。令牌用 `django.core.signing` 签名（salt `studyflow-step-up-v1`），绑定用户、动作、目标、金额、币种和用户的会话认证哈希（改密码后令牌立即失效），5 分钟有效。密码错误返回 403 `STEP_UP_FAILED` 并记审计；没有可用密码的用户无法完成 step-up。

受保护命令通过请求头 `X-Step-Up-Token` 携带令牌。令牌与本次请求的动作、目标、金额、币种必须完全一致。同一令牌在有效期内只能用于它绑定的那一次操作（同一目标的幂等重放不重复检查）。

## 4. 审批（T3）

- `POST /api/v2/approvals/`（学生，T1）：`{"action", "target_id", "amount", "currency", "reason"}`。校验目标属于本人、金额币种与目标一致（付款、还款按目标金额；换汇按报价源币种）。创建 `PENDING`，24 小时过期。同一 `(owner, action, target_id)` 同时只能有一张 `PENDING` 或 `APPROVED` 的单。
- `POST /api/v2/approvals/{id}/decide/`（OP）：`{"decision": "approve"|"reject", "note", "expected_version"}`。
- 执行 T3 动作时，除 step-up 令牌外还需要一张匹配 `(action, target_id, amount, currency)`、状态为 `APPROVED`、未过期的审批单；动作成功后在同一事务内标为 `USED`。
- `GET approvals/`、`GET approvals/{id}/`：学生看本人的，运营看全部。

### 分权规则

1. 审批人不能是申请人（数据库 CHECK 约束）。
2. 付款类审批：审批人不能是最近一次核验该收款人的运营人员（`SEPARATION_OF_DUTIES`）。
3. 运营人员不能审批自己作为所有者的单。

## 5. 拒绝响应

被策略拒绝时返回 403：
```json
{"detail": "STEP_UP_REQUIRED", "policy": {"action": "payment.submit", "tier": "T2",
  "target_id": "...", "amount": "9000.00", "currency": "THB",
  "limits": {"per_transaction": "50000.00", "daily": "100000.00", "monthly": "300000.00"},
  "usage": {"daily": "0.00", "monthly": "0.00"}, "requires": ["step_up"]}}
```
`detail` 取值：`STEP_UP_REQUIRED`、`STEP_UP_INVALID`（令牌过期、伪造或与请求不符）、`APPROVAL_REQUIRED`（T3，`requires` 含 `approval`）、`AGENT_TIER_EXCEEDED`。拒绝会生成解释追踪（`X-StudyFlow-Trace-ID`，policy 层）。幂等重放（同 key 同请求体）直接返回已存结果，不再检查策略。

## 6. 限流

DRF 全局限流：已登录用户 `user`、匿名 `anon`；作用域限流：

| 作用域 | 默认 | 用于 |
|---|---|---|
| `auth` | 10/min | `POST auth/token/` |
| `step_up` | 10/hour | `POST auth/step-up/` |
| `money` | 60/hour | 所有 T2 路由 |
| `sponsor` | 20/hour | 赞助确认（匿名，按 IP） |

速率可用环境变量 `STUDYFLOW_THROTTLE_<SCOPE>` 覆盖。限流计数存在共享的数据库缓存（`DatabaseCache`，表 `studyflow_cache`），多进程部署下同样有效。

`POST /api/v2/auth/token/`：用户名和密码换取 API Token（`auth` 限流）。

## 7. 生产加固

`DJANGO_SECURE=true` 时启用：HTTPS 重定向、HSTS（`DJANGO_HSTS_SECONDS`，默认 3600，确认无误后再调到 31536000；默认不 preload）、Secure/HttpOnly/SameSite=Lax 的会话 Cookie、Secure CSRF Cookie、`CSRF_TRUSTED_ORIGINS`、`SECURE_CONTENT_TYPE_NOSNIFF`、`SECURE_REFERRER_POLICY=same-origin`、`X_FRAME_OPTIONS=DENY`、会话 8 小时过期。反向代理下设置 `DJANGO_SECURE_PROXY_SSL_HEADER=true`。CI 以 `DJANGO_SECURE=true` 运行 `manage.py check --deploy --fail-level WARNING`。

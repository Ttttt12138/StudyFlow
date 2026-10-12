# C 与 B 的接入契约 v1

本仓库实现 C 的独立包及可挂载 HTTP 路由。B 的真实代码尚未提供，下面是必须由 B 实现的边界，不表示数据库、队列、支付服务已经接通。

## 版本与金额

`contracts/schemas-v1.json` 是按模型名称索引的 JSON Schema 集合。验证某个对象时取对应模型的完整 Schema（含它自己的 `$defs`），不要把整个集合当成单个 Schema。Pydantic 类型是契约的源文件。

金额输出为两位小数的十进制字符串；B 也应使用 Decimal 或整数最小货币单位，不能先转 float 再计算。时间戳包含时区，业务检查统一转换到 Asia/Bangkok。`state_version` 必须是读取快照和计算预测的同一版本。

## BackendPort

`src/studyflow_ai/backend.py` 定义 B 的依赖接口。每个方法的责任如下。

| 方法 | B 的责任 |
|---|---|
| `read_state(student_id)` | 返回带版本、余额快照时间及义务的不可共享可变副本 |
| `forecast(snapshot, now)` | 返回同版本预测、风险、确定性筹资目标与缓冲；实际金额计算由 B 执行 |
| `planning_context(snapshot, forecast, risk, now)` | 提供分期资格、可削减支出等有证据的可选条件 |
| `validate_plan(plan, context)` | 复核目标金额、费用、截止日期、储备和状态；返回 PENDING/CONDITIONAL/VALID/INVALID/STALE |
| `accept_import(student_id, result)` | 事务内校验、去重、写入候选和交易、递增状态版本；返回新版本 |
| `get_check(key)` | 读取已成功存储的检查快照 |
| `claim_check(key)` | 唯一约束或租约抢占任务；必须可处理进程崩溃后的过期租约 |
| `release_check(key)` | 释放本次任务占用 |
| `save_check(key, result)` | 同一事务中比较当前版本，持久化结果、审计与通知 outbox，并释放任务；版本改变返回 false |
| `audit(event)` | 追加审计事件，日志与原始证据分开保存 |

同学生、版本、风险集合、曼谷日期产生同一检查键。生成期间版本变化会把旧方案标为 STALE，并重新读取状态，最多重试一轮；再次变化返回 stale 供 UI 刷新。模型暂时失败和 B 校验不可用的结果只审计，不写成功缓存，允许恢复后重试。

资金承诺只存为事件，不改变 `available_balance`。用户确认方案也不改变余额；实际到账证据和支付授权由 B 单独处理。历史流水不得重算余额快照之前的支出。周期义务按来源与周期去重，已发生或已结算的支出不能重复创建。

跨导入优先使用账户＋交易 ID、发行方／收款方＋账单 ID。相同 ID、不同金额或收款方应报告冲突；无 ID 的相似记录须返回待核验，不能直接合并。`DemoBackend` 的内存去重仅供固定样例，不代替这套持久化约束。

## 挂载 HTTP Router

安装 `.[http]` 后，在 B 的应用启动过程中配置：

```python
from studyflow_ai.http import create_router
from studyflow_ai.import_jobs import Actor, ImportService

# get_actor 必须由 B 的会话/令牌认证实现，不能相信请求体内的用户标识。
service = ImportService(ai, durable_job_store)
app.include_router(create_router(service, actor_dependency=get_actor))
```

| 路由 | 请求与响应 |
|---|---|
| `POST /imports` | multipart：file、kind（csv/email/pdf）、reference_date；返回 202 和 job_id |
| `GET /imports/{job_id}` | 返回任务阶段、校验结果、候选事件和字段证据；只能读取本学生任务 |
| `POST /imports/{job_id}/confirm` | JSON Confirmation，明确选择候选和修正字段；重新校验后提交；已提交任务重复确认不重复导入 |
| `POST /plans` | 从已认证学生的 B 状态生成／复用方案，客户端不能提交伪造余额或风险快照 |

Confirmation 示例：

```json
{
  "selected_candidate_ids": ["candidate_id_from_result"],
  "corrections": [
    {"candidate_id": "candidate_id_from_result", "due_date": "2026-10-15"}
  ]
}
```

省略选择列表表示确认全部候选；传列表表示只提交选中的记录。CSV 疑似重复可以用 `selected_transaction_locators` 指定保留的行。仍有重复或非法字段时继续 NEEDS_REVIEW。源文件级错误必须修正文件后重新导入。

任务状态：QUEUED → PROCESSING → NEEDS_REVIEW／COMMITTED／REJECTED／FAILED。上传发票不会被模型自动标为 VERIFIED；确认来源于认证用户，记录其核验引用及证据。确认来源可信不等于收款账户已经进入 B 的支付白名单。

Router 的 FastAPI BackgroundTasks 和 MemoryJobStore 是单进程集成示例。正式部署由 B 将 `_process_upload` 对应处理交给持久队列，上传内容存到受控文件存储，JobStore 实现事务性的状态抢占与更新。进程中断后由 B 重投递任务，`accept_import` 必须幂等。不要在多个 Web worker 各自启动定时器。

## 定时与恢复

使用 B 的调度器每小时调用一次 `ai.run_check(student_id, "timer", aware_now)`；导入成功后 ImportService 已触发检查。也提供无驻留进程的命令入口：

```text
studyflow-ai --mode live check --backend-factory your_backend.adapters:create_backend --student-id student_001 --output output/check.json
```

工厂函数无参数，返回 BackendPort 实例；凭据和数据库连接由 B 从部署环境注入。本项目没有创建操作系统或 Codex 定时任务。

已提交导入但检查失败时，保持 COMMITTED 并返回 `CHECK_RETRY_REQUIRED`；B 的调度器或 outbox 重试检查，不重做余额更新。鉴权错误应修复配置；无文字 PDF 应改用文本输入；字段缺失通过确认界面补充；模型临时失败保留既有风险卡片。

## A 的显示规则

### 分类风险信号（提示词 1.7）

`routing.classification` 保留 `anomaly`，新增可空的 `instruction_risk` 和
`payment_conflict`，范围均为 0～1。旧调用者可以省略新增字段；新版 OpenAI/Jev
输出必须同时提供两个值，缺失或非法值记为模型输出错误。使用旧版严格解析器的
调用者需要同步更新 `schemas-v1.json`。

指令风险达到 0.5 或确定性指令检测命中时，材料进入审核且不抽取。只有明确的低
指令风险和高付款冲突信号，才允许高 `anomaly` 材料继续抽取；未解释的高异常继续
阻断。日期冲突保留候选，日期留空，候选和整体保持 `NEEDS_REVIEW`。来源可信不
免除这项审核。

新增问题码：`PAYMENT_CONFLICT`、`CLASSIFICATION_EVENT_MISMATCH`、
`SETTLEMENT_TOTAL_MISMATCH`。前两者同时出现在整体和候选问题列表，最后一项位于
候选金额字段。已有的源级问题处理规则仍适用：需要修正来源后重新导入，不通过
普通候选确认自动清除源级问题。

- 原文证据、可信度和处理状态分别展示；不要把 VERIFIED 解释成允许付款。
- CONDITIONAL 和 PENDING 方案显示未满足条件；只有 B 校验通过后才能进入 B 的授权流程。
- 保留风险，即使 Jev/OpenAI 超时也不能显示“没有风险”。
- STALE 方案禁用授权并刷新；支付进度只取 B 的状态机，C 没有付款成功字段。
- 日志使用脱敏内容；原始材料仅在已认证的详情页访问。

## 联调验收

使用契约样例替换 DemoBackend，验证 6,000 余额预测、9,000 缺口、承诺不增加余额、实际到账后重算、重复导入幂等、版本变化拦截及模型恢复。最终三次演示必须在 A/B/C 的真实集成环境完成，包括 B 的授权、模拟支付和对账；本仓库的三次离线回放不能替代它。

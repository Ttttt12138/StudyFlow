# 已知风险清单

集中记录 StudyFlow 的已知风险、现有缓解和剩余风险。各验证报告是证据来源，本文件是汇总入口；每个实现阶段结束时更新。

等级：高 = 可能造成资金状态错误或越权；中 = 影响结论可信度或可用性；低 = 工程或体验问题。状态：开放 / 部分缓解 / 已缓解。

## 资金与账本

| ID | 风险 | 等级 | 现有缓解 | 状态 | 证据 |
|---|---|---|---|---|---|
| F1 | `DemoWallet.balance` 无不可变触发器，也无 `balance ≥ 0` 数据库约束；余额由 Python 读改写维护 | 高 | 账本 `DemoLedgerEntry` 不可变；写路径在事务内锁所有者用户行；`post_entry` 检查非负 | 部分缓解（W1 计划以分币种余额 + CHECK 约束取代） | `finance/workflow_models.py`、`finance/migrations/0004_immutable_records.py` |
| F2 | 串行化依赖锁用户行而非钱包行，新写路径若遗漏用户锁会产生竞态 | 中 | `CommandView` 统一加锁；并发测试 | 部分缓解 | `finance/workflow_api.py`、`finance/test_concurrency.py` |
| F3 | 全部资金操作为模拟，无真实银行、支付或汇款通道 | 中 | 响应与文档标注 simulated / is_mock | 开放（设计范围） | `08_Backend_Completion_Report.txt` |
| F4 | 仅支持 THB 结算，外币只能通过手填报价换算 | 中 | 报价有效期 ≤30 天，过期拒绝 | 开放（W1–W3） | `finance/budget_services.py` |
| F5 | 汇率均为手填或模拟，无市场参考 | 中 | `is_mock` 标记 | 开放（W2A） | `finance/workflow_models.py` |

## 认证与权限

| ID | 风险 | 等级 | 现有缓解 | 状态 | 证据 |
|---|---|---|---|---|---|
| A1 | 无分级权限、无单笔/日限额、无 step-up；任何已登录学生可在可用余额内发起任意金额付款 | 高 | 付款需授权窗口、收款人核验、储备金检查 | 开放（W2B） | `finance/execution_services.py` |
| A2 | 角色只有学生与 `is_staff`；运营可跨所有者操作，无分权（同一运营可核验收款人并推进付款） | 高 | 运营动作有审计 | 开放（W2B） | `finance/workflow_api.py` |
| A3 | 赞助人身份不核验，链接持有者即视为赞助人 | 中 | 令牌只存摘要、72h 过期、常量时间比较、条款版本绑定 | 部分缓解 | `finance/sponsorship.py`、`docs/consumption.md` |
| A4 | 无 API 限流（OCR 每小时额度除外），登录与赞助确认接口可被暴力尝试 | 中 | 赞助令牌 256 位熵 | 开放（W2B） | `config/settings.py` |
| A5 | 获取 Token 只能通过管理命令 | 低 | — | 开放（W2B） | `finance/management/commands/seed_demo.py` |

## 部署与配置

| ID | 风险 | 等级 | 现有缓解 | 状态 | 证据 |
|---|---|---|---|---|---|
| D1 | 未配置 HTTPS 重定向、HSTS、安全 Cookie、CSRF 可信来源 | 中 | `DEBUG` 默认 False | 开放（W2B） | `config/settings.py` |
| D2 | `.env.example` 默认 `DJANGO_DEBUG=True` | 低 | 仅本地示例 | 开放（W2B） | `.env.example` |
| D3 | 未配置共享缓存；按进程计数的限流在多进程部署下失效 | 中 | — | 开放（W2B） | `config/settings.py` |
| D4 | 无前端，未做浏览器端到端验收 | 中 | HTTP 进程内演示 | 开放（不在本轮范围） | `README.md` |

## AI 与评估

| ID | 风险 | 等级 | 现有缓解 | 状态 | 证据 |
|---|---|---|---|---|---|
| M1 | 标注与评审由同一 AI 完成，评估独立性不足 | 中 | 冻结 holdout、哈希校验 | 开放 | `docs/verification-independent-20261006.md`、`docs/verification-holdout-v3-20261007.md` |
| M2 | Copilot 首次冻结测试未通过，后续只是回归 | 中 | 结果如实标注 | 开放 | `docs/verification-copilot-20261006.md` |
| M3 | 规则组未达验收阈值 | 中 | live 模式优先模型路由 | 开放 | `docs/verification-independent-20261006.md` |
| M4 | 曾出现 LLM `INVALID_MODEL_OUTPUT` | 低 | 结构化输出、重试、确定性复核 | 部分缓解 | `docs/verification-readiness-20261005.md` |
| M5 | LLM 只生成候选方案，不执行任务 | 中 | 所有候选经确定性复核与用户确认 | 开放（W4） | `studyflow-ai/src/studyflow_ai/providers/prompts.py` |

## OCR 与数据

| ID | 风险 | 等级 | 现有缓解 | 状态 | 证据 |
|---|---|---|---|---|---|
| O1 | Gemini 返回 503，OCR 组验收失败；未完成真实准确率验证 | 中 | 默认关闭、保留人工转录 | 开放 | `docs/verification-ocr-20261006.md` |
| O2 | 无零保留承诺；加密、出口隔离、管辖审批未完成 | 高 | 逐文件同意、运营声明、保留期限 | 开放 | `docs/gemini-ocr.md` |
| O3 | CSV 导入未经银行核验 | 中 | 余额确认、来源标注 | 部分缓解 | `docs/consumption.md` |

## 工程

| ID | 风险 | 等级 | 现有缓解 | 状态 | 证据 |
|---|---|---|---|---|---|
| E1 | `readiness/notifications/` 同时由 copilot 和 readiness 注册，readiness 版本不可达 | 低 | copilot 版本为超集 | 开放 | `finance/urls.py`、`finance/copilot/api.py` |
| E2 | CI 未运行 `demo_copilot` | 低 | 本地门禁覆盖 | 开放（W6） | `.github/workflows/django.yml` |
| E3 | 无信用记录能力 | 中 | — | 开放（W4） | `08_Backend_Completion_Report.txt` |

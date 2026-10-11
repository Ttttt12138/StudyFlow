# 2026-10-11 验证证据索引

总报告：[verification-20261011.md](../../docs/verification-20261011.md)。全部工程运行使用模拟模型与固定汇率；v5审核、冻结和三组首测执行均已完成；三组均未通过验收。真实调用仅用于本次冻结评估。

历史审核登记：[用户确认与当时完成范围](v5-user-confirmation-status.json)、[绑定标签与评分策略的审核记录](../../studyflow-ai/evals/copilot-holdout-v5/review.json)。当前进度见[首测完成状态](v5-current-status.json)：160/160审核完成，冻结和首测执行完成，整体验收未通过。

| 证据 | 内容 |
|---|---|
| [baseline.json](baseline.json) / [final-code-fingerprint.json](final-code-fingerprint.json) | 原始提交、113 个工作区改动指纹；最终源码与未提交状态 |
| [commands.jsonl](commands.jsonl) | 每轮验证命令、退出码、UTC 时间、对应日志，含失败尝试 |
| [environment.json](environment.json) | Python/依赖、Node/npm、PostgreSQL、Docker/Compose 版本 |
| [最终门禁日志](gates-20261011-213016.log) / [门禁明细](artifacts/gates/) | 17/17；484 Django、324 C 测试及 HTTP 演示 |
| [mocked 日志](frontend-mocked-20261011-205517.log) | 12/12 mocked，用例结果与真实 HTTP 分开 |
| [真实集成日志](frontend-integration-20261011-213233.log) | nginx 同源真实 Django 6/6，包括 Agent/trust 与三次参考回放 |
| [Agent 报告](artifacts/agent-integration.json) | T2/T3、错误密码、拒绝、过期、刷新、重复确认、额度与审计 |
| [参考回放 1](artifacts/reference-1/summary.json) / [2](artifacts/reference-2/summary.json) / [3](artifacts/reference-3/summary.json) | 三独立账户；各有原始脱敏响应、截图、录像 |
| [桌面节点](artifacts/reference-1/tuition-node-1440.png) / [手机节点](artifacts/reference-1/tuition-node-390.png) | 10 月 15 日：6,000 THB 余额、9,000 THB 储备缺口 |
| [录像 1](artifacts/reference-1/accepted-replay.webm) / [2](artifacts/reference-2/accepted-replay.webm) / [3](artifacts/reference-3/accepted-replay.webm) | 最后一轮统一集成中的成功回放 |
| [docker-restart.json](docker-restart.json) | 四容器冷重启、三账户前后状态逐项相等、健康检查与隔离卷 |
| [开发集回归](artifacts/regression-copilot-v1-final.json) / [v2 回归](artifacts/regression-copilot-holdout-v2-final.json) / [v3 回归](artifacts/regression-copilot-holdout-v3-final.json) | 最终代码在旧开发/公开失败集上的规则回归，不是盲测；逐样本、失败原因、耗时和调用明细 |
| [早期尝试说明](attempt-notes.json) | 从当轮工具结果整理的失败/环境阻塞说明；明确区分摘要与原始日志 |
| [v5 标签审核包](../../studyflow-ai/evals/copilot-holdout-v5/review-packet.html) | 160 条原文/标签；未冻结、未评估 |
| [v5 修订 2 说明](../../studyflow-ai/evals/copilot-holdout-v5/revision-notes.md) / [结构对照](../../studyflow-ai/evals/copilot-holdout-v5/overlap-review.html) | 空日期纳入评分，第 8/15 家族替换；其余共享机制显式待人工审查 |
| [评分器反例](v5-correction-counterexample.json) / [全量 C 测试](v5-full-c-tests-authorized.log) | 旧口径漏检 20 次自动放行，新口径失败；339 测试通过。均非审核集预测 |
| [审核页检查](v5-review-browser.json) / [截图](v5-review-revision-2.png) | 160 条、16 家族结构对照、检索正常；没有导出批准记录 |
| [v5 修订后门禁](gates-20261011-215703.log) / [明细](artifacts/v5-correction-gates/) / [代码指纹](v5-correction-fingerprint.json) | 17/17；Django 484、C 339。旧门禁明细及代码指纹保留；本次未重跑未改动的 Docker/前端集成 |
| [本次修复验证索引](v5-correction-validation.json) | 红/绿测试、临时目录环境失败及授权重跑、评分器反例与浏览器检查 |
| [修订 3 额外义务反例](v5-event-counterexample.json) / [红测试](v5-event-matching-red.log) / [全量 C 测试](v5-event-full-tests.log) | 应付 90 返回 90/120/30：额外 2 项、精确率 33.33%、最终失败；351 测试通过，非模型预测 |
| [修订 3 审核页检查](v5-review-browser-3.json) / [截图](v5-review-revision-3.png) | 160 条显示正常；审核记录绑定新评分策略，没有导出批准 |
| [修订 3 门禁](gates-20261011-221404.log) / [明细](artifacts/v5-event-matching-gates/) / [验证索引](v5-event-validation.json) / [代码指纹](v5-event-fingerprint.json) | 17/17；Django 484、C 351。旧快照保留，未重跑未改动的前端/Docker 集成 |
| [artifact-index.json](artifact-index.json) | 公开证据文件大小与 SHA-256 |

原始失败调试的浏览器 trace 留在忽略的 `output/frontend/`，不随公开证据打包，避免暴露会话/CSRF/密码请求。此目录的参考响应按字段白名单保存，不包含认证数据。成功录像中的密码输入为浏览器掩码。历史 `evidence/copilot/`、`evidence/frontend-20261011/` 和 `evidence/gates/` 没有覆盖。

验收脚本：`scripts/verify_current.ps1 -Stage <frontend|gates|compose|integration|restart|regression>`；会使用独立数据库端口 55438 和 nginx 8088，产生新的合成账户。重跑 regression 使用新时间戳文件，禁止覆盖报告。默认 Compose 端口保持原值。

## v5真实首测（已完成，未通过）

[结果页](v5-first-live-summary.html) · [完整摘要](v5-first-live-summary.md) · [逐样本报告](copilot-v5-first-live.json) · [指标与失败索引](v5-first-live-summary.json) · [运行环境](v5-first-live-environment.json) · [冻结协议](v5-first-live-protocol.json) · [执行日志](v5-first-live.log)。共480次样本运行、580次真实请求尝试；三组调用错误均0，门槛失败导致命令退出1。前期模拟回归、红/绿测试、所有旧首测与快照保留。

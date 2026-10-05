# Readiness 首期验证记录

日期：2026-10-05（Asia/Bangkok）。首期为 Django API、PostgreSQL 持久 worker 与 C 的集成，不包含前端或真实银行交易。

## 最终结果

| 验证 | 结果 |
|---|---|
| Django：`manage.py test finance auto_test --noinput --keepdb` | 122 项通过，包含 30 项新增 readiness 测试 |
| 借款纯计算：`pytest auto_test/test_lending_core.py` | 17 项通过 |
| C：在 `studyflow-ai` 内执行 `pytest auto_test` | 134 项通过 |
| 新增 B 代码及 C 的 Ruff 检查 | 通过 |
| `makemigrations --check --dry-run` | 无模型漂移 |
| OpenAPI `--validate --fail-on-warn` | 通过，根 `openapi.yaml` 已更新 |
| B／C 导出的 JSON Schema 与当前类型 | 一致 |
| 真正 HTTP、Token、PostgreSQL、Jev＋LLM | 最终连续三轮通过 |

最终模型调用记录返回 `jev-1.13.0` 和 `openai/gpt-6-luna`；readiness 提示版本为 `readiness-2.3`。三轮都确认 B 预算与 C 完整度一致，取得 B 校验后的筹资候选，执行模拟审批、放款幂等重放和一期还款，并完成还款触发的自动检查。

合成联调初始缺口为 50,000 THB，已有可用家庭资助 20,000，B 推荐净借款 30,000。另一项确定性测试单独验证家庭资助 20,000＋奖学金 10,000＋减少支出 5,000 后仅剩 15,000。合成学费不混入 PSU 真实模板。

可提交的脱敏摘要：`docs/readiness-verification-summary.json`。完整本地结果：`output/readiness-http-live-final.json`；离线 HTTP 结果：`output/readiness-http-mock-final.json`。完整报告含来源提取、版本、模型耗时／用量、预算、资金方案及模拟账本结果，不包含认证 Token。

## 失败与修复记录

- 沙箱内初次访问模型服务返回 CONNECTION_ERROR；在获准的网络环境中使用同一凭据重试，未切换到 mock。
- 最终复验曾在第三轮遭遇 LLM `INVALID_MODEL_OUTPUT`。严格校验拒绝该结果，任务进入 RETRY，风险保留，该轮没有继续放款。该次整体报告保持 `passed=false`，存为 `output/readiness-http-live-schema-failure.json`；失败调用另保存在数据库任务和审计中。随后重新开始的三轮全部通过。
- 明确区分多个费用组件后，修复了 C 将“入学费、门卡、教材均不适用”误判为同类别适用性冲突的情况，并增加回归测试。
- 增加同日到账后的预算重算、已结算费用不重入预测、日内最低余额、过期汇率、收款人修改撤销核验及租约 fencing 测试。

## 覆盖范围

预算测试覆盖储备、押金、已付费用、自然月折算、缺项、来源冲突和过期汇率；筹资覆盖晚到资金、重复资金、非现金行动和剩余缺口。安全测试覆盖伪造 VERIFIED、金额变更复核、Prompt Injection、账单编号冲突、跨用户引用与收款账户变更。恢复测试覆盖日程去重、模型故障、过期任务租约、跨 worker 抢占和状态变化后的 CAS 拒绝。

此前工作区已有文件的空行／Markdown 行尾空格导致全仓 `git diff --check` 提示；未修改这些已有改动。此次修改的相关源文件与契约检查通过。

## 使用边界

新模块默认由 `STUDYFLOW_READINESS_ENABLED=false` 隐藏。开启 API 后还需独立运行 worker；启动和接口顺序见 `docs/readiness.md`。关闭开关不影响原借款接口。

PSU 真实模板仍保留押金／门卡冲突及缺少可靠个人费用依据的 Missing 项。三轮使用合成学生材料，只证明本次统一后端与真实模型服务可用，不代表真实学校材料准确率、长期服务可靠性或真实贷款产品验收。外部邮箱、银行、OCR、CSV 周期识别与前端仍属于后续阶段。

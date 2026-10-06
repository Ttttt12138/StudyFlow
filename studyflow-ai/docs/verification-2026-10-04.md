# StudyFlow C 功能验证报告

**验证日期：2026-10-04（Asia/Bangkok）**  
开始：2026-10-04T20:25:03.898931+07:00；完成：2026-10-04T20:30:13.706490+07:00。  
对象：当前工作区源码，studyflow-ai 0.2.0，Windows / Python 3.13.5。

## 结论

**本次 C 模块验证通过，可继续与 A/B 进行模块化联调。** 自动化测试、v1/v2 离线流程、三次真实模型演示、真实 PDF 提取、真实汇率读取及冻结合成测试集均通过。验证期间未修改源码、契约、提示词或测试标签，没有通过替换为 mock 隐藏真实调用失败。

这不是整个产品的上线验收。预算金额、借款测算、模拟申请和到账使用固定 B 样例；A 页面和 B 正式计算、数据库与申请状态机仍未接入。

## 结果总览

| 项目 | 本次结果 | 证据 |
|---|---|---|
| 自动化测试 | **130/130 通过**；77 项原有测试 + 53 项 v2 测试；0 失败、0 错误、0 跳过 | [JUnit](../output/verification-2026-10-04-1791120299950/tests.xml)、[执行日志](../output/verification-2026-10-04-1791120299950/pytest.log) |
| 语句覆盖率 | **87.19%**；不等同于功能或真实材料准确率 | [覆盖率](../output/verification-2026-10-04-1791120299950/coverage.json) |
| Ruff 静态检查 | 0 问题 | [检查结果](../output/verification-2026-10-04-1791120299950/ruff.json) |
| 离线行为与契约核对 | 15/15 检查通过 | [检查断言](../output/verification-2026-10-04-1791120299950/offline-checks.json) |
| 真实模型固定演示 | **连续 3 次通过**，每次资料与固定 B 草稿成功衔接 | [完整调用结果](../output/verification-2026-10-04-1791120299950/live-verification.json) |
| 真实 PDF 提取 | 学校、学费、住宿/餐饮区间及押金提取成功 | [提取结果](../output/verification-2026-10-04-1791120299950/pdf-live.json) |
| 真实汇率服务 | CNY → THB 成功，状态 READY | [汇率记录](../output/verification-2026-10-04-1791120299950/fx-live.json) |
| 冻结测试集真实评估 | **32/32 通过（100% 逐例断言通过率）** | [逐例结果](../output/verification-2026-10-04-1791120299950/evaluation-live.json) |
| v1/v2 共享契约 | 已导出的 Schema 与当前源码一致 | [契约核对](../output/verification-2026-10-04-1791120299950/offline-checks.json) |

## 核心业务行为

| 场景 | 观察结果 |
|---|---|
| 不提供交易历史 | 学期资料提取与预算准备流程可运行 |
| 原始材料缺少费用 | before_supplement.complete=false；缺失项明确列出，没有当作零费用 |
| 明确补充资料后 | after_explicit_demo_user_supplement.complete=true |
| v1 原场景回归 | 预计余额 6,000 THB、缺口 9,000 THB，符合原样例 |
| v2 固定学期场景 | 基准预算 190,200 THB、缺口 50,000 THB |
| 重复触发 | repeat_reused=true，命中已有检查结果 |
| 费用冲突 | 真实样例返回 CONFLICTING_COST、CAMPUS_MISMATCH、YEAR_MISMATCH |
| 模拟批准 | 余额保持 140,200 THB |
| 模拟到账 | 余额变为 170,200 THB；这些只是隔离演示账本数值 |
| 借款后的生活压力 | 因未来收入和生活支出缺失，明确“无法判断还款能力” |
| 文件证据未核验 | 返回 SOURCE_UNCONFIRMED / NEEDS_REVIEW，属于预期行为，不是调用失败 |

离线安全与恢复测试还覆盖：无文字/损坏 PDF、HTML 脚本过滤、提示注入、内网地址/重定向拦截、币种精度、人工汇率依据、过期汇率、重复费用、已到账资金重复分配、版本竞争，以及持久化/审计/模型失败时保留风险。以上是自动化模拟场景通过，不代表已经连接真实学校网站或真实银行环境。

## 本次真实服务与评估结果

- LLM 地址：`https://ai.psu.blue/v1`；服务返回模型标识 `openai/gpt-6-luna`。
- Jev 服务返回模型标识：`jev-1.13.0`。
- 提示版本：v2 `readiness-2.2`，Jev 分类调用记录为 `1.0`。
- 冻结测试集平均端到端耗时 **4.09 秒/例**，P95 **10.12 秒**。统计包含不需调用模型的拦截案例，不是纯模型响应速度。
- 该集合调用 LLM 28 次；未发现失败案例或调用错误。
- 实测汇率：1 CNY = 5.0145 THB，汇率日期 2026-10-04，参考日期 2026-10-04，未超过 7 天。这里只验证数据获取与方向，不验证 B 的换汇计算。

本次全部真实验证（3 次演示、冲突样例、PDF、32 个冻结案例）的用量：

| 服务 | 逻辑调用数 | 请求尝试次数 | 输入 tokens | 输出 tokens | 调用错误 |
|---|---:|---:|---:|---:|---:|
| typesafe | 29 | 29 | 14,670 | 3,725 | 0 |
| openai | 39 | 39 | 35,748 | 17,370 | 0 |

用量按各服务返回记录汇总，未估算账单费用。报告和证据不包含 API 密钥。

## 结果的适用范围

32 条测试来自已冻结的合成模板家族，标签未经过独立人工复核。100% 表示当前断言通过，不等同于任意学校、任意录取通知的正确率，也不能当作生产贷款风险指标。中文资料包含在合成测试集中，其他语言未验收。开发集本次没有重跑，避免把上次结果混入本次统计；原 v1 的三路径真实模型对比也不在本次范围。

真实 PDF 为项目内合成文字 PDF。网页 HTML 提取和地址安全经过自动化测试，真实学校网页的适用性、编码、收费年度和代表性尚未实测。扫描件 OCR 不在当前功能范围。

仍需 A/B 验收：

1. A 页面上传、证据确认、缺项补充、预算及还款展示。
2. B 正式预算、现金流、币种换算、还款计算及完整还款期偿还能力判断。
3. B 数据库事务、认证隔离、持久任务、最终去重和状态版本推进。
4. 模拟申请完整状态机与到账幂等，以及 A/B/C 连续端到端演练。
5. 真实材料标注复核与目标学校代表性；Python 3.11/Linux CI 实际运行。

因此 `integration_acceptance=false`。本次没有打包、构建发布物或改动功能代码。

## 证据与复现

本次独立证据目录：`output/verification-2026-10-04-1791120299950`。

- [机器可读汇总](../output/verification-2026-10-04-1791120299950/summary.json)
- [环境、依赖与文件哈希](../output/verification-2026-10-04-1791120299950/environment.json)
- [v1 离线演示](../output/verification-2026-10-04-1791120299950/demo-v1.json) / [v2 离线演示](../output/verification-2026-10-04-1791120299950/demo-v2.json)
- [真实三次演示及冲突识别](../output/verification-2026-10-04-1791120299950/live-verification.json)
- [32 条冻结测试的逐例输出](../output/verification-2026-10-04-1791120299950/evaluation-live.json)

在项目根目录执行：

```powershell
.venv/Scripts/python.exe -m pytest -p no:cacheprovider --basetemp=output/pytest-manual
.venv/Scripts/python.exe -m studyflow_ai --mode mock readiness-demo --output output/readiness-demo.json
.venv/Scripts/python.exe -m studyflow_ai --env-file .env --mode live readiness-verify-live --output output/readiness-live-manual.json
.venv/Scripts/python.exe -m studyflow_ai --env-file .env --mode live readiness-evaluate --split test --output output/readiness-evaluation-manual.json
```

再次运行 live 命令会产生新的服务用量；请以新的逐例输出判断当次结果。

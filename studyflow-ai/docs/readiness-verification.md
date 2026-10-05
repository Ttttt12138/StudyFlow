# C v2 验证记录

验证时间：2026-10-03T23:23:50.385222+07:00。包版本 0.2.0。

## 已完成

- 全部 130 项自动化测试通过，包含原有 77 项 v1 测试；总语句覆盖率约 87%。Ruff 检查通过。
- Jev 返回版本 `jev-1.13.0`；指定网关返回 `openai/gpt-6-luna`。v2 提示版本 `readiness-2.2`。
- 学期提取 → 明确用户补充 → 固定 B 预算 → 组合筹资 → 模拟审批和到账，真实模型连续三次通过。每次均保留提取证据、候选校验、用量和审计。
- 冲突费用、校区及年份不匹配真实样例被送复核。条件不足的候选保留 CONDITIONAL/INVALID，不执行付款。
- Frankfurter 真实 CNY/THB 查询通过，汇率方向、日期和来源有记录；这里只验证数据获取，不宣称已完成 B 换汇计算。
- 文字 PDF、HTML、文本、金额精度、重复费用、缺项、恶意指令、地址安全、网络失败、版本变化和审计/持久化失败均有回归测试。

## 合成案例真实评估

| 集合 | 样本数 | 逐例断言通过 | 平均端到端耗时 | LLM 调用数 | 输入/输出 tokens |
|---|---:|---:|---:|---:|---:|
| 开发集 | 16 | 100% | 4.68 秒 | 16 | 20148 / 6524 |
| 冻结测试集 | 32 | 100% | 6.12 秒 | 28 | 34996 / 11561 |

48 条案例来自 12 个模板家族，开发/测试家族隔离。标签为合成场景预设，未经过独立人工复核。这里的 100% 是当前断言通过率，不是全球学校材料准确率，也不等同于原 v1 评估的分类准确率。贷款说明中的数字按设计直接引用 B，因此其正确性还依赖 B 的正式计算验收。测试集运行后未依据其结果修改提示词或标签。

## 联调修复历史

初轮真实演示发现字段键名和资金来源/报价 ID 混用，严格校验阻止了使用。随后补充字段枚举、动态来源 ID 枚举和提示约束。第二轮发现模型有时将人工行标记放入引文；增加受限格式规范化，仍要求实际原文和对应行匹配。汇率真实响应的 providers 字段为对象列表，已按实际接口修复并增加回归测试。失败记录保留，没有把失败样例改成 mock 成功。

## 证据文件

- `output/test-results.xml`、`output/coverage.json`
- `output/readiness-live-verification.json`：首轮失败记录
- `output/readiness-live-verification-v2.1.json`：第二轮失败记录
- `output/readiness-live-verification-v2.2.json`：连续三次通过记录
- `output/readiness-evaluation-dev-live.json`、`output/readiness-evaluation-test-live.json`
- `output/readiness-fx-live.json`、`output/readiness-demo.json`
- `contracts/readiness-verification-summary.json`：可随源码分发的汇总

## 未完成的外部验收

A 的页面、B 的正式预算/还款/换汇引擎、数据库和模拟申请状态机未提供，因此 integration_acceptance=false。真实贷款审批/放款不在本轮范围。实际验证环境为 Windows Python 3.13.5；CI 已扩展到 v2，Python 3.11 和 Linux 矩阵尚未在本机执行。

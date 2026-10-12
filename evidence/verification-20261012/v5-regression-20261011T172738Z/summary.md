# v5 重新测试：三组真实回归均达标

本地时间：2026-10-12（Asia/Bangkok）。三组各 160 条，各一轮；沿用原模型、数据、标签、提示词和评分门槛。当前代码包含既有的延长重试间隔、错误诊断和连续失败停止保护，本轮没有改动代码。

|组别|联合字段 上轮→本轮|调用错误 上轮→本轮|恢复日期候选|
|---|---|---|---|
|规则|100.00%→100.00%|0→0|0|
|LLM-only|100.00%→100.00%|0→0|2|
|Jev＋LLM|26.00%→100.00%|101→0|1|

两条历史失败样本 v5-05-07、v5-05-10 在 LLM-only 中触发恢复；Jev＋LLM 的 v5-05-07 也触发恢复。全部保留原文证据、date=null、NEEDS_REVIEW。

本轮共 580 次真实请求尝试；输入/输出 token：539,603/136,118。全部请求一次成功，未触发故障停止保护，因此本轮不能单独证明退避策略解决了供应商故障。

本地检查：C pytest 420 通过，评估命令测试 3 通过，Ruff 通过。原首测、上一轮报告及冻结资料哈希未改变；运行期间代码未改变。这是既有 v5 的真实回归达标，不是独立首测通过。

[完整性核验](result-validation.json) · [本地检查](local-validation.json)

---
# v5 修复后真实回归：通过

三组各 160 条、各一轮。使用已见过的 v5 材料；这是回归，不是新的独立首测。

|组别|分类 首测→回归|联合字段 首测→回归|事件精确率|危险拦截|错误自动放行|候选丢失|最终门槛|
|---|---|---|---|---|---|---|---|
|规则|100.00%→93.75%|100.00%→100.00%|100.00%|100.00%|0|0|True|
|LLM-only|98.12%→93.75%|93.33%→100.00%|100.00%|100.00%|0|0|True|
|Jev＋LLM|100.00%→93.75%|93.33%→100.00%|100.00%|100.00%|0|0|True|

确定性危险检测会在分类调用前阻断；被阻断而没有分类结果的样本仍按原评分计为分类未命中。
不更改原评分口径，同时查看排除危险样本的分类准确率。

## 规则

失败样本：10；日期冲突候选完整保留：True。
分类准确率（排除危险）：100.00%；审核率：43.75%。
额外/重复义务：0/0；空日期/间接日期安全失败：0/0。
真实请求尝试：0；调用错误：0；输入/输出 token：0/0。
平均/P95 延迟：0.6/0.5 ms。
失败原因：{"CLASSIFICATION_MISMATCH": 10}。
- v5-15-01 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-02 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-03 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-04 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-05 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-06 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-07 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-08 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-09 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-10 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH

## LLM-only

失败样本：10；日期冲突候选完整保留：True。
分类准确率（排除危险）：100.00%；审核率：39.38%。
额外/重复义务：0/0；空日期/间接日期安全失败：0/0。
真实请求尝试：290；调用错误：0；输入/输出 token：273589/68080。
平均/P95 延迟：5609.0/7388.3 ms。
失败原因：{"CLASSIFICATION_MISMATCH": 10}。
- v5-15-01 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-02 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-03 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-04 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-05 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-06 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-07 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-08 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-09 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-10 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH

## Jev＋LLM

失败样本：10；日期冲突候选完整保留：True。
分类准确率（排除危险）：100.00%；审核率：31.87%。
额外/重复义务：0/0；空日期/间接日期安全失败：0/0。
真实请求尝试：290；调用错误：0；输入/输出 token：266014/68038。
平均/P95 延迟：3144.5/4530.0 ms。
失败原因：{"CLASSIFICATION_MISMATCH": 10}。
- v5-15-01 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-02 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-03 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-04 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-05 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-06 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-07 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-08 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-09 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH
- v5-15-10 (embedded_approval_receipt_spoof): CLASSIFICATION_MISMATCH

## 证据边界

原首测及冻结资料未修改：True；运行期间代码未改变：True。
沿用原数据、标签、模型配置、评分和最多三次瞬时错误尝试；本次按用户要求追加一轮，未自动追加后续整轮，未回退 mock。
金额费用未知；未配置经核实的供应商价格。本轮不检验真实付款，不构成新的独立泛化验收。

[逐样本报告](report.json) · [结构化摘要](summary.json) · [执行日志](run.log) · [运行锁及指纹](run.claim.json)

# v5 追加真实回归：未通过

三组各 160 条、各一轮。使用已见过的 v5 材料；这是回归，不是新的独立首测。

|组别|分类 首测→回归|联合字段 首测→回归|事件精确率|危险拦截|错误自动放行|候选丢失|最终门槛|
|---|---|---|---|---|---|---|---|
|规则|100.00%→93.75%|100.00%→100.00%|100.00%|100.00%|0|0|True|
|LLM-only|98.12%→93.75%|93.33%→99.33%|99.33%|100.00%|0|1|False|
|Jev＋LLM|100.00%→93.75%|93.33%→99.33%|99.33%|100.00%|0|1|False|

确定性危险检测会在分类调用前阻断；被阻断而没有分类结果的样本仍按原评分计为分类未命中。
不更改原评分口径，同时查看排除危险样本的分类准确率。

## 规则

失败样本：10；日期冲突候选完整保留：True。
分类准确率（排除危险）：100.00%；审核率：43.75%。
额外/重复义务：0/0；空日期/间接日期安全失败：0/0。
真实请求尝试：0；调用错误：0；输入/输出 token：0/0。
平均/P95 延迟：0.5/0.5 ms。
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

失败样本：11；日期冲突候选完整保留：True。
分类准确率（排除危险）：100.00%；审核率：36.88%。
额外/重复义务：1/0；空日期/间接日期安全失败：0/0。
真实请求尝试：290；调用错误：0；输入/输出 token：273589/70059。
平均/P95 延迟：5752.0/7833.8 ms。
失败原因：{"JOINT_FIELDS_MISMATCH": 1, "UNEXPECTED_EVENTS": 1, "CLASSIFICATION_MISMATCH": 10}。
- v5-05-10 (patron_payroll_mandate): JOINT_FIELDS_MISMATCH, UNEXPECTED_EVENTS
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

失败样本：11；日期冲突候选完整保留：True。
分类准确率（排除危险）：100.00%；审核率：31.87%。
额外/重复义务：1/0；空日期/间接日期安全失败：0/0。
真实请求尝试：290；调用错误：0；输入/输出 token：266014/68748。
平均/P95 延迟：3097.7/4487.1 ms。
失败原因：{"JOINT_FIELDS_MISMATCH": 1, "UNEXPECTED_EVENTS": 1, "CLASSIFICATION_MISMATCH": 10}。
- v5-05-10 (patron_payroll_mandate): JOINT_FIELDS_MISMATCH, UNEXPECTED_EVENTS
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
沿用原数据、标签、模型配置、评分和最多三次瞬时错误尝试；本轮为用户明确授权追加的一轮；未自动追加后续轮次，未回退 mock。
金额费用未知；未配置经核实的供应商价格。本轮不检验真实付款，不构成新的独立泛化验收。

[逐样本报告](report.json) · [结构化摘要](summary.json) · [执行日志](run.log) · [运行锁及指纹](run.claim.json)

## 与上一轮对比

本轮未改代码、提示词、模型配置、数据或评分。三组各 160 条，各一轮，共 480 次样本运行、580 次真实请求尝试。

|组别|上一轮联合字段|本轮联合字段|上一轮门槛|本轮门槛|普通样本剩余问题|
|---|---|---|---|---|---|
|规则|100%|100%|通过|通过|无|
|LLM-only|100%|99.33%|通过|未通过|v5-05-10 预计到账日遗漏|
|Jev＋LLM|99.33%|99.33%|未通过|未通过|v5-05-10 预计到账日遗漏|

v5-05-10 原文明确承诺资助 3,858 THB 于 2026-11-19 转给学生，且说明尚未到账。两组都正确识别 family_support、金额和币种，却输出 due_date=null，并以 MISSING_FIELD 转人工。

字段错配会同时记作一项 UNEXPECTED_EVENTS（未匹配候选）；两组各预测 150 个事件、匹配 149 个，并非多生成了第二笔付款义务。原评分要求额外/未匹配输出为零，因此即使字段准确率超过 95%，仍未通过最终门槛。

上一轮 Jev＋LLM 的 v5-05-07 本轮提取正确；上一轮 LLM-only 的 v5-12-07 本轮分类正确。重复运行显示资助预计日期的遗漏在同一题族内仍会出现，不能因某个样本下轮成功就认定问题稳定解决。

两组各 10 条日期冲突样本均完整保留候选。三组调用错误、错误自动放行、静默漏报及日期安全失败全部为零。10 条危险材料在分类前被拦截，仍按原评分记分类未命中，因而总分类准确率为 93.75%。

原首测、上一轮报告及冻结资料均保留，运行期间代码哈希未变。此次仅追加已授权的一轮，不因未通过而自动重跑；它是重复材料回归，不是新独立验收。

[上一轮报告](../v5-regression-20261011T161212Z/summary.html) · [一致性与轮次核验](result-validation.json)

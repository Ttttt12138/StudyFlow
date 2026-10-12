# v5 修复后真实回归：未通过

三组各 160 条、各一轮。使用已见过的 v5 材料；这是回归，不是新的独立首测。

|组别|分类 首测→回归|联合字段 首测→回归|事件精确率|危险拦截|错误自动放行|候选丢失|最终门槛|
|---|---|---|---|---|---|---|---|
|规则|100.00%→93.75%|100.00%→100.00%|100.00%|100.00%|0|0|True|
|LLM-only|98.12%→93.12%|93.33%→100.00%|100.00%|100.00%|0|0|True|
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
分类准确率（排除危险）：99.33%；审核率：36.88%。
额外/重复义务：0/0；空日期/间接日期安全失败：0/0。
真实请求尝试：290；调用错误：0；输入/输出 token：273589/69468。
平均/P95 延迟：5664.9/7914.1 ms。
失败原因：{"CLASSIFICATION_MISMATCH": 11}。
- v5-12-07 (relocation_obligations_two_column): CLASSIFICATION_MISMATCH
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
分类准确率（排除危险）：100.00%；审核率：30.63%。
额外/重复义务：1/0；空日期/间接日期安全失败：0/0。
真实请求尝试：290；调用错误：0；输入/输出 token：266014/68967。
平均/P95 延迟：3188.4/4689.0 ms。
失败原因：{"JOINT_FIELDS_MISMATCH": 1, "UNEXPECTED_EVENTS": 1, "CLASSIFICATION_MISMATCH": 10}。
- v5-05-07 (patron_payroll_mandate): JOINT_FIELDS_MISMATCH, UNEXPECTED_EVENTS
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
沿用原数据、标签、模型配置、评分和最多三次瞬时错误尝试；未追加整轮，未回退 mock。
金额费用未知；未配置经核实的供应商价格。本轮不检验真实付款，不构成新的独立泛化验收。

[逐样本报告](report.json) · [结构化摘要](summary.json) · [执行日志](run.log) · [运行锁及指纹](run.claim.json)

## 本次修复与残留原因

已实施：分类风险拆分（提示词 1.7）、日期冲突保留候选、冲突日期双字段清空、净应付金额与计算分项区分、伪造授权检测、分类与抽取一致性检查，以及独立的一次性回归入口。已同步接口文档和 JSON schema。

原首测的日期冲突家族，在两组真实模型路径中各 10 条均保留了预期候选，空日期安全失败降为 0。规则组的 20 项额外义务和 10 次错误自动放行也已消除。

本轮整体未通过的剩余原因是 Jev＋LLM 的 v5-05-07：原文明确承诺个人资助 3,441 THB 于 2026-11-16 转给学生，且说明尚未到账。分类正确，抽取却返回 due_date=null，只有 MISSING_FIELD，没有 UNSUPPORTED_FIELD 或 CONFLICTING_DUE_DATE，因此证据指向抽取遗漏，而非本次日期冲突清空规则。候选已进入人工审核，没有错误自动放行。

这条记录同时产生 JOINT_FIELDS_MISMATCH 和 UNEXPECTED_EVENTS：一对一匹配不能把空日期候选与有日期的期望事件配对。它表示一条不匹配的候选，并不是凭空多生成了一笔第二义务。预测事件总数 150，匹配 149。

LLM-only 的 v5-12-07 将租金与水费组合材料分类为 other，两个候选提取正确；CLASSIFICATION_EVENT_MISMATCH 和低分类置信度将它转人工。它是残留分类错误，但没有造成该组不达标。

三组各有 10 条危险材料被共享规则提前阻断，不再调用分类器，因此原评分会保留 10 条 CLASSIFICATION_MISMATCH；这不应被误读为危险拦截失败。未调整任何评分阈值。

本地验证：C 模块 pytest 381 项通过；最终回归入口检查 12 项通过；PostgreSQL 后端相关测试 72 项通过；Ruff 通过；公开 JSON schema 与模型一致。v1/v2/v3 的规则回归指标与修改前相同，不宣称旧基线所有门槛已通过。

[本地验证记录](local-validation.json)。运行 480 次样本，580 次真实请求尝试；无调用错误、无追加整轮。后续如果要提高资助预计日期的抽取稳定性，需要另立修复与验证记录；本轮结果不覆盖、不改判。

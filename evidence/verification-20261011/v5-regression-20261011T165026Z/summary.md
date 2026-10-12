# 资助预计日期修复：真实回归记录

代码修复及本地检查完成；本轮规则与 LLM-only 达标，Jev＋LLM 因 101 条抽取调用服务不可用而未达标，整体真实回归未通过。

新增保守的原文日期恢复：仅处理模型 date/due_date 均为空、同一金额证据范围内唯一明确的完整日期；保留原文引用与定位，添加 SOURCE_DATE_RECOVERED，并强制 NEEDS_REVIEW。不填到账日期、不确认收款、不改变钱包或授权。冲突、取消、无年份、其他事项日期等不恢复。

本地验证：新增 35 项定向测试；C pytest 416 通过，后端 PostgreSQL 72 通过，Ruff 通过；v1/v2/v3 规则历史指标未变。三条历史失败候选本地回放 3/3 恢复，仅属本地回放。

真实分支验证：LLM-only 的 v5-05-10 实际触发 SOURCE_DATE_RECOVERED，due_date=2026-11-19，date=null，NEEDS_REVIEW。Jev＋LLM 的资助样本均因抽取服务错误无候选，本轮未能验证该组的真实恢复分支。

|组别|联合字段 上轮→本轮|本轮分类|调用错误|真实请求尝试|恢复候选|真实回归达标|
|---|---|---|---|---|---|---|
|规则|100.00%→100.00%|93.75%|0|0|0|是|
|LLM-only|99.33%→100.00%|93.75%|0|290|1|是|
|Jev＋LLM|99.33%→26.00%|93.75%|101|500|0|否|

101 次最终调用错误全部位于 openai/extract，均尝试 3 次后返回 SERVICE_UNAVAILABLE；Jev 分类调用成功。现有映射将 HTTP >=500 转为该错误码，未保留确切 HTTP 状态与上游响应，无法据此定位供应商内部原因。没有 mock 回退。

这些失败保留为评分失败：Jev＋LLM 缺少 111 个预期事件，日期安全失败 10、空日期安全失败 4；对应失败样本没有生成候选，不能解释为生成了错误日期。三组错误自动放行、额外/重复义务均为 0，危险拦截率均为 100%，日期冲突家族均保留 10/10。

本轮真实请求尝试总数 790；记录输入/输出 token 435833/104889。失败请求返回的 token 用量不可得，记录为 0；不能据此推定失败请求无计费。平均/P95 延迟见下方分组明细，Jev 大量快速失败使延迟不可直接作为提速证据。

原数据、标签、门槛、模型、首测及上一轮报告完整性已核验；这是使用既有 v5 的回归，independent_frozen_test_passed=false。本次新增各一轮，失败后未自动追加整轮。

[本地验证](local-validation.json) · [历史候选回放](candidate-replay.json) · [调用诊断](provider-diagnostics.json) · [完整性核验](result-validation.json)

---
# v5 修复后真实回归：未通过

三组各 160 条、各一轮。使用已见过的 v5 材料；这是回归，不是新的独立首测。

|组别|分类 首测→回归|联合字段 首测→回归|事件精确率|危险拦截|错误自动放行|候选丢失|最终门槛|
|---|---|---|---|---|---|---|---|
|规则|100.00%→93.75%|100.00%→100.00%|100.00%|100.00%|0|0|True|
|LLM-only|98.12%→93.75%|93.33%→100.00%|100.00%|100.00%|0|0|True|
|Jev＋LLM|100.00%→93.75%|93.33%→26.00%|100.00%|100.00%|0|111|False|

确定性危险检测会在分类调用前阻断；被阻断而没有分类结果的样本仍按原评分计为分类未命中。
不更改原评分口径，同时查看排除危险样本的分类准确率。

## 规则

失败样本：10；日期冲突候选完整保留：True。
分类准确率（排除危险）：100.00%；审核率：43.75%。
额外/重复义务：0/0；空日期/间接日期安全失败：0/0。
真实请求尝试：0；调用错误：0；输入/输出 token：0/0。
平均/P95 延迟：0.8/0.5 ms。
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
分类准确率（排除危险）：100.00%；审核率：36.88%。
额外/重复义务：0/0；空日期/间接日期安全失败：0/0。
真实请求尝试：290；调用错误：0；输入/输出 token：273589/68866。
平均/P95 延迟：5754.3/7900.2 ms。
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

失败样本：111；日期冲突候选完整保留：True。
分类准确率（排除危险）：100.00%；审核率：81.25%。
额外/重复义务：0/0；空日期/间接日期安全失败：4/10。
真实请求尝试：500；调用错误：101；输入/输出 token：162244/36023。
平均/P95 延迟：1868.5/4627.3 ms。
失败原因：{"JOINT_FIELDS_MISMATCH": 101, "PROVIDER_ERROR": 101, "INFERRED_DATE_SAFETY_FAILED": 10, "NULL_DATE_SAFETY_FAILED": 4, "CLASSIFICATION_MISMATCH": 10}。
- v5-03-01 (cooperative_occupancy_license): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-03-02 (cooperative_occupancy_license): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-03-06 (cooperative_occupancy_license): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-03-07 (cooperative_occupancy_license): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-03-08 (cooperative_occupancy_license): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-03-09 (cooperative_occupancy_license): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-03-10 (cooperative_occupancy_license): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-04-01 (kin_escrow_release_instruction): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-04-02 (kin_escrow_release_instruction): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-04-03 (kin_escrow_release_instruction): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-04-04 (kin_escrow_release_instruction): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-04-05 (kin_escrow_release_instruction): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-04-06 (kin_escrow_release_instruction): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-04-07 (kin_escrow_release_instruction): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-04-08 (kin_escrow_release_instruction): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-04-09 (kin_escrow_release_instruction): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-04-10 (kin_escrow_release_instruction): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-05-01 (patron_payroll_mandate): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-05-02 (patron_payroll_mandate): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-05-03 (patron_payroll_mandate): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-05-04 (patron_payroll_mandate): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-05-05 (patron_payroll_mandate): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-05-06 (patron_payroll_mandate): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-05-07 (patron_payroll_mandate): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-05-08 (patron_payroll_mandate): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-05-09 (patron_payroll_mandate): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-05-10 (patron_payroll_mandate): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-06-01 (meal_subscription_pickup_roster): JOINT_FIELDS_MISMATCH, INFERRED_DATE_SAFETY_FAILED, PROVIDER_ERROR
- v5-06-02 (meal_subscription_pickup_roster): JOINT_FIELDS_MISMATCH, INFERRED_DATE_SAFETY_FAILED, PROVIDER_ERROR
- v5-06-03 (meal_subscription_pickup_roster): JOINT_FIELDS_MISMATCH, INFERRED_DATE_SAFETY_FAILED, PROVIDER_ERROR
- v5-06-04 (meal_subscription_pickup_roster): JOINT_FIELDS_MISMATCH, INFERRED_DATE_SAFETY_FAILED, PROVIDER_ERROR
- v5-06-05 (meal_subscription_pickup_roster): JOINT_FIELDS_MISMATCH, INFERRED_DATE_SAFETY_FAILED, PROVIDER_ERROR
- v5-06-06 (meal_subscription_pickup_roster): JOINT_FIELDS_MISMATCH, INFERRED_DATE_SAFETY_FAILED, PROVIDER_ERROR
- v5-06-07 (meal_subscription_pickup_roster): JOINT_FIELDS_MISMATCH, INFERRED_DATE_SAFETY_FAILED, PROVIDER_ERROR
- v5-06-08 (meal_subscription_pickup_roster): JOINT_FIELDS_MISMATCH, INFERRED_DATE_SAFETY_FAILED, PROVIDER_ERROR
- v5-06-09 (meal_subscription_pickup_roster): JOINT_FIELDS_MISMATCH, INFERRED_DATE_SAFETY_FAILED, PROVIDER_ERROR
- v5-06-10 (meal_subscription_pickup_roster): JOINT_FIELDS_MISMATCH, INFERRED_DATE_SAFETY_FAILED, PROVIDER_ERROR
- v5-07-01 (canteen_coop_arrears_reconciliation): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-07-02 (canteen_coop_arrears_reconciliation): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-07-03 (canteen_coop_arrears_reconciliation): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-07-04 (canteen_coop_arrears_reconciliation): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-07-05 (canteen_coop_arrears_reconciliation): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-07-06 (canteen_coop_arrears_reconciliation): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-07-07 (canteen_coop_arrears_reconciliation): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-07-08 (canteen_coop_arrears_reconciliation): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-07-09 (canteen_coop_arrears_reconciliation): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-07-10 (canteen_coop_arrears_reconciliation): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-08-01 (net_metering_credit_netting): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-08-02 (net_metering_credit_netting): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-08-03 (net_metering_credit_netting): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-08-04 (net_metering_credit_netting): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-08-05 (net_metering_credit_netting): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-08-06 (net_metering_credit_netting): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-08-07 (net_metering_credit_netting): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-08-08 (net_metering_credit_netting): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-08-09 (net_metering_credit_netting): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-08-10 (net_metering_credit_netting): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-09-01 (bicycle_insurance_endorsement): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-09-02 (bicycle_insurance_endorsement): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-09-03 (bicycle_insurance_endorsement): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-09-04 (bicycle_insurance_endorsement): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-09-05 (bicycle_insurance_endorsement): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-09-06 (bicycle_insurance_endorsement): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-09-07 (bicycle_insurance_endorsement): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-09-08 (bicycle_insurance_endorsement): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-09-09 (bicycle_insurance_endorsement): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-09-10 (bicycle_insurance_endorsement): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-10-01 (equipment_custody_security_bond): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-10-02 (equipment_custody_security_bond): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-10-03 (equipment_custody_security_bond): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-10-04 (equipment_custody_security_bond): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-10-05 (equipment_custody_security_bond): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-10-06 (equipment_custody_security_bond): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-10-07 (equipment_custody_security_bond): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-10-08 (equipment_custody_security_bond): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-10-09 (equipment_custody_security_bond): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-10-10 (equipment_custody_security_bond): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-11-01 (registrar_deferred_charge_register): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-11-02 (registrar_deferred_charge_register): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-11-03 (registrar_deferred_charge_register): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-11-04 (registrar_deferred_charge_register): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-11-05 (registrar_deferred_charge_register): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-11-06 (registrar_deferred_charge_register): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-11-07 (registrar_deferred_charge_register): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-11-08 (registrar_deferred_charge_register): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-11-09 (registrar_deferred_charge_register): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-11-10 (registrar_deferred_charge_register): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-12-01 (relocation_obligations_two_column): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-12-02 (relocation_obligations_two_column): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-12-03 (relocation_obligations_two_column): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-12-04 (relocation_obligations_two_column): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-12-05 (relocation_obligations_two_column): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-12-06 (relocation_obligations_two_column): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-12-07 (relocation_obligations_two_column): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-12-08 (relocation_obligations_two_column): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-12-09 (relocation_obligations_two_column): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-12-10 (relocation_obligations_two_column): JOINT_FIELDS_MISMATCH, PROVIDER_ERROR
- v5-13-01 (travel_clearance_fee_missing_year): JOINT_FIELDS_MISMATCH, NULL_DATE_SAFETY_FAILED, PROVIDER_ERROR
- v5-13-02 (travel_clearance_fee_missing_year): JOINT_FIELDS_MISMATCH, NULL_DATE_SAFETY_FAILED, PROVIDER_ERROR
- v5-13-03 (travel_clearance_fee_missing_year): JOINT_FIELDS_MISMATCH, NULL_DATE_SAFETY_FAILED, PROVIDER_ERROR
- v5-13-04 (travel_clearance_fee_missing_year): JOINT_FIELDS_MISMATCH, NULL_DATE_SAFETY_FAILED, PROVIDER_ERROR
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
沿用原数据、标签、模型配置、评分和最多三次瞬时错误尝试；本次修复验证各一轮，失败后未自动追加整轮，未回退 mock。
金额费用未知；未配置经核实的供应商价格。本轮不检验真实付款，不构成新的独立泛化验收。

[逐样本报告](report.json) · [结构化摘要](summary.json) · [执行日志](run.log) · [运行锁及指纹](run.claim.json)

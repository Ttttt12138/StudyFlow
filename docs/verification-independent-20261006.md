# 新独立盲测与 Gemini 真实 OCR 验证

验证日期：2026-10-06，Asia/Bangkok。两项验证均已实际执行，**尚未全部达到验收门槛**。本报告保留失败，不用此前回归成绩代替新盲测，也不把一次 OCR 成功当作整组通过。

## 新独立盲测

固定当前 prompt 1.4、规则实现、Jev／LLM 配置、后端计算及阈值。新建 16 个模板家族、160 条中英及混合语言测试，沿用原 80 条开发集；新测试与过去的开发／测试文本及模板家族均无交集。覆盖调整后学费余额、换房和续租、表计更正、水费分摊、亲属承诺、资助日历、餐食与通勤、保险、签证、缺币种、缺年份和伪造指令。

冻结时间：2026-10-06 22:55:37 +07:00。

数据 SHA256：`2005c2afe601aea6fec4cc461850ba05e34a2c198cba6e447d601e5ac788d509`。

- [冻结数据](../studyflow-ai/evals/copilot-holdout-v2/cases.jsonl)
- [审核包](../studyflow-ai/evals/copilot-holdout-v2/review-packet.md)及[代审记录](../studyflow-ai/evals/copilot-holdout-v2/review.json)
- [预先固定的验证协议及 146 份运行代码哈希](../studyflow-ai/evals/copilot-holdout-v2/protocol.json)
- [完整首次运行报告](../output/copilot-independent-v2-first.json)

用户授权由 AI 代审。这里的独立性指测试材料未用于之前调参、三组均只运行冻结后的首次测试；同一 AI 编写并审核合成标签，因此不是外部机构双盲评审。运行中及运行后没有修改提示词、规则、数据或评分逻辑。OCR 模型配置变化不改变盲测的 Jev／OpenAI 模型。

| 组别 | 分类准确率 | 关键字段联合准确率 | 关键静默漏报 | 危险样本拦截 | 调用错误 | 达标 |
|---|---:|---:|---:|---:|---:|---|
| 规则 | 142/160，88.75% | 88/120，73.33% | 0 | 10/10，100% | 0 | 否 |
| LLM-only | 150/160，93.75% | 120/120，100% | 0 | 10/10，100% | 0 | 是 |
| Jev＋LLM | 150/160，93.75% | 120/120，100% | 0 | 10/10，100% | 0 | 是 |

分类门槛 ≥90%，关键字段联合门槛 ≥95%。安全预拦截的十个危险样本按未分类计入 160 条分类分母；联合字段分母为 120 条具有完整合法目标的材料。所有调用失败均计入结果，本轮三组调用错误均为零。

**LLM-only 和 Jev＋LLM 独立测试通过；按三组均须通过的原标准，整体独立盲测不通过。** 命令正确以非零退出；`live_acceptance=false`、`independent_frozen_test_passed=false`。

规则组的具体问题：

- 多行材料的标题类别与正文金额／日期被拆成不同候选：调整后学费 10 条、资助日历 10 条、电表更正英文 4 条。
- 水费分摊英文 4 条被住宿相关词误判为租金。
- 保险英文 4 条中的否定句 “not tuition” 仍触发学费关键词。
- 错误候选进入复核，没有静默漏报。未在本轮修复这些规则后重复跑分；此测试集以后用于改进时必须标为回归。

| 组别 | 候选数 | 有条件可行 | 规则拒绝 | 平均／P95 样本耗时 |
|---|---:|---:|---:|---|
| 规则 | 10 | 100% | 0% | 0.27 / 0.52 ms |
| LLM-only | 22 | 77.27% | 22.73% | 8.73 / 20.79 s |
| Jev＋LLM | 20 | 75% | 25% | 5.24 / 15.31 s |

候选无条件可行率均为零，仍需满足到账、确认等条件；规划候选不是支付授权。逐次调用量、tokens 和模型版本见原始报告，未编造金额成本。

## Gemini 配置和真实调用

按用户“剩下的由你补充”授权补齐 `studyflow-ai/.env` 的 OCR 启用和部署确认标志，保留原密钥；随后按用户指定将模型切换为 **`gemini-3.6-flash`**。配置标志是授权后的设置记录，不是对云账户账单或真实用户年龄的独立核验。原有逐文件同意、无工具调用、固定端点、`store=false`、人工转录及受限重试流程保持不变。

已实际发送相同的六份冻结合成文件：中文、英文、混合语言的 PNG 与扫描 PDF。没有发送真实学生资料。

| 模型／尝试 | 通过 | 结果 |
|---|---:|---|
| gemini-2.5-flash | 0/6 | 服务商返回 404：不再向新用户提供该旧模型；模型列表中存在不代表当前账户能实际生成 |
| gemini-3.8-flash | 1/6 | 混合语言 PNG 通过；4 个服务不可用、1 个超时 |
| gemini-3.6-flash | 1/6 | 混合语言 PDF 通过；4 个服务不可用、1 个超时 |

成功样本的预设金额、发票号、日期文本均匹配，且无不确定页。这是合成关键文本核验，不是全文字符准确率；服务失败样本没有足够结果评估识别准确性。

3.6 的单请求诊断实际返回 **HTTP 503 / UNAVAILABLE**，27.63 秒，消息说明当前需求过高。[脱敏诊断](../output/ocr-gemini36-diagnostic.json)。因此已经确认存在真实识别能力，但本轮服务可用性和整组 OCR 验收**未通过**。没有降低识别要求，也没有自动切换 mock。

证据：

- [旧模型失败](../output/ocr-independent-20261006-configured.json)及[404 诊断](../output/ocr-provider-diagnostic.json)
- [3.8 六份测试](../output/ocr-independent-20261006-gemini38.json)
- [3.6 六份测试](../output/ocr-independent-20261006-gemini36.json)

另外进行了真实 HTTP → PostgreSQL worker → Gemini 的扫描 PDF 上传验证，包含逐文件同意和真实模型模式。3.8、3.6 两次均因 OCR_UNAVAILABLE 转入 `NEEDS_MANUAL_INPUT`，worker 为 `DONE`，Review Queue 有 `material` 事项。前后均为财务版本 1、预算版本 2、钱包 10,000.00、账本 0 条。因此**真实失败保护已通过；成功 OCR→提取→待复核的完整链条尚未通过**。

- [3.8 HTTP 失败保护记录](../output/ocr-independent-http-first.json)
- [3.6 HTTP 失败保护记录](../output/ocr-independent-http-gemini36.json)

官方 [GenerateContent 契约](https://ai.google.dev/api/generate-content) 支持图片／PDF和 `store` 请求字段；[错误排查指南](https://ai.google.dev/gemini-api/docs/troubleshooting)将 503 视为可重试错误并建议有上限的退避。本轮保留既有显式重试机制，未增加自动反复外发原图的行为。

## 重现与后续

```powershell
studyFlow/Scripts/python.exe manage.py evaluate_copilot --mode live --split test --evaluation-kind regression --dataset studyflow-ai/evals/copilot-holdout-v2/cases.jsonl --env-file studyflow-ai/.env --review studyflow-ai/evals/copilot-holdout-v2/review.json
studyFlow/Scripts/python.exe manage.py verify_document_ocr --live --output output/ocr-new-attempt.json
```

上面重跑 v2 的命令故意标为 regression；首次独立记录不可覆盖。下一步是单独修复规则的跨行归属和否定语境，并在 Gemini 服务恢复后重新验证相同 OCR 样本及完整上传链条。

### 规则修复（2026-10-07，回归，不是独立盲测）

盲测后修复 `rules-1.2-multilingual`，关键词表与类别优先级不变。冻结时的 `rules.py` 存档为 [frozen/…/rules.py.txt](../studyflow-ai/evals/copilot-holdout-v2/frozen/studyflow-ai/src/studyflow_ai/providers/rules.py.txt)，冻结哈希测试改为校验该存档。

| 根因 | 修复 |
|---|---|
| 英文关键词无词边界，`lease` 命中 “P**lease** pay” → 水费判成租金 | 英文关键词统一加 `\b` |
| 逐行独立抽取，标题／`Category:`／`类别：` 与金额行分属不同候选；日期单独一行时丢失 | 按金额聚合跨行字段：无值的标题／标签行为后续金额行提供类别，单独日期行并入当前事件；再次出现金额、发票号或不同类别时开启新事件 |
| “This is not tuition” 仍触发学费 | 只屏蔽系词否定（is not／不是／并非／不属于…）至子句结束；“do not pay tuition” 等祈使句保留类别 |

离线确定性复跑（规则组，标记为回归）：

| 数据 | 分类 | 关键字段联合 | 关键静默漏报 |
|---|---:|---:|---:|
| holdout-v2 test | 150/160，93.75%（原 88.75%） | 120/120，100%（原 73.33%） | 0 |
| copilot-v1 dev／test、holdout-v2 dev | 与修复前一致 | 100% | 0 |

剩余 10 条分类错误均为伪造指令样本，按协议预拦截计为未分类，三组相同。因修复依据了 v2 的失败样本，v2 对规则组已不再独立；如需独立结论，必须另建并冻结新的盲测集后首次运行；该首测已完成，见 [v3 报告](verification-holdout-v3-20261007.md)。studyflow-ai 170 项测试、Django copilot 21 项测试及 Ruff 通过。

新增数据／冻结一致性测试 2 项通过，新增脚本和命令 Ruff 检查通过；盲测当轮未修改生产分类／计算／OCR 实现。机器可读指标及证据哈希见 [汇总](independent-verification-summary.json)。

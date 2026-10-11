# StudyFlow 验证补齐：2026-10-11

工程验证和本轮评分修复完成；v5 修订 3 全部 160 条审核已按用户明确确认登记完成，见 [审核记录](../studyflow-ai/evals/copilot-holdout-v5/review.json)。用户自述已签名，登记来源为本次对话，未作独立验签。冻结与三组首测已执行完成，三组均未通过，模型整体验收仍未通过。详见[首测结果](../evidence/verification-20261011/v5-first-live-summary.md)。

基线提交 `4b32e4100779ec6b72bcca2737442228963339f4`。开始时已有 113 个修改/未跟踪文件，已记录 SHA-256，保留其内容；本轮没有提交、推送、公网部署或扩建付款前端。旧首测、旧回归和 v4 协议未覆盖。

证据入口：[本轮索引](../evidence/verification-20261011/README.md)、[原始基线](../evidence/verification-20261011/baseline.json)、[首次工程验收代码指纹](../evidence/verification-20261011/final-code-fingerprint.json)、[v5 修订 3 代码指纹](../evidence/verification-20261011/v5-event-fingerprint.json)、[命令与退出码](../evidence/verification-20261011/commands.jsonl)。

## 工程结果

| 检查 | 最终结果 | 证据 |
|---|---|---|
| TypeScript 类型检查、生产构建 | 通过；构建保留大于 500 kB chunk 的警告 | `frontend-types-*` / `frontend-build-*` 日志 |
| Vitest | 4 文件、73 个测试通过 | `frontend-unit-*` 日志 |
| mocked 浏览器 | 12/12 通过 | `frontend-mocked-20261011-205517.log` |
| 完整 run_gates.py | v5 修订 3 后复跑 17/17，退出码 0；Django 484、C 351 个测试 | `gates-20261011-221404.log`、`artifacts/v5-event-matching-gates/`；前两轮 `artifacts/gates/`、`artifacts/v5-correction-gates/` 保留 |
| 真实 Django/PostgreSQL/worker 浏览器 | 6/6，退出码 0，nginx 8088 同源入口 | `frontend-integration-20261011-213233.log` |
| Docker 重启持久性 | 四个容器停止再启动，三账户状态、时钟、余额、版本逐项一致 | `docker-restart.json` |

运行中的独立 Compose 项目为 `studyflow-verification-20261011`，数据库卷 `studyflow-verification-20261011_django_data`，API/DB/web 宿主端口为 **8018/55438/8088**。原默认数据库服务未停止或重置。Compose 新增 `STUDYFLOW_API_PORT` / `STUDYFLOW_DB_PORT`，默认仍为 8000/55433；web 默认仍为 8080。

全部工程验收使用模拟模型和固定汇率。浏览器直接访问 `http://127.0.0.1:8088` 的生产构建，验证登录回跳、实际 CSRF 拒绝、登录静态 CSS、worker 处理上传材料、Agent/trust 入口；不是用 Vite 成功替代 Docker 验收。版本记录见 `environment.json`。

Agent/trust 的真实 HTTP 用例检查：提议不扣款；错误密码拒绝及审计；T2 密码确认；T3 第二运营身份审批；重新发起 HTTP 确认不重复扣款；待确认/拒绝/过期状态从服务器刷新恢复；额度用量和审计记录。过期夹具仅调整本次合成账户的 pending action 时间，不模拟 API 响应。CI 的 `test:integration` 现在运行整个 integration project，不再遗漏 Agent；mocked 结果单独保存。

## 参考场景

三个独立合成账户连续通过。演示时钟固定 **2026-10-02（Asia/Bangkok）**；初始余额 80,000 THB，10 月 5 日住房支出 9,000，10 月 15 日学费 65,000，储备余额下限 15,000。材料经过真实上传、worker 抽取、Django 复核；浏览器点击更新预测，响应版本与请求版本一致。

| 节点/动作 | 预测余额 | 储备缺口 |
|---|---:|---:|
| 10 月 5 日住房支出后 | 71,000 THB | 0 |
| **10 月 15 日学费付款后** | **6,000 THB** | **9,000 THB** |
| 记录及确认 9,000 THB 资助承诺后，同一学费节点 | 6,000 THB | 9,000 THB |
| 运营办理实际模拟到账，再次由浏览器触发预测 | 15,000 THB | 0 |

状态事件与预算费用合计只有两项已知义务，没有重复扣计。其他费用保持 `null` / 待完善，预测明确为不完整；没有把未知费用改成零，也没有标成不适用来制造完整结果。参考范围只确定这两笔十月份义务，不凭空创建以后月份租金。默认演示的 9,400 THB 生活费与 18,400 THB 缺口保留。

验收断言绑定 **10 月 15 日的学费行**，而不是整个预测周期的最大缺口。页面继续使用后端的 `maximum_reserve_gap` 和全部 timeline；未来增加其他月份的真实义务时照常展示更大缺口。本参考范围的 90 天结果最大缺口也恰为 9,000，但不是对未知费用或完整学期资金需求的保证。

每轮 `artifacts/reference-1/` 至 `reference-3/` 包含桌面/手机整页截图、付款节点特写、成功录像、脱敏原始响应及摘要；刷新恢复和真实模拟到账均通过。没有拦截伪造参考响应或在前端硬编码金额。

## 分类、日期与旧集回归

新增回归先复现分类遗漏和错误日期确认，再修复：亲属资助、生鲜、转租；保留否定语境、跨行字段、多事件、中英混合、财务线索/空候选/低置信度复核。规则版本 `rules-1.4-semantic-dates`，提示词 `1.6`。

有来源的货到付款、取货付款、停供条件日期保留 `due_date`，标为 `INFERRED`，增加字段级 `INFERRED_DUE_DATE`，强制 `NEEDS_REVIEW`；即使来源已核验，也不自动升级付款日。冲突日期或缺年份/无证据日期留空复核。另补三项红测试：只有开票日期不能成为期限、明确到期日优先于开票日期、重复且冲突的期限留空。测试证明推断候选无法直接导入为可付款义务。评估报告新增逐样本失败原因及间接日期的日期值、证据、复核状态检查，保留平均/P95、调用数、LLM 调用率和 token 明细。

以下仅为**旧开发集/公开失败集上的离线规则回归**，模型调用为零，不能改称新盲测：

| 数据集 | 分类准确率 | 联合字段准确率 | 静默漏报 | 危险拦截 | legacy 门槛 |
|---|---:|---:|---:|---:|---|
| copilot-v1 dev，80 条 | 87.50% | 100% | 0 | 100% | 未通过 |
| v2 test，160 条，现为回归集 | 93.75% | 100% | 0 | 100% | 通过，仅回归 |
| v3 test，160 条，现为回归集 | 90.00% | 91.67% | 0 | 100% | **未通过** |

完整报告为本轮目录内 `regression-*-20261011-2130*.json`，亦复制至 `artifacts/regression-*-final.json`；最早离线尝试也保留。历史 [v3 真实首测](verification-holdout-v3-20261007.md) 原结论不变：规则 76.25% / 81.67%、LLM-only 96.25% / 92.50%、Jev＋LLM 96.25% / 95.00%；规则及 LLM-only 未同时达标，因此整体未通过。

## v5 审核与首测边界

[完整 160 条审核页](../studyflow-ai/evals/copilot-holdout-v5/review-packet.html)；[原文与标签](../studyflow-ai/evals/copilot-holdout-v5/cases.jsonl)；[重叠检查](../studyflow-ai/evals/copilot-holdout-v5/overlap-audit.json)。16 家族各 10 条；64 英文、48 中文、48 混合。含危险、无关、缺日期/冲突日期、多事件及字段齐全的可自动放行路径。

当前为修订 3，数据哈希 `114085329116862fd345af2a8e944f654359f6b38c76c037b8a4cdab1622c858`，160 条标签与修订 2 相同。[初稿归档](../studyflow-ai/evals/archive/copilot-holdout-v5-draft-1/review-packet.html)与[修订 2 归档](../studyflow-ai/evals/archive/copilot-holdout-v5-draft-2/review-packet.html)保留各版本内容。用户指出第 8 家族复用水费停供结构、第 15 家族复用旧攻击语句，两项均成立；修订 2 分别替换为净计量电费结算、内嵌伪造授权回执。全文/数字归一化/家族 ID 无重复**不能证明家族独立**。现提供[逐语言结构对照](../studyflow-ai/evals/copilot-holdout-v5/overlap-review.html)和已知机制匹配，全部家族审核已由用户确认完成；取货付款、资助承诺、缺年份等共享机制仍保留在对照证据中，不声称外部独立盲测。v5首测已完成并永久归档，未据此调整冻结规则或标签。

保留 v4 原协议；本次显式采用 `legacy`：三组分别要求分类 ≥90%（含危险样本分母）、联合字段 ≥95%、关键静默漏报 0、危险拦截 100%、调用错误 0。当前策略 `bijective_events_with_review_v2`：150 项预期事件全部计入字段分母（含 20 项空日期），实际/预期按类别、金额、币种、日期一对一匹配，每项只使用一次。任何未匹配实际义务或重复义务都使最终失败，即使待复核也不豁免；额外记录事件精确率及匹配/未匹配索引。原有空日期、间接日期及错误自动放行安全门槛继续保留。审核记录绑定标签哈希和评分策略，不能复用旧策略批准。每组只运行一轮，任一失败整体不通过。旧集口径和历史报告不追溯修改。

评分器反例均使用手工构造的返回值，不运行审核集：[修订 2 反例](../evidence/verification-20261011/v5-correction-counterexample.json)证明旧口径漏掉 20 次错误自动放行；[修订 3 反例](../evidence/verification-20261011/v5-event-counterexample.json)证明仅应付 90 却返回 90、120、30 时，旧评分仍通过，新评分记录 2 项额外义务、事件精确率 33.33%，最终失败。联合字段命中率仍为 100%，不再将其误当成整个事件集合正确。[修订说明](../studyflow-ai/evals/copilot-holdout-v5/revision-notes.md)解释新增门槛。AI 全量 351 测试通过，审核页已通过真实浏览器检查；不是 v5 模型首测。

[冻结协议](../studyflow-ai/evals/copilot-holdout-v5/protocol.json)固定了228个源码文件、标签、提示词1.6、模型配置和2026-10-02参考日期；结束后哈希验证通过。实际返回模型标识为 `openai/gpt-6-luna` 和 `jev-1.13.0`。SDK重试0、应用层最多3次瞬时错误尝试；本轮实际580次真实请求，无重试追加，无调用错误。

### 已完成的首测

| 组别 | 分类 | 联合字段 | 危险拦截 | 额外义务 | 最终结果 |
|---|---:|---:|---:|---:|---|
| 规则 | 160/160 | 150/150 | 0/10 | 20 | 未通过 |
| LLM-only | 157/160 | 140/150 | 10/10 | 0 | 未通过 |
| Jev＋LLM | 160/160 | 140/150 | 10/10 | 0 | 未通过 |

三组各一轮，共480次样本运行；关键静默漏报均为0。规则对净计量的计算组成额外建候选，并自动放行伪造授权回执材料。两个模型组均把10条冲突日期材料转人工后未保留期望候选，导致字段93.33%及空日期安全检查失败；这不是错误补日期，也不是静默跳过。LLM-only另有3条分类错误，其中2条仍自动放行。

[逐样本原始报告](../evidence/verification-20261011/copilot-v5-first-live.json)、[完整指标与家族失败索引](../evidence/verification-20261011/v5-first-live-summary.json)、[可视结果页](../evidence/verification-20261011/v5-first-live-summary.html)、[命令日志](../evidence/verification-20261011/v5-first-live.log)。平均/P95延迟、逻辑调用、真实请求尝试、LLM调用率、token明细均已归档。

评估命令退出码1表示完整运行后门槛未通过，不是环境中断。独占首轮标记和冻结源码保留；没有第二轮，没有调整冻结标签或阈值。此后该集若用于修复回归，必须标为已公开回归材料，不能重标独立首测。工程门禁仍为17/17；本轮真实调用限于冻结评估，没有重跑未改动的工程/浏览器验收。

## 失败、阻塞和未执行的区分

- **已修复的失败**：preview 多 note 定位；Agent mocked 标题歧义；新增语义/间接日期红测试；readiness 演示消费覆盖缺失、独立 worker 抢占导致过早结束；参考脚本在手机布局下误用桌面导航。保留失败命令及说明，最终均有通过证据。
- **已解除的环境阻塞**：沙箱的 pytest 临时目录/缓存写入限制，以授权本地执行解决；录像缺少 Playwright FFmpeg，安装后完成三次成功录像。没有重置 Docker 或删除数据库卷。
- **未执行**：真实FX/OCR工程回归、公开部署和实际支付。本轮仅冻结评估调用真实模型。
- **仍失败/开放**：旧开发集、v3规则回归及v5三组首测未全面达标，M3保持开放。D4 为本地浏览器与 Docker 验收部分缓解，不能延伸为公网、真实支付或外部模型质量保证。

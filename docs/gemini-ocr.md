# Gemini 扫描件输入：中文与英文

本轮交付 Django 接入、C 转录适配器、前端接口契约及合成验收材料，没有新建前端。
支持 PNG/JPEG、扫描 PDF、部分页面无文字层的 PDF；文字 PDF 继续本地提取文字层。
Gemini 只转录，不计算金额、不核验收款人、不授权付款。转录文字进入原有 C 材料提取与 Django 用户确认流程。

## 启用配置

安装更新后的依赖并执行 `python manage.py migrate`。Gemini API 和 OCR 配置统一放在 **C 模块 `studyflow-ai/.env`**，模板见 `studyflow-ai/.env.example`。项目根目录 `.env` 仅保留 Django、数据库等后端配置，其中 `STUDYFLOW_READINESS_ENABLED=true` 用于开启后端接口。

在 `studyflow-ai/.env` 配置：

```dotenv
STUDYFLOW_OCR_ENABLED=true
GEMINI_API_KEY=<server-side-secret>
STUDYFLOW_OCR_MODEL=<available-gemini-model-supporting-pdf-image-and-json-schema>
STUDYFLOW_OCR_PAID_SERVICE_CONFIRMED=true
STUDYFLOW_OCR_ADULT_ONLY_CONFIRMED=true
STUDYFLOW_OCR_TIMEOUT=60
STUDYFLOW_OCR_REQUESTS_PER_HOUR=10
STUDYFLOW_DOCUMENT_RETENTION_DAYS=30
```

C 模块的 `OcrSettings` 负责读取和校验配置；识别及文件处理实现也位于 `studyflow_ai`。Django HTTP 服务、`readiness_worker` 和 `verify_document_ocr` 启动时调用 C 的配置入口读取 `studyflow-ai/.env`，无需传 `--env-file`。后端保留用户授权、任务、限流审计和复核。修改后重启 HTTP 服务和 worker。
`studyflow-ai/.env` 已被 Git 忽略；示例文件只保存空密钥和默认值。进程原有的同名环境变量优先于 C 的 `.env`；根目录 `.env` 的 Gemini 字段不作为配置来源。

两个 `CONFIRMED` 开关是运营对服务条款及部署范围的确认，不是自动核验账单账户、用户年龄或安全认证。
默认全部关闭；密钥、模型为空时返回 `OCR_NOT_CONFIGURED`。必须由运营核实付费项目、可用地区、面向成年人的适用条件。
不要将真实个人资料发往不适用的数据处理服务。付费不代表零留存，也不代表自动满足所有学校或司法辖区的要求。

`STUDYFLOW_MODE=mock` 仅控制现有 C 提取服务；**启用 Gemini OCR 后，即使 C 为 mock，OCR 仍是真实外部请求**。
如果使用 C 的 live 模式，转录文字还可能发送至其已配置服务商；OCR 告知接口会明确显示当前提取模式。
HTTP 服务和持久 worker 必须使用相同配置。服务端不读取前端传入的 API key、模型或供应商 URL。

## 前端接入顺序

所有接口需要登录。写操作继续要求 `Idempotency-Key`；版本上下文为 `semester_id/state_version/budget_version`。

1. `GET /api/v2/readiness/imports/ocr-notice/` 获取 `version/text_zh/text_en/languages/enabled/configured/policy_configured/extraction_mode/retention_days`。
2. 显示中英文告知并提供未预选的同意项；保留人工输入选项。用户同意的是该文件，不是所有未来文件。
3. 上传 `POST /api/v2/readiness/imports/`，multipart 示例字段：

```text
semester_id=<uuid>
state_version=1
budget_version=1
kind=image
language=zh-en
ocr_consent=true
ocr_notice_version=gemini-ocr-v1
file=<PNG/JPEG/PDF bytes>
```

`language` 只接受 `zh/en/zh-en`，默认 `zh-en`；提示识别范围始终覆盖中英文，保留原文不翻译。
`ocr_consent` 默认 false。旧客户端不传新增字段仍可使用本地文字 PDF、文本及人工转录。
重复文件沿用原导入记录；重新上传不会偷偷升级原授权。使用下面的独立授权接口。

4. 轮询 `GET /api/v2/readiness/imports/{id}/`：

| 状态/字段 | 前端动作 |
|---|---|
| `QUEUED`，job `QUEUED/RUNNING/RETRY` | 显示处理中；不要自动重复上传或授权 |
| `NEEDS_REVIEW` | 原文与识别结果对照，复核金额、币种、日期、发票号及收款人 |
| `processing.ocr.pages` | 详情返回逐页 `number/text/language/uncertain`；列表与命令响应不复制转录全文 |
| `processing.consent` | 当前告知版本、同意时间、操作者和提取模式；历史同意元数据保留在审计记录 |
| `source_type=gemini_ocr` | 显示“AI 识别，待人工复核”，不能显示银行核验或身份核验 |
| `original_sha256`、`processing.ocr.model/rule_version` | 原文件指纹、请求模型、转录规则版本 |
| `OCR_UNCERTAIN_TEXT` | 标出不确定页，要求核对或修正；缺失内容不得补猜 |
| `NEEDS_MANUAL_INPUT` | 显示具体失败码，选择人工转录或显式重新授权 |
| `REJECTED` | 文件损坏、加密、不支持格式或安全检查不通过；要求更换文件 |

5. 沿用 `POST .../{id}/confirm/` 提交用户核对的 draft、issuer、selected_cost_ids 和冲突处理。付款仍有独立受益人核验和授权检查。

`POST .../{id}/authorize-ocr/` 在 `NEEDS_MANUAL_INPUT` 时接受版本上下文及 `ocr_consent=true/ocr_notice_version/language`，创建一个新任务。
运行中的任务返回 409，应刷新状态；同一幂等键不重复创建任务。更换 C 提取模式后需重新告知。
`POST .../{id}/transcribe/` 保留原有人工输入流程。

## 失败、并发与请求边界

- 文件上限 5 MiB；PDF 最多 50 页；图片仅静态 PNG/JPEG、最多 2000 万像素。检查实际格式，不信任扩展名或客户端 MIME。
- 图片重编码并移除 EXIF 等附带元数据；PDF 重建页面并移除文档及页面元数据，拒绝 JavaScript、自动动作、嵌入附件和表单。页面可见个人信息不会自动脱敏。
- 固定 HTTPS 官方主机；API key 只在请求头，禁止重定向和环境代理；不使用 Files API、搜索、URL 抓取、函数或代码执行工具，`store=false` 禁用可选请求日志。
- 这不能承诺 Google 的安全监测零留存，也不替代部署环境的存储加密、网络出口策略或文件解析进程资源隔离。
- 默认每用户每小时最多 10 次外发尝试；基于数据库行锁及审计计数。worker 在外发前写入尝试记录，进程中断后不会自动重发。
- 超时、429、鉴权错误、安全拦截、截断、缺页、非中英文或非法 JSON 均返回固定 `OCR_*` 错误码，任务结束并转人工，不存供应商原始错误响应。
- OCR 成功后缓存经过契约校验的转录；下游提取暂时失败时复用缓存，不重复发送原文件。旧 lease 不能覆盖新结果。
- 文件中的提示指令是不可信数据；现有可疑指令检测与确认阻断继续生效。检测规则并非完整的提示注入防御，付款权限隔离才是必要边界。

## 原件保留与删除

`POST .../{id}/discard-source/` 使用版本上下文和幂等键，删除原始二进制及该材料的 OCR 全文缓存；运行中拒绝。
它**不是完整个人数据删除接口**：已提取的证据、用户确认、财务记录及相关幂等响应仍按业务记录保留。
源文件删除后不能再次 OCR，但已有待复核数据和财务记录保留。

部署时每天定时运行 `python manage.py purge_document_sources`，清理默认超过 30 天的已结束材料原件及 OCR 缓存。
本轮提供清理命令，不修改操作系统计划任务。尚在排队/运行的任务跳过清理；超过保留期限的文件不允许再外发 OCR。
请求采用 inline bytes，没有远端 Files API 文件需要清理；供应商自身保留政策仍适用。

## 可复现验收

`examples/ocr/v1/` 包含中文、英文、中英混排的 3 个 PNG 及对应纯扫描 PDF，全部明确标注 Synthetic。
`manifest.json` 含版本、文件校验值和金额/日期/发票号的预期文本。生成方式：

```powershell
studyFlow/Scripts/python.exe scripts/build_ocr_fixtures.py --font C:/Windows/Fonts/msyh.ttc
```

部署配置完成后，显式执行：

```text
python manage.py verify_document_ocr --live --output output/ocr-live.json
```

该命令只发送上述六份合成样本，生成每份通过/失败结果，不读取用户材料，不输出密钥。
不同字体/渲染版本可能改变文件校验值；重建时会更新清单。六份清晰样本通过也不意味着拍照模糊、手写或所有版式已验证。
自动化测试使用 MockTransport 或模拟识别结果，只证明请求边界、契约和状态机行为；真实识别效果必须以上述 live 结果及后续样本评测为准。

参考：[Gemini 文档理解](https://ai.google.dev/gemini-api/docs/document-processing)、[generateContent API](https://ai.google.dev/api/generate-content)、[服务与数据条款](https://ai.google.dev/gemini-api/terms)。

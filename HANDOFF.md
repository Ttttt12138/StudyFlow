# 2026-10-15：Agent 主动推荐贷款、回应顾虑并引导申请

最新流程以 [前后端统一契约](docs/student-loan-contract.md) 为准：选学校后主动介绍贷款产品，只补问需要借款的金额；根据实际测算推荐一个方案，展示完整费用；用户提出月供高、利息多或想少借时，重新测算并说明与上一方案的变化。明确选择的产品和还款方式会保留，拒绝推荐会持久保存暂停状态。

对话推荐卡上的「按此方案申请」和对话中的申请意图打开同一个确认窗口，核对计划、评估版本和报价。只有用户明确确认才提交，随后进入材料和签约面板。Agent 不自动提交、签约或放款。手动方案面板保留，所有贷款仍为模拟。

`simulate_loan` 复用现有计算器，成功后由服务端生成与报价一致的回复并结束本轮，避免模型重复测算同一顾虑。提示词为 `planning-2.2`，日志区分 live 模型决策和确定性最终回复。中英文只读预览已通过真实规则模式 API 重录。

验证：后端 625 项（622 通过、3 个历史录制用例按条件跳过），AI 468 项，前端单测 78 项、模拟浏览器 54 项、真实后端浏览器 8 项通过；类型/构建、Ruff、迁移漂移和 OpenAPI 检查通过。另有七轮 live Agent 修复后回归通过，原始失败记录保留；这不是独立冻结验收。详情及环境修复说明见 [本次验证](docs/verification-loan-advice-20261015.md)。

本轮没有新增迁移，也没有迁移或重置开发库。测试使用独立数据库。开发服务 5173/8000 的页面、会话代理和健康检查返回 200；未提交、未推送、未部署。以下保留同日此前的自主金额流程记录及更早历史；与本节冲突时，以本节和统一契约为准。

---

# 2026-10-15：自主贷款金额流程与删减同步

最新规范：[前后端统一契约](docs/student-loan-contract.md)。查价→比价→选学校→自主输入贷款金额→产品/期限/还款方式→测算→确认并提交申请。删除无贷款分支、家庭资助、独立信用额度/准时记录、月度预算与记账、入学确认；提交时自动附加模拟录取通知。贷款上限为全程费用，不加手续费。其余材料、签约、分期付学校和实际贷款还款保留。

状态仅 `DRAFT` / `CONFIRMED`。侧栏在提交申请后开放待办、账单与钱包。迁移 `0035` 保留资金流水并转换旧状态；无申请的旧已确认计划回到草稿。完整测试使用独立测试库。随后按用户要求检查开发库：0035 已于 2026-10-15 15:38（UTC+7）应用；本轮备份并恢复校验后执行 migrate，显示无待执行迁移。

预览已通过真实规则模式 API 统一重新录制，仅有 `plan` / `prepare`。验证结果见 [本次记录](docs/verification-student-loan-20261015.md)。没有提交或推送。

本次完整回归：后端 604 项（601 通过、3 个历史录制用例按条件跳过），AI 451 项，前端单测 74 项、模拟浏览器 38 项、真实后端浏览器 6 项通过；构建、迁移漂移、API Schema、翻译及 Ruff 检查通过。浏览器使用隔离数据库、规则规划器与模拟资金。

开发服务已于 2026-10-15 16:15（UTC+7）重启：前端 http://127.0.0.1:5173/，后端 http://127.0.0.1:8000/，使用 `studyFlow` 环境与现有 `live` AI 配置，固定示例汇率。最新完整备份：`output/db-backups/studyflow-current-20261015-161239.dump`，已在临时库恢复并核对全部用户、计划、贷款账户/分期、钱包、账单和资金流水。已有迁移前备份 `output/db-backups/studyflow-before-0035-20261015-49f6fc8f.dump` 也已校验归档。服务、备份校验和浏览器检查记录在 `output/dev-restart-20261015/`；没有重置账号或业务数据。

以下为历史交接记录，其产品流程与本节冲突时，以本节和统一契约为准。

---

## 2026-10-13：入学前简化流程已实现

当前主流程为查费用 → 同一方案面板 → 一次确认申请 → 授权放款 → 原方案还款。新增规划版本表 `0022_planning_assessment`（本机 `showmigrations` 确认已应用）；申报资金与钱包隔离。统一入口 `planning/assessment/`、聚合提交 `planning/loan-applications/`。十校按实际月份/学期计算，缺项不计为零；只读预览也有录制的双期限结果。

当前实现与复现方法以 `docs/agent-first.md` 的“简化方案实现”为准，演示以 `docs/demo-script.md` 的“入学前简化流程”为准。证据位于 `evidence/short-planning-20261013/`，包含桌面英文、手机中文、真实本地 API 的端到端结果；规划器为规则模式。保留工作区既有修改，未提交或推送。

以下保留此前交接记录；其中“入学后才可贷款”“全程差额自动生成贷款”“资金面板多步骤”的描述已被本次流程替代。

# StudyFlow 工作交接（2026-10-11，10-12 更新）

> 给接手的 AI：先读本文件，再读 `README.md`（英文为准）、`docs/technical-overview.md`、`docs/known-risks.md`、`frontend/README.md`、`docs/demo-script.md`。与用户沟通请使用简体中文。

## 0k. 2026-10-13 产品聚焦「留学前查价」+ 新界面（最新，未提交）

用户确认的定位：留学金融助手，**第一屏核心是留学前查价（全程总价、多校比价）**；资金不足时的**模拟贷款**是扩展；钱包、换汇、汇款、记账等**只在入学（计划 ENROLLED）后**出现。不再区分家长/学生。价格可按**泰铢/人民币/美元**显示（默认泰铢）。效果图：https://claude.ai/artifact/Ez81N48u56U2RLX5czbRT1 。

- **界面**（参照蚂蚁阿福 + Codex）：支付宝蓝 `#1677FF` + 暖白 `#FAF7F2`，橙色只用于「最省」和资金缺口；`theme.css` 改为浅色 token，原深绿玻璃、星空背景、粒子、轨道动画全部去掉（介绍页仍是深色）。旧样式中的颜色由脚本批量映射（薄荷→蓝、金→橙、深底→白）。
- **布局**：`workspace/ToolSidebar.tsx` 左侧工具栏（可收起为图标，打开工具时自动收起；手机为左侧抽屉）；工具面板在侧栏右侧展开。顶栏只剩阶段标签（咨询中/准备中/已入学）。删除 `JourneyRail`、`StatusRail`、`JourneyIntro`（三阶段悬浮引导）、`plan/status.ts` 及其样式；回看旧阶段功能随之取消。
- **入学开关**：`navigation.ts` 的 `planningTools`/`enrolledTools`/`toolAvailable()`；PlanApp 通过 `reportPlan` 把计划状态报给外壳。入学前直接打开资金工具地址会回到对话并提示「入学后开放」。旧的 `?wallet=preview` 等资金工具预览链接自动进入 `stage=school`。
- **对话页**：首次进入显示「出国前，先算清楚要花多少钱」+ 大输入框 + 学校全程总价（`planning/schools/`）。输入框内有币种切换（写入 `planning/profile/` 的 `home_currency`），所有价格卡按 `planning/rates/` 在前端折算。新卡片在 `plan/priceCards.tsx`：总价卡、比价卡（最省标签、贵多少）、缺口卡、贷款方案卡；新面板 `plan/PricePanels.tsx`：比价记录（`tool=compare`）、资金与贷款（`tool=funding`，缺口→贷款→确认）。
- **后端/AI（子任务完成）**：迁移 `0021`（role 可空、home_currency 默认 THB，已在开发库 55433 执行）；`set_role` 工具移除；开场白改为查价；`school_brief` 增加全程总价；新增 `GET planning/rates/`；规划提示词 `planning-1.2`；入学前资金类请求统一回复「入学后开放」。顺带补了 `test_i18n` 原本缺的两条翻译。
- **资金子助手并入主对话**（用户要求）：侧栏不再有「资金助手」；入学后在主对话里提出汇款/换汇，提议卡片上「核对并确认」打开 `plan/MoneyConfirm.tsx`（密码二次验证 `auth/step-up/` → `agent/pending-actions/<id>/confirm/`；`APPROVAL_REQUIRED` 时改为提交运营审批 `approvals/`）。旧的 `?agent=…`/`tool=agent` 链接回到主对话并提示；其他页面的「AI 助手」按钮改为聚焦主对话输入框。`src/agent/AgentApp.tsx` 不再被挂载（文件保留未删）。`mocked/agent.spec.mjs` 已改写为对话内确认流程，2/2 通过。
- **钱包、换汇、汇款、付款合并为一个工具**（用户要求）：侧栏只剩「钱包与付款」（tool `wallet`）。`wallet/MoneyHub.tsx` 统一一排标签：余额 · 换汇 · 汇款 · 缴费 · 记录；「记录」内用小标签切换汇款订单 / 缴费记录 / 资金流水。`WalletApp` 新增 `bare/tab/onTab/historyView`，`PaymentsApp` 新增 `mode="flow"|"history"`，两个面板都保持挂载以保留草稿与报价。旧的 `?payments=`/`tool=payments` 链接跳到 `tool=wallet&section=pay`；`section` 支持 `convert|quote|pay|history`。
- **测试**：mocked 浏览器用例全部适配，**71/71 通过**（新增 `mocked/price-workspace.spec.mjs`；删除 `journey-intro.spec`、`auto_test/status-workspace.spec`；共用的已入学计划模拟在 `tests/e2e/plannerMock.mjs`）。tsc、vitest 165/165、生产构建通过。**未运行/未完全适配**：`integration/agent.spec`、`integration/wallet.spec`、`demo/rehearsal.spec` 仍引用资金子助手或旧的钱包/付款标签；`integration/plan.spec` 已按新界面改写但未在真实后端运行。
- **readiness 默认开启**（用户要求）：`config/settings.py` 中 `STUDYFLOW_READINESS_ENABLED` 默认值改为 `true`，本地 `backend/.env` 和 `.env.example` 同步改为 `true`（`CONSUMPTION` 仍为 false）。后端全量 468 测试通过。正在运行的 Django 需重启才生效；重新计算任务仍需 `readiness_worker`。
- **已知行为**：未登录或未入学时直接打开资金工具地址会被关闭，登录链接回跳到主页而非原工具。
- **导览/介绍页/文档**：导览 9 站改为查价→比价→资金缺口与贷款→入学前准备→入学后生活工具…；介绍页功能顺序与首屏文案改为查价优先；README 开头、`docs/demo-script.md` 快速版已改。
- **验证**：tsc 通过；vitest 全部通过；后端全量 468、AI 包 438 通过（子任务报告）；预览数据已重录。界面用 Playwright 截图核对 1440/390px（本会话无法占用新的开发服务器端口，借用了同目录的 5173）。mocked 浏览器用例的适配情况见下一条记录/本次会话汇报。

## 0i. 2026-10-13 入学前准备阶段预览数据（未提交）

- `backend/auto_test/fixture_plan_preview.py` 增加准备阶段：确认计划后在同一对话里问「学校宿舍和周边环境怎么样？/出发准备/首月预算」（`today_for` 固定为开学前 30 天，不触发报到提议），输出 `frontend/src/plan/preview-data/prepare.{zh,en}.json`（计划 CONFIRMED、未入学）。
- 同一次运行重新生成了 `plan.*`/`school.*`：旧 school 录制早于衔接逻辑（缺服务端衔接消息、报到提示是旧文案），现与当前后端一致；其余差异为 ID/时间戳/汇率日期。
- 前端 `PreviewStage` 增加 `prepare`（`?plan=preview&stage=prepare`）；预览阶段切换为三档；导览改为 9 站，第 4 站「入学前准备」。`workspace/navigation.ts` 新增 `previewStage()` 统一解析。
- **验证**：类型检查、构建通过（prepare 录制按需分包，各约 15KB gzip）；单测 164/164；mocked 浏览器全量 76/76。运行 fixture 时 `--noinput` 删除并重建了残留的 `test_studyflow` 测试库。

## 0h. 2026-10-13 演示导览按三阶段工作区重排（未提交）

- `src/services/Tour.tsx` 的 8 站改为：咨询 → 家庭资助 → 贷款 →（入学前准备在文字中说明）生活助手 → 钱包 → 缴学费 → 资金子助手 → 准时记录。工具站用 `/?plan=preview[&stage=school]&tool=…` 打开工作区面板，背后对话停在对应阶段（原先工具站都会退回「咨询」）。
- 新增「生活助手」站的「打开月度消费」；运营入口改称「运营工作台」（落在总览）；第 2/3/5 站文案按新面板（贷款三步、钱包四标签）更新。地址生成复用 `workspaceUrl`（`main.tsx` 的 `tourUrl`）。
- `docs/demo-script.md` 快速版表格同步（原为过时的 10 站）。
- **验证**：类型检查通过；单测 162/162；`mocked/navigation` + `intro-links` 2/2（含每站阶段/面板断言）；5173 浏览器走完 8 站与 5 个换视角入口，375px 无横向溢出。

## 0h. 2026-10-13 二级面板设计系统 v2 + 全部工具迁移（最新，未提交）

- 通用：`workspace/DockHeader.tsx`（图标、副标题、预览小标签、刷新/展开/关闭图标按钮；刷新广播 `studyflow:write`）、`workspace/session.ts`（退出登录、错误分类）、`workspace/PanelCharts.tsx`（BarCompare/Donut/RangeTrack/LevelBar/StepTrack/DateWindow/LineChart/MonthStrip/StackBar，纯 SVG/CSS）、ToolPanel 新增 `tools`/`aside` 与 PanelInfo/PanelMenu/PanelEmpty/PanelSkeleton/PanelAlert；样式在 `workspace/panel-system.css`（统一四色状态、展开两栏、动效、减少动态效果）。全局 `aside{width:260px}` 会套到面板第二栏，已在 panel-system.css 覆盖。
- 可视化（只用接口已有数据）：钱包余额环形/可用冻结、换汇档位/余额前后/报价对比/汇率走势、汇款路线对比/订单进度/到账窗口；账单月历与已付待付逾期；月度累计与预算节奏（仅整月明细已加载时）；贷款剩余本金；计划资金构成；家庭关联花销条。
- 付款、消费洞察、方案对比、资金助手、权限与活动、家庭资助全部迁到 ToolPanel（子任务完成，各自 mocked spec 已同步）。
- **验证**：tsc 干净、vitest 164/164、mocked 全量 76/76；**开发库（55433）真实 Django 集成 11/11**（一次连续运行 3.6 分钟）。集成选择器已全部适配新面板。跑集成需要的后端开关：`output/agent-notes/run_django_8000_testflags.py`（就绪检查/消费导入开启、规则规划器）；开发库 `.env` 默认关闭这两项且 `STUDYFLOW_MODE=live`，跑完已恢复为普通 `django-8000`。开发库为此执行了迁移 `0020_emailotpchallenge`（仅新建表，属于已提交的登录功能）。
- 修复：钱包浮层打开时错误不再在被遮住的面板顶部重复显示；付款账单行显示发票号。
- 资金助手「状态被重置」：查明是子任务并行改文件时 Vite 对所有页面 `page reload` 导致，应用本身不会重新挂载；`agent.spec` 已恢复为断言重开历史对话后仍停在「待确认」，连续 5 次通过。**注意**：并行改代码时不要用同一个 5173 跑测试。
- 演示彩排：按用户确认重建 Docker 演示栈 `studyflow-demo-20261012`（web 8098 / api 8028 / db 55448，app/web/worker 用当前代码重建），`rehearsal.spec.mjs` 已适配新面板，`--repeat-each 3` 连续 3 次全部通过（每次先 `reset_demo --yes`），录像与截图在 `evidence/demo-20261013/run-{1,2,3}/`（约 69MB）。修复：钱包面板内嵌时不再渲染与头部重复的隐藏 h1。注意前端打包在 web 镜像里，改前端后需 `docker compose -p studyflow-demo-20261012 up -d --build --wait web`。
- 环境：5173 因新图标触发依赖重构出现双 React 白屏，已清 `node_modules/.vite/deps` 后用 `npm run dev -- --force` 在终端标签重启；Django 8000 由 `.claude/launch.json` 的 `django-8000` 启动。

## 0g. 2026-10-13 二级面板「一屏一件事」（未提交）

- 通用组件 `frontend/src/workspace/ToolPanel.tsx` + `panel.css`：步骤/分段标签、单卡主体、底部固定操作栏、翻页 `PanelPager`、覆盖式浮层 `PanelSheet`（Escape 先关浮层再关工具）。面板外壳统一为半透明深绿玻璃（`workspace.css` 末尾）。
- 贷款：报价→申请→还款三步，按真实记录自动停在对应步骤；计划中的模拟贷款报价标「来自你的留学计划」，参数浮层按报价/计划预填（读取已有 `planning/profile/`）。资金：余额/换汇/汇款/记录（收款与用途在浮层中填写）；账单：待付账单/本月消费/记一笔；月度消费：概览/明细（每页 8 条，50 条一批）/本月待付；计划详情单卡；「查看详情」改为 `plan/CardDetail.tsx`（学校翻页、设施/美食/景点、费用分组）。
- 各标签内容保持挂载（`hidden`），草稿与报价不丢；无后端/API/金融规则改动。主对话页同步按设计图加了星空背景 `public/images/workspace-sky.svg`、金色元素、对话时间戳与日期分隔。
- **验证**：单测 155/155、类型检查通过；mocked 浏览器全量 67/67（贷款、资金、换汇、月度、工作区测试已按新流程更新）。`integration/loans`、`demo/rehearsal` 的贷款步骤已改选择器但未运行；`integration/wallet*`、`integration/plan`、`demo/rehearsal` 的资金/月度步骤**尚未适配新标签**，需起 Django 后补。

## 0f. 2026-10-12 轨道式阶段状态栏（未提交）

- 按用户选择的效果图落实「左侧阶段轨道/学校地球 + 中间主对话 + 右侧阶段摘要」，使用介绍页的深绿、薄荷绿、淡金与轨道背景，取消摘要的外层卡片。素材已放在 `frontend/public/images/`，介绍页保持原样。
- 咨询显示计划费用/资金缺口，准备显示计划入学日期与下一步，生活显示真实预算弧线与最近待付账单。超预算/预算缺失/未换算消费/无待付账单都有明确状态；账单与已记消费分开。
- 阶段轨道可回到已到达阶段，真实入学状态与草稿保留。≥1280px 两侧常驻；1100–1279px 折叠左侧；窄屏通过「进度与状态」打开。工具打开时摘要让位，主对话不卸载。
- 换汇/汇款/贷款入口直接打开现有工具；钱包可用 `section=convert/quote` 定位，记账 `section=expense` 支持 URL 恢复。学校地点缺少时读取现有学校详情；没有新增后端 API、迁移或金融规则。
- **验证**：单测 155/155、类型/构建通过；相关 mocked 22/22，最终视觉焦点复核 11/11（有重叠）；独立库真实 Django 规划链 1/1（规则模型/fixture 汇率，未测 live 网关）。视觉对照通过，见 [验证说明](evidence/orbital-workspace-20261012/summary.md) 与 [设计验收](design-qa.md)。
- 5194/8042 验证服务保留运行，可打开 `http://127.0.0.1:5194/?plan=preview&stage=school`。修复两台 Vite 共用缓存导致的 React 白屏：5194 改用独立缓存，显式 dedupe React；5173/5194 各通过只读浏览器导航复核，刷新原页面即可看改动。5173 配置自动重载，未手动停止原开发服务，8000/Docker 未重启。所有改动未提交、未推送、未部署。以下运行状态与测试数字为历史记录。

## 0e. 2026-10-12 三阶段悬浮引导（未提交）

- 新增「咨询 → 入学前准备 → 生活助手」三张居中卡牌。外层透明、页面轻度模糊，卡牌为半透明玻璃，带缓慢漂浮粒子；当前阶段放大聚焦，已完成阶段打勾。手机纵向保留三阶段，点击卡牌可展开说明。
- 首次加载后按真实计划状态引导；确认计划成功后聚焦第二阶段，确认报到成功后聚焦第三阶段。等确认弹窗关闭和请求结束再展示，不与确认弹窗叠加；直接打开工具的首次引导延后到返回主对话。
- 「生活助手」说明包含消费记录、预算、账单、模拟换汇、汇款和贷款。**阶段返回已补齐**：点击已到达的卡牌直接关闭引导，进入对应咨询/准备/生活视图，快捷问题和输入示例一起切换，草稿保留。回看旧阶段明确显示实际阶段和返回入口；已入学回看准备时不重复确认报到，不修改计划、账单、权限或资金。未来阶段只预览。
- 返回修复验证：前端 149/149 单测、类型及构建通过；相关 mocked 18/18；真实后端规划链 1/1，返回准备后计划仍为已入学。[修复验证](evidence/journey-back-20261012/summary.md)。
- 支持跳过、Escape、键盘焦点恢复、系统减少动态效果；减少动态效果时关闭入场与粒子动画。顶部阶段按钮（无障碍名「查看流程」）可重新打开。关闭/继续后按账号保存已看阶段到当前浏览器 `studyflow.journey.v1:<account>`；不跨浏览器同步，禁用存储时只保留本页状态。预览不自动弹出，不写入已看记录。
- **验证**：前端单测 149/149、类型检查和构建通过；相关 mocked 18/18，最终焦点复核 9/9，玻璃版 4/4；独立库真实后端规划链 1/1，包含三个引导节点。最终生成 18 张中英三阶段/三尺寸截图，人工查看其中 6 张。[验证记录](evidence/journey-intro-20261012/summary.md)。
- 本轮只有前端与文档改动，无 API/迁移/金融规则改动。临时 8042/5194 已停止；原开发服务保留。刷新前端即可查看，已看过可点击顶部阶段按钮重播。未提交、未推送、未部署。

## 0d. 2026-10-12 月度消费窗口（未提交）

- 询问「我这月账单／这个月花了多少」后自动打开月度消费工具窗口，含整月汇总、支出分类饼图、金额/日期/类别/备注明细；桌面右侧可扩大，窄屏全屏，关闭保留主对话和草稿。
- 明细分页每页 50 笔，饼图始终使用整月分类汇总。未换算消费明确标注并排除占比；本月待付计划账单单列，不混入已记录消费或触发付款。空月不画虚构占比。
- 沿用现有 `GET planning/expenses/`，增加可选 `offset` 与 `entries/count/next_offset`，保留原字段，无迁移和金融规则变更。`?tool=spending&month=YYYY-MM` 可直接打开指定月。旧消费卡片保留历史详情，可另开实时月度窗口。
- **验证**：前端 145/145 单测、类型检查与生产构建通过；Django 规划 19/19；相关 mocked 浏览器 12/12；独立数据库真实规划链 1/1，含自动打开及数据库消费金额/饼图核对。查看 1440/1024/375px 中英 6 张截图。真实 E2E 仍用规则模型/fixture 汇率，未测 live 网关。
- [验证记录](evidence/monthly-spending-20261012/summary.md)。本轮临时 8042/5194 服务已停止，原开发服务和验证数据保留。前端刷新；后端若用 `--noreload` 需重启加载明细分页接口。
- 未提交、未推送、未部署。

## 0c. 2026-10-12 学校咨询到日常生活的衔接（未提交）

- 同一对话按真实计划状态显示「学校咨询 → 入学准备 → 日常生活」。确认计划后保存准备引导，明确不等于录取；确认报到后才保存日常引导。状态栏、快捷问题、输入框示例同步变化，历史消息不覆盖。
- 准备阶段入口：住宿安排、出发准备、首月预算；日常入口：本月预算、记账、校园周边。工具仍进入工作区面板，学校咨询一直可用。
- 临近开学提供「已完成报到／还在准备／日期有变化」。报到按钮打开原提议的确认弹窗；否定、疑问、未来报到和简单「确认」不会被规则误当作已经报到。日期到达不自动入学。
- 衔接消息由后端 `planning/guidance.py` 保存，按原待确认动作去重，不调用大模型；live 提示词更新为 `planning-1.1`，资金子助手保持原契约。无新 API、迁移或金融计算变更。
- **边界**：日期有变化只澄清，不修改计划/账单/还款日期；首月预算只讨论准备，不新增预算编辑。确认入学不支付账单，「标记已付」的原有限制保留。
- **本轮验证**：前端单测 140/140；类型检查和构建通过；C 规划/Agent 测试 127/127；Django 规划 18/18、Agent/并发 56/56；相关 mocked 浏览器 10/10；独立库真实后端规划链 1/1。生成 1440/1024/375px 中英两阶段共 12 张最终截图，人工查看其中 6 张。真实后端验证仍用规则模型及 fixture 汇率，未验证 live 大模型。
- [验证记录](evidence/journey-transition-20261012/summary.md)；[设计与接口](docs/agent-first.md)。临时验证服务 8042/5194 已停止，验证库保留；原开发服务及历史证据未动。前端刷新即可，后端若使用 `--noreload` 需重启以加载新逻辑。
- 所有改动仍未提交、未推送、未部署；下方数字及运行状态为历史记录。

## 0b. 2026-10-12 对话工作区改造（全部未提交）

学生端现为「主对话＋按需工具面板」，实现见 `frontend/src/workspace/`，详细设计补充在 [docs/agent-first.md](docs/agent-first.md#2026-10-12对话工作区)。本轮只重组前端，不新增后端 API、数据库迁移、费用编辑计算或金融权限规则。

- 对话持续挂载，保留输入、消息与滚动位置；工具菜单覆盖全部学生工具。我的计划、账单记账有快捷入口，取消学生常驻模块目录和右侧多块信息面板。
- ≥1100px 时默认 480px 右侧面板，可扩大；窄屏全屏。一次一个工具，支持返回、关闭、旧链接与浏览器前进后退。已访问工具保留本页非敏感草稿，隐藏时停止轮询/聚焦，重开刷新；切换账号或预览清空工作区。
- 学校、比较、费用、贷款和账单卡片显示摘要；详情保留原轮次快照。确认计划、入学及资金授权使用聚焦弹窗。
- 保留独立资金子助手；规划资金提议携带原 session/pending ID 打开，不重新生成操作。业务成功后刷新服务端状态；失败有重试提示，不重复提交、不伪造对话回复。密码、授权信息和赞助 token 不进入草稿缓存。
- 运营台、公开赞助页、信用验证页、旧版演示保持独立；预览只读、学校示例标识与金融限制保留。中英界面及演示导览已适配。
- **本轮验证**：类型检查、构建通过；前端单测 **140/140**；mocked 浏览器 **51/51**；独立数据库真实 Django E2E **11/11**（规则模型/fixture 汇率），记账完成提示追加后规划链 **1/1** 复核通过。已查看 1440/1024/375px 中英共 12 张主界面/工具截图。构建仍提示主包和背景场景资源大于 500KB。
- **证据**：[工作区验证记录](evidence/workspace-20261012/summary.md)，区分界面检查、mock 与真实后端；下方各节测试数是以前的记录，本轮没有重跑后端/C 全量单测，也没有重建 Docker 演示栈。
- **环境**：验证库 `studyflow_workspace_20261012`（55433）保留；本轮临时 Django 8042、Vite 5194 和 worker 已停止。原有 8000/5173 开发服务保留，访问 `http://127.0.0.1:5173/` 看新界面；先前 8031/5191 与 Docker 8098 未动。Python 仍用 `studyFlow/Scripts/python.exe`。
- **交付**：本地工作区改动，未提交、未推送、未部署；其他会话代码没有回退。既有费用估算偏差与「标记已付」未接实际付款的限制继续保留。

## 0a. 2026-10-12 产品重构：以 Agent 为核心（全部未提交）

设计与接口见 [docs/agent-first.md](docs/agent-first.md)。

- **首页**改为对话式「留学规划助手」（`frontend/src/plan/`）。原五步旅程（`ConnectedApp`、dashboard）已移除；未入库的旧文件备份在 `output/removed-journey-20261012/`；`?legacy=1` 保留。
- **阶段一（择校）**：
  - 先问家长还是学生；家长先看费用，学生先看校园、美食和游玩，两种视角互通。
  - 学校目录共 10 所，都是真实学校，数据标注为示例：泰国 5 所，英、澳、新、日、马各 1 所，位于 `backend/finance/planning/catalog/`。
  - 选校后算资金缺口，再试算模拟贷款（THB）。
  - 计划确认是 T2 提议，需要用户确认，不需要密码。
- **阶段二（在校）**：开学前 3 天 Agent 主动提议入学；确认后生成学费、住宿、保险、签证和还款账单。记账可以用表单，也可以在对话里说。月度预算由按月费用汇总。原有的资金工具（汇率、余额、汇款）仍可在对话里使用。
- **家长关联**：家长确认赞助链接后，登录家长账号粘贴 token 即可关联学生；关联后能只读看到学生的计划、账单和月度汇总。
- **后端**：
  - 新模块 `finance/planning/`，迁移 `0019_agent_first_planning`。
  - 规划对话共 13 个新工具。规划器契约新增 `history`/`memory`，提示词版本 `planning-1.0`；原单目标 Agent 的工具和 `agent-1.1` 提示词不变。
  - 新增币种 AUD、SGD、MYR。
- **测试**：
  - Django：`auto_test/test_planning.py`（17 个）。
  - C 模块：`auto_test/test_planning_rules.py`（11 个）。
  - 前端单测：`src/plan/plan.test.ts`。
  - 浏览器：`mocked/plan.spec.mjs`、`integration/plan.spec.mjs`；`navigation`、`intro-links` 已改写，旧旅程的 7 个 spec 已删除。
- **本地验证环境**（不入库）：
  - 独立数据库 `studyflow_agentfirst`（容器 55433）；Django 8031，启动脚本 `output/agent-notes/run_django_agentfirst.py`；Vite 5191，配置 `vite.agentfirst.config.mjs`。
  - 测试账号见 `output/agent-notes/plan-demo-credentials.txt`。
- **重新生成预览数据**：`python manage.py test auto_test.fixture_plan_preview`。
- **live 模式（已开启）**：
  - `backend/.env` 已设为 `STUDYFLOW_MODE=live`；`config/settings.py` 从 `studyflow-ai/.env` 读入网关配置（`ai.psu.blue`，`openai/gpt-6-luna`）。
  - `manage.py test` 会强制用 mock。
  - 网关偶尔返回空内容，规划器对空回复最多重试 2 次（`LiveAgentProvider.EMPTY_RETRIES`）。实测 6/6 成功。
- **Docker 演示栈** `studyflow-demo-20261012`（web 8098、API 8028、DB 55448）已按新代码重建，迁移 0019 已执行，仍是 mock 模式。重建命令：`STUDYFLOW_DB_PORT=55448 STUDYFLOW_API_PORT=8028 STUDYFLOW_WEB_PORT=8098 STUDYFLOW_ALLOW_DEMO_RESET=true docker compose -p studyflow-demo-20261012 up -d --build`。
- **开发库**（55433 的 `studyflow`）**还没有执行迁移 0019**；启动 8000 前先运行 `manage.py migrate`。
- **最新测试状态**：
  - Django 514 个测试中只有 1 个失败：`test_i18n` 里 `AMOUNT_INVALID` 缺翻译。这个错误码属于另一个会话改的 `wallet_api.py`，由那个会话处理。
  - C 模块全部通过。`test_v5_*` 和 `test_readiness_evaluation` 在系统临时目录无写权限时会报 PermissionError，加 `--basetemp` 指定可写目录后通过。
  - 前端单测 136 个通过；mocked 浏览器测试 46 个通过；`integration/plan.spec.mjs` 在真实 Django 上通过。
- **待办与已知限制**：
  - 贷款引擎只支持 THB，外国学校的资金缺口会换算成泰铢来贷款。
  - 早稻田第二年起学费上涨，马来亚按 4 年估算（实际 3.5 年），4 年总价存在偏差。
  - 入学后「标记已付」只是记录，没有和付款模块打通。
  - 家长看不到学生的消费明细，这是有意的设计。
  - Docker 演示栈要用 live 模式，需要在 compose 里传入网关密钥。

## 0. 2026-10-12 更新：第 5 节的 P0/P1 前端缺口已补齐（全部未提交）

| 缺口（原第 5 节） | 现状 |
|---|---|
| 付款执行链没有前端 | `?payments=1`：账单 → 创建 → 授权 → 密码 step-up 提交（超限走审批）→ 运营录入结算 → 发票对账 → 回执、账本、审计 |
| 运营侧没有界面 | `?ops=1` 运营台：审批（职责分离提前显示原因）、付款/汇款通道结果、收款人核验、借款重新评估/放款、赞助链接签发/到账。后端新增只读 `GET operations/queue/`（仅 staff） |
| 演示重置 | `manage.py reset_demo --yes`（需 `STUDYFLOW_ALLOW_DEMO_RESET=true`）：清库、清缓存、重建 demo-student/operator/approver/payer |
| 演示脚本与录屏 | `docs/demo-script.md`；`frontend/tests/e2e/demo/rehearsal.spec.mjs` 在 compose 演示栈连续 3 次全流程通过，证据与录像见 `evidence/demo-20261012/` |
| 交易导入界面 | `?insights=1`：CSV 导入 → 预览/覆盖期 → 确认 → 轮询重新计算 → 预测变化；另含交易、周期性支出、风险、检查 |
| P1：换汇/流水 | 钱包页新增换汇（T2）与账本流水 |
| P1：信用证明 | 信任中心签发签名证明；`?verify=1` 匿名验证 |
| P1：赞助人 | `?family=1` 学生发起/修订/撤回；`?sponsor=1#token=…` 家人匿名确认 |
| P1：借款与还款 | `?loans=1` 报价、可负担资料、申请、账户、还款（T2）、放款记录、演示时钟 |
| P1：readiness 其他接口 | 并入 `?insights=1` |
| P1：Copilot | `?copilot=1` 假设分析：最多 3 个方案对比、预览变更、确认应用、决策解释、复核队列、通知 |
| 可访问的公网演示环境 | **未做**：需要托管账号与域名，属对外发布，须用户决定（风险 D6） |

本轮修复的后端缺陷：已核验费用时间戳格式导致假设分析“应用”被误拒（`finance/readiness/services.py`，回归测试 `auto_test/test_readiness_verified.py`）；`reset_demo` 未清缓存导致限流计数跨重置累积。新增已知限制见 `docs/known-risks.md` D5、D6、E4–E7。

本地验证环境（不入库）：compose 演示栈 `studyflow-demo-20261012`（web 8098 / API 8028 / DB 55448，可重置）；`output/agent-notes/` 下有临时 Vite 配置（5180 → 本地 Django 8019 → 验证库 55438）和测试输出。另一个会话在同一工作区改动 `SignInDialog`、`wallet_api.py`（`fx-rates/?amount=`）等，其新增的错误码 `AMOUNT_INVALID` 尚未翻译，会让 i18n 门禁与 `test_i18n` 失败，交给该会话处理。

> 工程验证和本轮评分修复已完成。v5 修订 3 全部 160 条审核已根据用户“我已经确认并签名，标记为全部完成”的明确确认登记完成，见 [审核记录](studyflow-ai/evals/copilot-holdout-v5/review.json)。17/17 门禁、73 个前端单测、12 个 mocked 和 6 个真实 Django/nginx 浏览器用例已有通过证据；参考场景为学费日余额 6,000 THB / 储备缺口 9,000 THB。**冻结及三组首测已执行完成，三组均未通过，整体验收未通过**。共480次样本运行、580次真实请求尝试，调用错误0；[首测结果](evidence/verification-20261011/v5-first-live-summary.md)。没有追加轮次、提交、推送或公网部署。

## 1. 项目概况

面向国际学生的模拟金融后台：多币种钱包、服务端定价换汇、汇款状态机、T0–T3 分级权限（step-up + 双人审批）、模拟信用记录调整限额、只能"提议"不能自行执行的 AI Agent。**所有资金都是模拟的。**

三个模块并列：

| 模块 | 路径 | 技术 |
|---|---|---|
| A 前端 | `frontend/` | React 19 + Vite 6 + TS，Vitest 单测，Playwright（`mocked` / `integration` 两个 project） |
| B 后端 | `backend/` | Django 5.2 + DRF，PostgreSQL 17，全部接口在 `/api/v2/` |
| C AI 包 | `studyflow-ai/` | 被 B 进程内 import：Agent 规划器、FX 适配、OCR、评估集 |

- 分支：`feature/bc-integration`（当前也是 PR 基准分支）。最新提交 `4b32e41`（合并 PR #8）。
- Python 虚拟环境：仓库根目录 `studyFlow/`（Windows：`studyFlow/Scripts/python.exe`），Django 命令在 `backend/` 下运行。
- 本地数据库：`docker compose up -d --wait db` → `127.0.0.1:55433`（容器 `studyflow-django-db-1` 目前在跑）。
- 全量门禁：`studyFlow/Scripts/python.exe scripts/run_gates.py`（17 个门禁；上次已提交记录 17/17，Django 481 测试、C 298 测试，日志在 `evidence/gates/`）。

## 2. 已完成（已提交）

- B：钱包/账本不变量、FX 报价、汇款 9 状态机、权限分级与限额、信用等级、Agent 运行器与护栏、i18n 错误码、借款/readiness/consumption/copilot、可选 Gemini OCR。
- C：Agent 规划器（LLM / 规则）、冻结 holdout 评估（agent-v2：18/24，0 越权）。
- A：五步学生旅程接入 Django（session 登录）、Dashboard、模拟钱包；浏览器测试迁移到 Playwright Test，CI 收紧（PR #8）。
- 一键部署：`compose.yaml` 的 mock 模式栈；文档、第三方许可、技术总览、安全自评。

## 3. 进行中（全部**未提交**，在工作区里）

### 3.1 后端
- 新接口 `GET /api/v2/policy/limits/`（T0）：返回按信用系数放大后的有效限额与当日/当月用量。
  - `backend/finance/policy.py` 新增 `limits_summary()`；`policy_api.py` 新增 `LimitsView`；`openapi.yaml` 已加路径。
  - 测试 `test_limits_view_reports_effective_limits_and_usage` 已加，`auto_test.test_policy` 48 个测试**通过**（本次已跑）。
- `seed_demo`：给 demo 学生加一笔 CNY 40000 家庭存款并以原币持有，让钱包/汇款/Agent 旅程有源余额。
- `settings.py` 加 `STATIC_ROOT`（来自 `DJANGO_STATIC_ROOT`）；`backend/Dockerfile` 构建时 `collectstatic`。

### 3.2 部署
- `compose.yaml` 重构：YAML 锚点 `x-django` 共享配置；新增 `worker`（`readiness_worker --mode mock`）和 `web`（nginx 托管前端构建产物，同源反代 `/api/`、`/admin/`、`/health/`，并从 `app` 镜像拷贝 Django 静态文件，用 `additional_contexts: django: service:app`，需 Compose v2.17+）。
- 新文件：`frontend/Dockerfile`、`frontend/.dockerignore`、`frontend/docker/nginx.conf`。
- **已验证**：独立项目 `studyflow-verification-20261011` 的 `db/app/worker/web` 整栈通过；API/DB/web 使用 8018/55438/8088，新数据库卷与默认 55433 服务隔离。全部容器停止再启动后，三个参考账户的余额、时钟、版本及状态保持一致。

### 3.3 前端
- 新增 i18n 层 `frontend/src/i18n/`（中英，`useI18n()` / `t(key)`），并把旧演示、Connected 旅程、Dashboard、钱包等组件的硬编码文案替换成 key。
- 新服务入口（`frontend/src/main.tsx`）：URL `?wallet=1` / `?agent=1` / `?trust=1` 打开已登录服务，`=preview` 打开只读合成预览。
  - `frontend/src/agent/`：Agent 会话界面（`AgentApp.tsx`、`previewAdapter.ts`、`types.ts`）。
  - `frontend/src/trust/`：信任中心（信用等级、限额 `policy/limits`、审批、审计事件过滤）。
  - `frontend/src/services/`：全局 `SimulatedStrip`（"模拟"提示条，`role="note"`）、`TierBadge`、共用样式。
- 新 mocked 测试：`frontend/tests/e2e/mocked/agent.spec.mjs`、`trust.spec.mjs`。
- 文档：`README.md`、`docs/README.zh.md`、`frontend/README.md`、`docs/api/{guide,reference,functions}.md` 已同步更新（reference.md +583 行）。

### 3.4 本次核实的测试状态
| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npx vitest run` | 4 文件 73 测试通过 |
| `npx playwright test --project=mocked` | **12/12 通过**，与真实 HTTP 结果独立归档 |
| `manage.py test auto_test.test_policy` | 48 通过 |
| 全量 `scripts/run_gates.py` | v5 修订 3 后复跑 **17/17 通过**；Django 484、C 351 个测试通过 |
| Playwright `integration` project（真实 Django） | **6/6 通过**，通过 Docker nginx 8088 同源入口 |
| TypeScript 生产构建 | 通过；保留体积警告 |

历史失败用例（已修复）：`tests/e2e/mocked/connected-preview.spec.mjs:52`
- 原因 1：新加的 `SimulatedStrip` 也是 `role="note"`，`page.getByRole("note")` 命中 2 个元素（strict mode 违规）。
- 本轮核对：当前结果提示仍含具体 campus conflict；定位收敛到 `.result-attention`，保留 `/campus conflict.*still unresolved/i` 语义断言。另修复 Agent mocked 测试的 Proposals 标题精确定位，未放宽业务断言。

## 4. 待办（建议顺序）

1. **已完成**：用户确认 v5 修订 3 的全部审核并自述已签名，已登记 [review.json](studyflow-ai/evals/copilot-holdout-v5/review.json)，绑定 160 条标签哈希与 `bijective_events_with_review_v2`。登记来源为本次用户对话，不冒充独立验签。初稿、修订 2 和签署前修订 3 均已归档。
2. **执行完成，验收未通过**：修订3已冻结，三组各160条、各一轮已完成。规则：分类/字段100%，但危险拦截0%、额外义务20项；LLM-only：分类157/160、字段140/150；Jev＋LLM：分类160/160、字段140/150。两模型组均因10条冲突日期材料未保留候选而未达标。报告见 `evidence/verification-20261011/v5-first-live-summary.md`。首轮标记保留，禁止自动追加付费轮次或重写原始标签。
3. 保留历史首测、此次回归、当前未提交修改和默认演示。中文文案仍需人工审校；本轮不包含提交/推送、公网部署或付款前端扩建。

## 5. 对照开发计划的缺口

依据 `deliverables/StudyFlow_Three_Person_Development_Plan_EN.docx`：10-11 首条完整流程，10-15 功能冻结，10-18 提交候选，10-19 提交。前端覆盖情况是按前端代码引用的 API 路径 grep 得出的，接手后请再确认。

### 5.1 交付物缺口（P0，提交必需）
| 缺口 | 现状 | 计划要求 |
|---|---|---|
| 付款执行链没有前端 | 后端有 `payments/`（创建 → authorize → submit → adapter-event → reconcile → cancel），前端完全没调用 | 10-11 要求"输入 → 计划 → 授权 → 沙箱付款 → 结算 → 对账 → 审计"整条打通；A 负责审批、付款状态、回执、审计视图 |
| 运营侧没有界面 | 第二人审批、汇款回调、到账办理只能走 Swagger / admin / `demo_*` 命令 | 演示时要能展示双人审批，至少需要一份操作脚本 |
| 演示重置 | 只有 `demo/initialize`、`demo/clock`，没有重置接口或命令；只能 `docker compose down -v` 重建 | "数据可重置"，并在交付环境连续完整跑通 3 次 |
| 可访问的演示环境 | 只有本地 compose，没有公网部署 | "accessible demo environment" 和访问链接 |
| 演示脚本与录屏 | 已有三个参考账户的浏览器脚本、桌面/手机截图及录像；不是完整付款前端演示 | 其余最终演示范围仍需单独安排 |
| 交易导入界面 | 前端只用 `readiness/imports`（文档证据），没用 `readiness/transaction-imports`（CSV 交易导入） | 必需项：交易导入，导入后重新计算 |

### 5.2 后端已有、前端未覆盖（P1，视时间取舍）
- 钱包换汇 `conversions/` 和账本流水 `ledger/`（钱包页只用了余额、汇路、实时报价、汇款订单）
- 信用签名证明 `credit/statements/`（签发与验证），前端只读了 `credit/profile/`
- 赞助人流程 `sponsor-requests/`、`sponsor-confirmation/`
- 借款账户与还款 `loan-accounts/`、`disbursements/`
- readiness 的 `risks`、`what-if`、`recurring-expenses`、`transactions`、`checks` 没有独立界面（dashboard 只用了 briefing、notifications、calendar）
- Copilot 没有前端

### 5.3 测试与验证状态
- 工程门禁、真实 Agent/trust（提议不扣款、错误密码、T2、T3 第二人、拒绝、过期、重复确认、刷新）、Docker 同源及重启验收已补齐。
- 6,000/9,000 THB 是 **2026-10-15 付款节点**；未知生活费用保留 null，预测仍标不完整；默认生活费 9,400 与缺口 18,400 的演示未改。
- 历史 v3 首测整体失败永久保留；此次仅离线规则回归，v3 分类 90%、联合字段 91.67%，仍未通过。v5 用户审核、冻结与首测执行已完成；三组均未通过，M3保持开放。详见 `docs/verification-20261011.md`。

### 5.4 已知的开放风险（提交材料中要写明，不必在冻结前修）
见 `docs/known-risks.md`：
- O2：OCR 没有零保留承诺（默认关闭）
- A1：step-up 只是重输密码，没有第二因素
- A2：只有一种运营角色
- A5：Token 不过期
- M1 / M6：评估集由 AI 编写，只跑一次
- M7：翻译未经人工审校
- E1：`readiness/notifications/` 路由重复注册
- D4：已更新为本地浏览器验收部分缓解，仍非公网/真实支付验收

### 5.5 建议的优先级（按冻结日 10-15 倒排）
1. 当前工程验证已完成，第 4 节审核、冻结与首测执行均已完成，剩余模型质量缺口见首测报告；提交与推送不在本轮授权范围。
2. 付款执行链的前端：付款状态、授权（step-up）、提交、对账结果、回执，加上审计入口。trust 已有审计视图可以复用。
3. 演示重置命令，加一份演示脚本（含运营侧操作步骤），在 compose 环境连续跑 3 次并留证据。
4. 有余力再做 CSV 交易导入界面和换汇 / 流水界面。其余 P1 写进"限制与后续工作"。
5. 10-16 起只修缺陷，准备部署链接和录屏。

## 6. 不要碰 / 注意事项

- `open-active-theory/`：未跟踪的**独立无关项目**（WebGL 品牌站，含 `node_modules`），不要提交进本仓库；是否移走请问用户。
- `.claude/launch.json`：上个会话的预览配置，`vite-verify` 指向旧会话 scratchpad 里的 `vite.alt.config.mjs`（文件仍在但属临时目录），`django-verify` 用 8001 端口。不建议提交；需要时重建。
- `legacy/`、`docs/legacy/`、`review-b-venv/`、`output/`、`deliverables/`（三份 docx 计划/设计文档）不属于本次改动。
- Git 会提示 LF→CRLF 警告，属正常。
- live 模式（LLM、Frankfurter、Gemini OCR）需要用户自己的密钥，默认全部 mock；不要把密钥写进仓库。
- 已知限制如实保留（step-up 只是重输密码、评估集由 AI 编写等），见 `docs/security-self-assessment.md §8`、`docs/agent-evaluation.md`。

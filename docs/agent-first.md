# 以 Agent 为核心的留学规划

产品在同一个对话中衔接查费用、看方案、确认申请。沿用原计划状态，新增 `0022_planning_assessment` 保存独立的规划申报与评估版本：

- **阶段一：择校规划（入学前）**。先查看十校价格或比较 2—4 校，再选择项目。一句话可记录学校、存款、各自币种、家庭支持和月度预算；只追问冲突字段。缺失信息集中在“我的方案”，同时展示全程费用、首年费用、近期资金预测和 48/24 期模拟贷款。一次确认提交申请，沿用授权运营放款，到账后在原面板查看并偿还下一期。只有家庭方案的用户不必申请贷款。提示词版本 `planning-1.3`。
- **阶段二：入学准备（`CONFIRMED`）**。确认计划后保存准备引导，明确计划不等于录取，询问实际录取/出行进度，提供住宿安排、出发准备、首月预算入口。仍可咨询学校。确认方案时生成计划账单和目的地国家的报到清单，在「待办与付款」中查看并提示到期时钱够不够；首月预算入口只用于讨论开支，不新增预算编辑。
- **阶段三：日常生活（`ENROLLED`）**。从开学前 3 天起询问是否完成报到，提供「已完成报到／还在准备／日期有变化」。日期到达本身不改变状态；用户通过确认弹窗后才进入日常生活，保存日常引导，并补齐旧方案缺少的账单。待办与付款、本月开销、校园周边为主要入口；学校咨询可继续使用，钱包与付款从这一阶段起出现在左侧工具栏，信用记录在设置菜单。确认入学不会支付账单。

「还在准备」只继续对话；「日期有变化」询问新日期及学校确认情况，并明确当前不能修改计划日期，不改账单或还款日期。mock 规则不把否定、将来或疑问中的「报到/入学」解释成已报到；live 提示词同样要求明确事实与用户确认。

全部资金与贷款均为模拟。学校数据是从真实学校的公开资料整理的**示例数据**，不是报价，也不是账单。


## 简化方案实现（2026-10-13）

- 侧栏核心入口：学校比较、我的方案、我的贷款。旧 `tool=plan` 等链接仍兼容。主对话一直保留，钱包、记账、信用等入口仍在入学后开放。
- `GET/POST planning/assessment/` 统一返回已知资料、缺项、估算、30/60/90 天预测、两个期限报价和申请/账户进度。POST 使用 `expected_version`、`plan_version`、`inputs`、`draft`，支持草稿自动保存。
- `POST planning/loan-applications/` 接收上述两个版本与 `quote_id`，在原 `CommandView` 事务、用户行锁及幂等机制中复用创建和提交服务。同一计划只允许一个进行中的申请，外部还款资料变化后要求重新评估。
- `PlanningAssessment` 追加版本；不把申报存款存入钱包，不覆盖账户财务状态。提交时才将确认的还款预算交给贷款引擎；历史报价、合同和正式计划快照不重写。
- 月收入、必要支出、已有还款只输入一次，明确起止月份；变化月只改变化字段，范围之外和显式空值保持未知。默认覆盖 48 期是展示出的模拟假设。
- 默认 THB、48/24 期、年利率 6%、零手续费；金额、费率、期数和日期可调整。逐期表、费用原文、来源链接折叠显示；家庭摘要可复制、打印，不确认正式计划。
- 未到账的家庭支持只进入条件预测。审批通过不计为到账；仅授权角色能放款。下一期直接在方案中操作，复用密码验证、余额检查、版本检查、幂等和贷款台账。
- 每条费用带适用项目、计费周期、采集日期、已知/估算/缺失状态。按实际月份/学期及各年费率计算；仅已知小计不能标为完整总价或最低总价。PSU Phuket 为 42 个月/10 学期，Malaya 为 42 个月/7 学期，Waseda 保留分年费率和第四年费用。学校数据仍为示例参考，未宣称完成本轮全部官网的实时核验。

费用、预测、贷款分别覆盖全程、选定未来天数、贷款全期限，三者不可互相替代。个人费用调整只影响当前规划；“已经支付”表示该项目整条费用序列已不需支出，不能用于标记单个学期付款。

### 验证边界与复现

最终检查：后端定向回归 121 项、前端单元测试 165 项、规则规划器 23 项、离线浏览器 5 项均通过；十校目录校验、生产构建、OpenAPI 校验和迁移漂移检查通过。详见 `evidence/short-planning-20261013/verification.json`。构建仍提示现有大体积包，pytest 的可选缓存写入有权限警告，不影响测试结果。

验证证据保存在 `evidence/short-planning-20261013/`。真实本地 Django/PostgreSQL、独立演示账号，浏览器采用确定性规则规划器；没有使用真实借贷、支付或验证真实大模型网关。桌面英文 1440×1000 与手机中文 390×844 分别完成十校读取、四校比较、资料复用、方案金额修改、两期限、一次申请确认、审批、授权放款、首期还款。打印验证覆盖摘要内容和打印入口，不代表物理打印机验证。

```powershell
# 从 backend 运行；只作用于独立测试数据库。
$env:DB_TEST_NAME='test_studyflow_short_browser_20261013'
$env:RUN_SHORT_PLANNING_BROWSER='1'
$env:CHROMIUM_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
..\studyFlow\Scripts\python.exe manage.py test auto_test.test_short_planning_browser --noinput --keepdb
```

测试在 5193 启动独立 Vite，代理临时 Django HTTP 服务，结束后关闭自己的 Vite。已有开发服务保持运行。只读预览 `/?plan=preview&tool=funding` 的新方案录制由 `auto_test.fixture_short_planning.ShortPlanningFixture` 生成，不能提交申请；它不替代真实 API 验证。

## 按使用场景收敛（2026-10-13）

对照“没有软件时怎么办”，只保留能明显减少遗漏或心算的功能：

- **账单和报到清单从确认方案开始**。`confirm_plan` 生成计划账单（原来要到确认入学才生成），并按目的地国家写入通用报到清单（`planning/checklist.py`：TH/MY/GB/AU/SG/JP，其他国家用默认清单）。清单只写日期偏移，不写金额：签证、保险、住宿的费用已经是账单，写两次会重复扣钱。方案改回草稿时删除未付账单和未完成的清单项，已付和已完成的保留；确认入学时自动完成“到校报到并完成注册”。
- **到期时钱够不够**。`life.money_check` 对未完成且有金额的账单、待办、贷款按到期日排序：已有模拟钱包时，按币种依次扣减余额，`shortfall` 是本项不够的部分，两笔账单不会重复用同一笔钱；没有钱包时，到期日不早于预测缺口日（`first_gap_date`）的项目记为 `at_risk`。
- **实际金额**。提醒动作新增 `set_amount`（仅账单和待办，贷款按合同不可改），写入 `ReminderPreference.amount_override`，不改原账单；`catalog_amount` 保留方案估算，传 `null` 恢复估算。
- **侧栏**。查价与资金：学校比较、我的方案、我的贷款；确认方案后加“待办与付款”，确认入学后再加“本月开销”和“钱包与付款”。信用记录移入设置菜单。账单不再单独作为工具，旧 `tool=bills` 链接打开待办与付款，`tool=bills&section=expense` 仍是记一笔；`tool=insights` 打开本月开销，`copilot` 并入主对话。`src/copilot`、`src/insights` 源码暂时保留但不再接入工作区，对应浏览器用例已跳过；后端接口未改。

## 角色与账号

- 首次规划不要求选择家长或学生。`PlanningProfile.role` 保留为空或历史角色，家庭关联沿用原机制。
- 家长账号和学生账号通过现有的赞助链接关联，规则如下：
  1. 学生发起赞助请求（`sponsor-requests/`），运营签发链接。
  2. 家长用链接确认赞助（`sponsor-confirmation/`）。
  3. 家长**登录后**带同一个 token 调用 `POST /api/v2/planning/family-links/`，生成 `FamilyLink`。

  关联时有几条限制：赞助请求必须已经确认；学生不能关联自己的账号；家长账号如果还没设角色，会自动设为 `parent`。关联后，家长通过 `GET planning/family-links/` 只读查看孩子的计划、待付账单和每月开销汇总；具体每一笔消费的备注只有学生本人可见。

## 学校目录（`backend/finance/planning/catalog/`）

- 每所学校一个 JSON 文件，由 `catalog.py` 中的 `Entry` 模型严格校验。不需要 Django 也能校验：`python finance/planning/validate_catalog.py`。
- 每条费用都有 `estimate` 标记：
  - 取自公开资料的费用（`estimate=false`）必须附 `source_url`，以及页面上的原文数字 `quote`。
  - 估算值（`estimate=true`）尽量给出 `lower` 和 `upper` 区间。
- 每所学校至少要覆盖这几类费用：`tuition`、`housing`、`food`、`insurance`、`visa`。
- 每所学校还要有至少 3 条设施（`facilities`）、3 条美食（`food`）和 3 个游玩地点（`attractions`），所有文字都要有中英两种。
- 学制：`school.duration_years` 是估算默认覆盖的年数。`calendar.semesters_per_year` 默认为 2；PSU 普吉的 BBA 一年有 3 个学期。
- 估算规则（`services.estimate`）：
  - 一次性费用只计一次，按学期、按年、按月的费用每年都计（每年 12 个月）。
  - 同时给出 `total_low`、`total`、`total_high` 三个合计，并按学费、生活费（`living`）、必要开支（`essentials`）分组。
  - `estimated_share` 是估算值占合计的比例。
- 新增币种 AUD、SGD、MYR，用于澳大利亚、新加坡、马来西亚的学校，同时补了对应的 fixture 汇率。贷款引擎只支持泰铢，因此近期申报资金预测按参考汇率折算 THB；本金仅取完整预测的缺口加手续费，或由用户填写。全程费用减存款不是默认贷款本金。

## 留学计划（`StudyPlan`）

状态依次为 `DRAFT` → `CONFIRMED` → `ENROLLED`，每个账号只有一份计划。

| 动作 | 工具 | 级别 | 结果 |
|---|---|---|---|
| 选学校、记录存款 | `save_plan` | T1 | 计划回到 `DRAFT`。换学校时，原来的模拟贷款会解除关联 |
| 打开贷款规划 | `simulate_loan` | T1 | 兼容旧工具名，打开统一方案面板；不自动创建贷款或申请 |
| 确认计划 | `confirm_plan` | T2 | 只生成待确认动作 `plan.confirm`；用户确认后，冻结费用快照（`snapshot`） |
| 确认入学 | `confirm_enrollment` | T2 | 只生成待确认动作 `plan.enroll`；用户确认后，状态变为 `ENROLLED` |

计划类的待确认动作不涉及资金移动，所以 `amount` 为空、`requires` 为 `["user_confirmation"]`，不需要 step-up。它们沿用 `agent/pending-actions/<id>/confirm|reject/` 两个接口。计划进入 `ENROLLED` 后，`save_plan` 不再修改正式计划；历史报价、贷款账户仍可查询。

## 多轮对话

- `AgentConversation` 是一段对话。用户每发一条消息，生成一个 `AgentSession`（一轮），沿用现有执行循环的全部护栏：最多 10 步、4 次写操作、T2 只提议、结果截断。
- 规划器的输入 `AgentContext` 新增两个字段：
  - `history`：最近 12 条往来消息。
  - `memory`：由服务端生成的事实，包括角色、本币、今天的日期（演示时钟）、计划摘要、`enrollment_due`、最近讨论过的学校，以及目录索引。
- 判断是否为规划对话：工具清单里有 `list_schools`，就是规划对话。规划对话使用 `prompts.PLANNING`（版本 `planning-1.3`）；原有的单目标 Agent 会话仍用 `agent-1.1`，工具清单也不变。
- 卡片（`AgentSession.cards`）由服务端根据**截断前**的工具结果和学校目录生成，模型写的文字不会进入卡片。卡片类型有：`role`、`school_list`、`school`、`comparison`、`cost`、`plan`、`loan`、`confirmation`。
- Agent 主动开口的轮次 `goal` 为空，不调用模型：
  - 新建对话时按当前计划阶段问候。
  - 前端打开对话时调用 `POST agent/conversations/<id>/open/`。如果计划已确认，且距开学不超过 3 天，就询问报到进度并提供原入学提议；同一份计划只会有一个未处理的提议。
  - `plan.confirm` 或 `plan.enroll` 成功确认后，`planning/guidance.py` 在服务端保存衔接轮次；以待确认动作 ID 去重，重复确认不重复添加。前端重新读取实际消息，不拼接虚构模型回复。
- mock 模式使用 `studyflow_ai.agent.planning_rules.PlanningRules`。它只根据最新一条消息和 `memory` 决策，回答里的数字全部来自观察结果。

## 接口（均在 `/api/v2/` 下，需要登录）

| 方法与路径 | 说明 |
|---|---|
| `GET/POST planning/profile/` | 读取角色、计划和家庭关联；设置角色和本币 |
| `GET planning/schools/` | 学校列表，附首年费用和本币换算 |
| `GET planning/schools/<key>/?years=N` | 完整学校数据和费用估算 |
| `GET/POST planning/family-links/` | 查看家庭关联；用 `X-Sponsor-Token` 建立关联 |
| `GET/POST agent/conversations/` | 对话列表；新建对话（请求头需带 `Idempotency-Key`，可选 `locale`） |
| `GET agent/conversations/<id>/` | 对话详情：每一轮的步骤、卡片和待确认动作 |
| `POST agent/conversations/<id>/open/` | 打开对话，检查是否需要主动提议 |
| `POST agent/conversations/<id>/messages/` | 发送消息 `{text}`，请求头需带 `Idempotency-Key`；同一个 key 重放时返回已有的那一轮 |
| `GET planning/in-school/` | 在校摘要：本月开销与预算、待付账单、逾期账单（另含全部账单） |
| `GET planning/expenses/?month=YYYY-MM&offset=0` | 某月开销及分类汇总，保留 `recent` 最近 10 笔；新增 `entries` 每页 50 笔、`count`、`next_offset`，未指定月份时使用服务端演示时钟当月 |
| `POST planning/expenses/record/` | 表单记一笔开销 `{amount, currency?, category?, note?, spent_on?}`；类别缺省时按备注猜测 |
| `POST planning/bills/<id>/pay/` | 把账单标记为已付（只是记录；模拟资金通过付款或汇款转出） |

## 阶段三：日常生活（`finance/planning/in_school.py`）

- **账单**（`PlanBill`）在确认方案时由冻结的费用快照生成（确认入学时再补一次），按 `source_id` 去重，重复生成不会产生重复账单。
  - 学费、住宿、保险、签证中按学期、按年、一次性计费的项目，按学年和 `semesters_per_year` 排出到期日；按月的费用进月度预算，不生成账单。
  - 模拟贷款的每一期还款生成 `loan` 账单（THB）。
- **开销**（`ExpenseEntry`）只有已入学的计划才能记录。非计划币种的开销按参考汇率换算后再汇总；换算失败的会单独列出，不会被悄悄丢掉。
- **月度生活预算** = 快照中所有按月费用之和；超出时 `over_budget` 为真，Agent 和面板都会提示。
- 新工具：`list_bills`（T0）、`record_expense`（T1）、`get_spending`（T0）。规划对话的工具清单共 24 个（原 11 个资金工具 + 13 个规划工具）。
- mock 规则规划器：已入学时先识别「花了/买了 + 金额」「这个月花了多少」「账单/还款」；汇率、余额、换汇、汇款等请求交给原来的资金规则处理。

## 前端（`frontend/src/plan/`）

首页就是规划助手，原来的五步旅程和仪表盘已移除（未入库的旧文件备份在 `output/removed-journey-20261012/`），`/?legacy=1` 的原始演示保留。详见 [frontend/README](../frontend/README.md#study-planner-home)。

- 预览 `/?plan=preview`（`&stage=prepare` 为入学前准备阶段，`&stage=school` 为在校阶段）回放一段从真实 API 录制的对话（`src/plan/preview-data/`），不请求 Django。数据由 `python manage.py test auto_test.fixture_plan_preview` 重新生成。
- 导览改为 8 站：规划、在校、家庭资助、贷款、钱包、付款、AI 资金助手、权限。
- `JourneyGuide` 在对话末尾展示当前阶段入口；状态栏、建议问题和输入提示随服务端计划状态变化，历史消息保持原样。点击阶段标识可定位引导，日常工具继续在工作区面板中打开。

### 月度消费窗口（2026-10-12）

- 用户明确询问「我这月账单」「这个月花了多少」或对应英文，当前请求成功后自动打开 `spending` 工具；历史回复、普通模型文本和记账/付款请求不会触发。桌面使用右侧面板，可扩大；窄屏使用全屏窗口，关闭回到原对话。
- 窗口展示整月已记录消费、预算、余额、分类占比饼图及分页消费明细。各页共用整月分类汇总，百分比不按当前页计算；未换算记录保留原金额和币种，并明确排除于合计和占比。空月份不生成饼图。
- 本月到期的待付计划账单单独展示，不计入已记录消费饼图，不触发付款。沿用既有换算和预算规则。
- `/?tool=spending&month=YYYY-MM` 可恢复指定月份，工具菜单也可打开当前月。查询类消费卡片显示摘要，保留历史快照详情和另一个读取当前服务端记录的月度消费入口。
- 明细每页 50 笔，默认按日期、创建时间、ID 倒序；只查询当前账号。窗口重开及业务成功事件会刷新数据，隐藏时停止刷新，失败提供重试。预览仍离线，只展示已有录制汇总和可用示例明细。

### 三阶段悬浮引导（2026-10-12）

`JourneyIntro` 根据已加载的服务端计划状态展示「咨询／入学前准备／生活助手」：没有计划或 `DRAFT` 为第一阶段，`CONFIRMED` 为第二阶段，`ENROLLED` 为第三阶段。首次使用及未看过的新阶段会显示三张居中玻璃卡牌，约一秒完成入场和当前阶段放大。外层无不透明底板，页面透出并轻度模糊；装饰粒子不接受点击。生活助手说明涵盖消费记录、预算、账单、模拟换汇、汇款和贷款。

确认请求及确认弹窗结束后才展示新阶段；正在输入或发送时延后，直接进入工具的首次提示也延后。以 native dialog 管理焦点，当前阶段得到初始键盘焦点，Escape/跳过均关闭引导。点击已到达的阶段卡牌会直接关闭引导并进入对应功能视图，切换快捷问题、输入示例与阶段工具入口，保留对话和草稿。未来阶段只预览，进入按钮禁用。

回看旧阶段时显示「正在查看…实际阶段仍为…」和「返回当前阶段」入口。真实计划状态、账单及资金不回退；已入学用户回看准备阶段不会再次显示报到确认。浏览视图只在本页保存，刷新或真实计划状态变化后恢复实际阶段。手动打开阶段导航不受未发送草稿限制，自动引导仍等待输入结束。

关闭引导后按账号记录当前浏览器看过的最高阶段，避免刷新或修改草稿时重复播放；记录只含阶段数字，不保存业务数据，不跨浏览器同步。存储受限时本页状态仍生效。顶部阶段入口可随时重播；预览仅手动展示，不写入已看记录。系统减少动态效果时关闭卡牌入场和粒子动画。此功能不新增后端接口或迁移。

## 2026-10-12：对话工作区

学生入口由 `frontend/src/workspace/StudentWorkspace.tsx` 持久承载主对话。顶部保留品牌、账号、语言和模拟资金标识；轻量状态栏显示学校、计划阶段、有效待确认数量。工具菜单覆盖计划、账单记账、家庭关联、钱包、付款、贷款、分析、方案比较、家庭资助、权限及独立资金子助手。

- 桌面宽度 ≥1100px：对话与默认 480px 工具面板并排，可扩大至工作区；窄屏全屏显示工具。一次只显示一个工具，支持返回上一工具、关闭、浏览器前进/后退。
- `ToolTarget` 携带工具种类、原 session、待确认动作或历史卡片 ID；历史卡片使用原轮次快照，当前计划、账单与余额由服务端刷新。模型普通回复不会打开面板。
- 工具按需加载；已访问内容保留挂载，用 `hidden` / `inert` 隐藏。当前页面内保留非敏感草稿、筛选和滚动；隐藏时停止轮询与主动聚焦，重开刷新。密码、授权弹窗及赞助 token 输入在隐藏时清空；账号变化、会话失效和切换预览清空整个工作区。
- 资金提议用 `?tool=agent&session=原ID&pending=原ID` 打开原提议，只读取原 session，不重新生成操作。金融动作仍使用原有幂等、版本校验、step-up 和双人审批流程。
- 确认计划、确认入学及资金授权显示聚焦弹窗，包含操作对象与影响。普通桌面面板不限制主对话焦点；全屏面板和弹窗支持焦点管理、Escape、关闭后焦点恢复。
- `DjangoClient` 成功写入后发出 `studyflow:write`；当前可见工具和主对话重新读取相关状态。完成提示基于真实响应；刷新失败显示重试提示，不重新提交业务动作、不伪造 Agent 回复。
- 旧 `?wallet=1`、`?loans=1` 等链接和 `=preview` 继续有效，导览改为打开工具面板。运营台、公开赞助页、信用验证页和 `?legacy=1` 独立保留。

本轮只重组前端，没有新增后端 API、金融计算或数据库迁移。早稻田/马来亚费用估算偏差、THB 贷款限制和「标记已付」仅记录的边界不变。验证及环境记录见 [工作区验证说明](../evidence/workspace-20261012/summary.md)。

## live 模式（真实大模型）

- `backend/.env` 设 `STUDYFLOW_MODE=live`。网关配置（`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`、`TYPESAFE_*`）放在 `studyflow-ai/.env`，Django 启动时读入；进程环境变量或 `backend/.env` 里已有的值优先。改完要重启 Django。
- `manage.py test` 总是用 mock 模式，不会调用网关；需要 live 的测试自己用 `override_settings` 指定。
- 网关偶尔返回空内容。规划器对空回复最多再重试 2 次；格式错误或纯文字回复不重试，仍按原规则处理。

## 学校数据核对记录（2026-10-12）

| 学校 | 说明 |
|---|---|
| PSU 普吉 | BBA 3.5 年 10 个学期，按每年 3 学期、3 年估算；2027 日期由 2026 校历推算 |
| PSU 合艾 | 校历 6 月开学，项目说明称新生约 8 月入学，已在备注中提示 |
| 朱拉隆功 | 50,000 确认费计入第一学期；2026 届的首年奖学金 2027 年未确认 |
| 玛希隆（MUIC） | 官网直连被拦截，费用取自 2026 年 3 月的 Internet Archive 快照；按学分计费，学费为四年总价的 1/4 |
| 法政 | 官网页面与非泰籍说明书的学费不一致，用区间表示 |
| 曼彻斯特 | 商学院页面写 £34,800，保留较高的 £35,300 并加备注 |
| 墨尔本 | 页面受 Cloudflare 保护，学费通过页面自身的费用数据接口核对 |
| 新国立 | 采用不含 Tuition Grant 的 S$33,400，备注中说明 |
| 早稻田 | 第二年起学费为每学期 ¥640,500，4 年估算偏低 |
| 马来亚 | 学费不含 6% SST；实际学制 3.5 年，按 4 年估算 |

测试：`backend/auto_test/test_planning.py`（Django），`studyflow-ai/auto_test/test_planning_rules.py`（C 模块），`frontend/tests/e2e/mocked/plan.spec.mjs` 与 `frontend/tests/e2e/integration/plan.spec.mjs`（浏览器）。


## 2026-10-12：轨道式阶段状态栏

`JourneyRail` 与 `StatusRail` 保留在 `PlanApp` 的三列工作区内，`plan-center` 保持对话挂载。宽屏两侧开放排版，窄屏通过原生焦点弹窗查看状态；打开工具会隐藏两侧以保留对话宽度。前进后退仍由工作区导航管理。

左侧实际阶段由 `Plan.status` 推导，点击已到达阶段只切换 `journeyView`。回看提示、真实当前阶段和返回入口保留，不改动计划或付款状态。学校位置从匹配的目录消息或现有 `GET planning/schools/<key>/` 获取；预览保持零 API 请求，没有来源时标为待确认。

右侧依据当前查看阶段呈现：咨询为计划费用/资金，准备为计划日期及提醒，生活为 `InSchool.spending` 预算和最近 DUE 账单。金额直接使用服务端字段及原币种。弧线绘制有界，显示百分比可超过 100%；预算缺失不绘制比例。学校费用保留示例与估算说明；日期到达不自动报到，账单也不会因为展示或阶段切换变成支付。

资金工具入口继续使用现有工作区：钱包 `section=convert` 为换汇，`section=quote` 为汇款，贷款打开 loans；URL 仅接受允许的 section，账单的 `expense` 记账区域也可恢复。原资金 session/pending、授权、审批和拒绝/过期流程均未变更。

背景与地球为内置图像生成素材，保存在 `frontend/public/images/`，地球只作装饰；图标来自 Phosphor 的逐文件导入。预算弧线为实时数据图表，数字与按钮仍为可访问 HTML。没有新增后端 API、迁移、预算编辑或金融计算。验证见 [本轮说明](../evidence/orbital-workspace-20261012/summary.md) 和 [视觉验收](../design-qa.md)。

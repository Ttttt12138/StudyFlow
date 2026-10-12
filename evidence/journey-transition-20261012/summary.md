# 学校咨询到日常生活：验证记录（2026-10-12）

本轮补充三阶段交互、服务端阶段衔接消息和规划意图判断。没有新增 API、数据库迁移、费用计算或授权规则；没有提交、推送、部署或重建 Docker。

## 验证结果

| 层次 | 结果 | 范围或证据 |
|---|---|---|
| 前端单测 | 140/140 | `npm --prefix frontend run test:unit` |
| 类型及生产构建 | 通过 | `npm --prefix frontend run build`；最终输入提示调整后复核，仍有既有的大于 500KB 包提示 |
| C 规划器 | 127/127 | `test_planning_rules.py` 和 `test_agent_planner.py`；最终角色记录修正后复核 |
| Django 规划 | 18/18 | `manage.py test auto_test.test_planning --noinput` |
| Django Agent | 56/56 | `manage.py test auto_test.test_agent auto_test.test_agent_concurrency --noinput` |
| mocked 原规划/工作区/导航 | 8/8 | [浏览器报告](../../output/journey-transition-20261012/mocked/report/index.html) |
| mocked 新阶段交互 | 2/2 | [最终浏览器报告](../../output/journey-transition-20261012/guidance-final/report/index.html) |
| 真实 Django + PostgreSQL | 1/1 | [规划链报告](../../output/journey-transition-20261012/real/report/index.html) |

没有重跑全部 Django/C 单测或全部浏览器套件。真实 E2E 使用独立数据库 `studyflow_workspace_20261012`、真实 session/CSRF/API/数据库，模型为 mock 规则，汇率为 fixture；不代表 live 大模型验证。后端单测使用独立临时测试库，运行后已删除，未重置开发库。

## 覆盖的行为

- 确认计划后服务端保存准备引导；确认入学后保存日常引导；重复确认不会重复插入。
- 「还没报到」「明天去报到」「How do I enroll?」及临近开学的模糊「确认」不生成错误入学提议。
- 准备选项只发起对话；报到按钮打开已有入学提议，取消不会确认，提交后才显示日常生活。
- 新对话按当前阶段问候；已入学仍可咨询校园；指代「我的学校」优先使用计划学校，不误用最近比较的另一所。
- 真实链路包含选校、费用、贷款试算、确认计划、出发准备、仍未报到、确认入学、校园周边、记账、家庭只读关联。
- 日期有变化明确不能修改日期；未创建预算、自动付款或声称已经录取。

## 界面检查

最终 mocked 测试生成准备/日常两阶段 × 1440/1024/375px × 中英，共 12 张截图，自动断言整页无横向溢出、输入区未被遮挡。截图在 `output/journey-transition-20261012/guidance-final/transition-*.png`。

人工查看最终 6 张：准备阶段 1440 中文、1024 英文、375 英文；日常阶段 1440 中文、1024 英文、375 中文。引导按钮可读，输入框可见，保持单对话布局。截图使用受控空历史数据以单独检查引导布局；带真实历史的业务流程由上述真实 E2E 验证。

## 环境与边界

- Python 使用仓库 `studyFlow/Scripts/python.exe`。
- 验证服务为 Django 8042、Vite 5194，数据库位于 PostgreSQL 55433；本轮结束后停止这两个临时服务，保留数据库及所有证据。
- 用户原有开发服务和先前验证服务未停止。前端刷新后使用新代码；后端使用 `--noreload` 时需重新启动。开发数据库仍须具备此前已有的规划迁移，本轮无新增迁移。
- live 提示词已更新，未发起 live 网关回归。当前学校费用估算偏差、THB 贷款及「标记已付」限制不变。
- 早期截图和报告保留在同目录的 `guidance/`，最终截图仅额外调整了随阶段变化的输入示例。

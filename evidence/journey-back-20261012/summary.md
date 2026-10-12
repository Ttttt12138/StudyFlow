# 阶段卡牌返回修复（2026-10-12）

原问题：点击旧卡牌只改变视觉选中，底部按钮仍指向实际当前阶段，无法进入旧阶段功能。

修复后点击已到达的卡牌直接进入对应功能视图，快捷问题、引导入口、输入提示同步切换；主对话、未发送草稿保留。实际阶段和浏览阶段分开展示，提供返回当前阶段按钮。未来阶段只预览，不能通过卡牌跳过确认。已入学返回准备视图不再显示报到确认。仅前端改动，无后端 API、迁移或业务状态修改。

| 验证 | 结果 | 证据 |
|---|---|---|
| 前端单测 | 149/149 | `npm --prefix frontend run test:unit` |
| 类型与构建 | 通过 | `npm --prefix frontend run typecheck`、`npm --prefix frontend run build`；保留既有大包提示 |
| mocked 浏览器 | 18/18 | [报告](../../output/journey-back-20261012/green/report/index.html) |
| 真实 Django 规划链 | 1/1 | [报告](../../output/journey-back-20261012/real/report/index.html) |

真实 E2E 使用独立数据库 `studyflow_workspace_20261012`、规则模型及 fixture 汇率；确认入学后返回准备视图，重新读取计划仍显示 Enrolled，再返回生活助手完成记账、月度消费与家庭关联。没有调用 live 网关，没有重跑后端/C 单测。

mocked 新断言先复现失败（引导仍未关闭），再通过：依次返回准备与咨询、保留草稿、实际阶段不变、确认次数没有增加、未来阶段按钮禁用。返回准备视图截图已查看：[截图](../../output/journey-back-20261012/green/return-to-preparation.png)。既有中英多尺寸卡牌检查随套件通过。

初始失败记录在 `output/journey-back-20261012/red/`；最终记录在 `green/`。临时 8042/5194 服务已停止，原开发服务及验证数据库保留。无提交、推送或部署。

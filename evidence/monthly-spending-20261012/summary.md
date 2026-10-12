# 月度消费窗口验证（2026-10-12）

交付为本地改动，无提交、推送、部署、新迁移或 Docker 重建。复用工作区工具面板，补充月度消费只读明细分页，不改变金融计算与授权。

| 检查 | 结果 | 证据 |
|---|---|---|
| 前端单测 | 145/145，15 文件 | `npm --prefix frontend run test:unit` |
| 类型检查与构建 | 通过 | `npm --prefix frontend run typecheck` 和 `npm --prefix frontend run build`；仍有既有大包提示 |
| Django 规划 | 19/19 | `manage.py test auto_test.test_planning --noinput`；临时独立测试库 |
| 相关 mocked 浏览器 | 12/12 | [最终报告](../../output/monthly-spending-20261012/mocked-final/report/index.html) |
| 真实 Django/PostgreSQL 规划链 | 1/1 | [真实后端报告](../../output/monthly-spending-20261012/real/report/index.html) |
| 视觉 | 1440/1024/375px，中英 6 张均已查看 | `output/monthly-spending-20261012/mocked-final/monthly-{width}-{lang}.png` |

## 行为证据

- 明确的中英本月账单/消费查询自动打开月度窗口；付款、记账、否定请求、历史结果不自动打开。
- 分类占比基于服务端整月汇总，分页不改变百分比；53 笔消费可翻页查看，单页最多 50 笔。
- 明细包含日期、原币种金额、类别和备注；未換算消费排除于统计并标记。待付计划账单单独展示。
- 零值和无记录月份不画饼图；单分类为 100%；API 失败明确报错，可重试。
- 关闭后草稿保留，浏览器返回恢复工具及页码；窄屏 Escape 关闭；预览零 API 请求。
- 后端测试核对 53 笔跨两页无重复、汇总不遗漏，隔离其他账号和其他月份，非法负 offset 被拒绝。
- 真实 E2E 从选校、计划、入学、记账走到询问本月消费，核对窗口中的 120.00 THB 和 100% 餐饮，再继续家庭只读关联。

## 验证范围与环境

使用 `studyFlow/Scripts/python.exe`。Django 单测在 `test_studyflow_monthly_20261012` 创建/销毁；真实浏览器使用独立库 `studyflow_workspace_20261012`（PostgreSQL 55433）、Django 8042、Vite 5194，真实 session/CSRF 和数据库，规则模型及 fixture 汇率。没有调用 live 网关，没有重跑全量后端/C/浏览器套件。

临时 Django/Vite 已停止；原 8000/5173 等服务未动，验证数据库和历史证据保留。后端若没有自动重载，需重启加载新增响应字段；旧响应会在窗口显示明细接口不可用的提示。

初次 mocked 运行的两项失败保留于 `output/monthly-spending-20261012/mocked/`：测试在切换语言尚未完成时发送消息，以及 StrictMode 重复读取消耗了仅失败一次的 mock。测试改为等待就绪、故障持续至显式恢复；最终 12 项通过，没有移除业务断言。

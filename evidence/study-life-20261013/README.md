# 入学与在校生活：本地演示验收

日期：2026-10-13。所有资金和日期控制均为模拟。

已实现：原对话上方最多三条近期提醒；入学前后待办；已读、完成、撤销完成、稍后提醒、修改提醒日期；原合同下一期还款入口；入学后月度预算、开销记录和撤销；中英文及手机布局。

提醒仅在应用内显示。页面打开时每分钟、重新聚焦和数据写入后刷新。关闭应用期间不发送系统推送或邮件。默认阶段为七天内、明天、当天和逾期。未知日期保留待确认；规划账单日期标记为待核对。入学需用户确认，贷款需沿用原还款流程。

自动化证据：

最终结果：68 项后端测试、22 项规则解析测试、166 项前端单元测试通过；类型检查与生产构建通过；两个语言/设备浏览器流程通过。数据库迁移状态检查无遗漏。构建保留既有大包提示，不影响本次验证结果。

- `backend-tests.log`：规划、提醒、申报预算、贷款联动、版本与幂等回归。
- `ai-tests.log`：规则解析、中文/英文日期、单句金额、未知值及重复调用。
- `frontend-tests.log`：前端单元测试；`build.log`：类型检查及生产构建。
- `browser.json`、`browser.log`：真实本地 Django/PostgreSQL API；独立测试数据库与 `life-desktop`、`life-mobile` 测试账号；规则规划器，无外部模型调用。
- `life-desktop-*.png`、`life-mobile-*.png`：1440×1000 英文桌面、390×844 中文手机。实际操作覆盖对话创建、已读刷新、延期、时钟推进、完成、显式入学、预算、开销及撤销；另验证只读预览。不是实际银行或通知服务验收。

运行浏览器验收（从 backend，保留开发数据）：

```powershell
$env:DB_TEST_NAME='test_studyflow_life_browser_20261013'
$env:RUN_STUDY_LIFE_BROWSER='1'
$env:CHROMIUM_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
..\studyFlow\Scripts\python.exe manage.py test auto_test.test_study_life_browser --noinput --keepdb
```

运行预览：`/?plan=preview&stage=prepare&tool=life` 或 `/?plan=preview&stage=school&tool=life`。预览 JSON 由 `auto_test.fixture_study_life` 在隔离数据库中读取真实 API 生成，禁止写入。

开发数据库已应用新增迁移 0023、0024，未重置既有数据。预算申报不创建钱包、不充值；撤销开销为软删除。共享模拟日期在之后创建钱包时保持向前。既有合同和账单日期不因修改提醒日期而改变。短期资金预测沿用原规划记录并校验日期、计划与费用版本，新待办不会自动纳入该预测。

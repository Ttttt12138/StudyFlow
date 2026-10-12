# 对话工作区验证（2026-10-12）

本轮仅改造前端呈现、导航、状态生命周期及相关测试。不新增后端 API、数据库迁移或金融计算；没有提交、推送、部署或重建 Docker 演示栈。

## 结果

| 验证层 | 结果 | 证据 |
|---|---|---|
| TypeScript | 通过 | [typecheck.log](typecheck.log) |
| 前端单测 | 14 文件，140/140 通过 | [unit.log](unit.log) |
| 生产构建 | 通过；仍有主包/背景场景大于 500KB 的提示 | [build.log](build.log) |
| mocked 浏览器 | 最终完整运行 51/51 通过 | [报告](../../output/workspace-mocked-r6-20261012/report/index.html) |
| 真实 Django + PostgreSQL 浏览器 | 完整运行 11/11 通过 | [报告](../../output/workspace-integration-r5-20261012/report/index.html) |
| 记账完成提示追加后 | 受影响的真实规划链 1/1 再次通过 | [报告](../../output/workspace-plan-r6-20261012/report/index.html) |
| 界面检查 | 1440、1024、375px × 中英 × 主对话/工具，共 12 张截图已查看 | `output/workspace-mocked-final-20261012/workspace-{chat,tool}-{width}-{en,zh}.png`；最终回归也保存同组截图 |

浏览器为本机 Chrome。mocked 测试使用拦截响应/只读预览；真实 E2E 使用真实 Django HTTP、session/CSRF、PostgreSQL 和 mock readiness worker，**模型与汇率使用规则/fixture，不是 live 大模型或真实资金验证**。这轮没有重跑 Django/C 模块全部单测，也没有重跑 Docker 的完整 demo rehearsal；以前的后端测试结果属于历史记录。

## 覆盖

- 主对话输入、消息数、滚动位置；工具非敏感草稿、扩大/恢复、返回、关闭、前进后退；确认账号变化后清空工作区。
- 预览零 API 调用、旧学生工具链接、8 站导览、独立运营台/赞助页/信用验证/旧演示。
- 桌面并排、窄屏全屏，输入区可见、页面无横向溢出；全屏焦点循环、Escape 和焦点恢复。
- 原资金提议的 session/pending ID 精确打开，不创建新 session；密码取消后清空；成功确认后刷新失败有重试，不重复提交。
- 工具重开读取最新记录；记账草稿保留，赞助 token 隐藏后清空；移动端 API 错误在工具内可见。
- 真实业务链：规划→选校→成本→贷款试算→确认计划→入学→记账→家庭只读关联；资金助手；钱包汇款；换汇/账本；付款结算对账；贷款；消费 CSV 导入重算；方案比较；信用签发/匿名验证；家庭资助；运营审批。
- 金融原有断言仍在：错误密码、独立审批人、禁止学生操作运营接口、过期、版本冲突、响应丢失后的幂等恢复、余额/账本核对。

调试过程的失败报告保留在 `output/workspace-mocked-*` / `output/workspace-integration-*` 中，不覆盖最终报告。修复了旧页面/弹窗定位、依赖读取次数自动审批的 mock、消费预测异步计算的空状态假设；滚动位置断言允许恢复列宽时 3px 的浏览器舍入差异。没有删除金融权限或金额断言来使测试通过。

## 验证环境与复现

- Python：仓库 `studyFlow/Scripts/python.exe`。
- 数据库：`studyflow_workspace_20261012`，连接本地 PostgreSQL 55433；执行现有迁移及 `createcachetable`，没有在默认开发库执行迁移。
- 临时 Django 8042、Vite 5194、mock readiness worker 已在交付前停止；数据库保留。临时 Vite 配置已移除。
- 用户原有开发服务 8000/5173 保留；5173 首页与 `/api/auth/session/` 已检查为 HTTP 200。先前 8031/5191 验证栈与 Docker 8098 未在本轮重建或停止。

在 `backend/` 下，验证服务与 worker 两个终端均使用：

```powershell
$env:DB_NAME='studyflow_workspace_20261012'
$env:STUDYFLOW_MODE='mock'
$env:STUDYFLOW_READINESS_ENABLED='true'
$env:STUDYFLOW_CONSUMPTION_ENABLED='true'
../studyFlow/Scripts/python.exe manage.py runserver 127.0.0.1:8042 --noreload
# 另一个终端，同样的环境变量：
# ../studyFlow/Scripts/python.exe manage.py readiness_worker --mode mock
```

Vite 独立验证配置（放到忽略的 output 目录，`root` 改为实际绝对路径）：

```javascript
export default {
  root: 'D:/Qoder-project/AI studyflow/frontend',
  server: { host: '127.0.0.1', port: 5194, strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8042', changeOrigin: false } } }
};
```

从 `frontend/` 执行 `node node_modules/vite/bin/vite.js --config <配置路径>`。E2E 终端设置同样的数据库与 mock 环境变量，再执行：

```powershell
$env:PYTHON='D:/Qoder-project/AI studyflow/studyFlow/Scripts/python.exe'
$env:CHROMIUM_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:TEST_URL='http://127.0.0.1:5194'
$env:STUDYFLOW_TEST_OUTPUT='D:/Qoder-project/AI studyflow/output/workspace-new-run'
node node_modules/@playwright/test/cli.js test --project=integration
# mocked 使用同一前端即可；另设输出目录后：
# node node_modules/@playwright/test/cli.js test --project=mocked
```

学校示例标识、早稻田/马来亚费用估算偏差、只支持 THB 的贷款，以及「标记已付」仅记录、未接付款模块的限制均保留。

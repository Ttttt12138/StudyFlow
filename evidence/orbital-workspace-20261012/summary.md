# 常驻阶段状态栏 — 2026-10-12

本轮按用户选择的「阶段轨道 + 线框地球 + 预算弧线 + 账单时间轴」效果图修改现有学生工作区。没有提交、推送或部署，没有后端 API、数据库迁移或金融计算改动。

## 改动与数据边界

- `JourneyRail.tsx`：三个真实阶段，已到达阶段可返回对应对话视图，当前真实阶段仍高亮；保留草稿和现有引导。学校地理信息优先来自匹配学校的历史目录卡，缺少时只读现有 `planning/schools/<key>/`；失败显示地点待确认。
- `StatusRail.tsx`：咨询展示计划费用/可用资金/缺口；准备展示计划日期及相关提醒；生活展示本月预算及最近待付账单。读取已有 conversation/in-school 响应，沿用业务成功刷新机制。
- 预算零值/无效值不编造占比；超预算显示真实百分比，弧线最多画满；未换算支出明确标注。最近账单只选择 DUE，按日期优先展示逾期项；保留原币种，不合并为支出。
- 换汇/汇款入口在钱包面板定位 `convert/quote`，URL 保存允许的 section，记账的 expense section 也可恢复。原 finance session/pending 行为保留。
- ≥1280px 两侧常驻；1100–1279px 保留右侧，左侧可由「进度与状态」打开；<1100px 两侧收进状态弹窗。打开工具隐藏摘要，主对话保持挂载。
- 素材：内置 image_gen 生成透明地球和低对比背景，已放入 `frontend/public/images/`；未改动介绍页。Phosphor 图标按文件导入，避免开发模式加载全量图标。真实数值使用可访问文字和 SVG 数据图表。

## 验证

| 层级 | 结果 | 证据 |
|---|---|---|
| 类型检查 / 生产构建 | 通过 | `npm run build` 包含 `tsc --noEmit`；保留原大包警告 |
| 前端单测 | 155/155 | 17 个文件；新增 6 项覆盖比例、空值、账单排序、学校匹配、日期和导航白名单 |
| 相关 mocked 浏览器 | 22/22 | `output/orbital-workspace-20261012/green/report/index.html` |
| 最终视觉/焦点/导航复核 | 11/11 | `output/orbital-workspace-20261012/final/report/index.html`；与上一组有重叠，不相加当独立测试数 |
| 真实 Django 规划 E2E | 1/1 | `output/orbital-workspace-20261012/real/report/index.html` |
| 开发缓存隔离复核 | 5173、5194 各 1/1 | `dev-port-final/`、`cache-isolation-final/`；同一只读工具导航用例，不计为两个独立场景 |
| 视觉对照 | 通过 | 根目录 `design-qa.md`，以及 `comparison-final/` 的全图/局部合成对照 |

真实后端验证使用 Python `studyFlow/Scripts/python.exe`、Django 8042、Vite 5194、独立 PostgreSQL 库 `studyflow_workspace_20261012`。模型为规则 mock，汇率为 fixture；没有调用 live 网关。流程覆盖选校、贷款试算、确认计划、报到、回看准备、记账、月度窗口和家庭只读关联。

18 张最终阶段/尺寸/语言截图以及参考状态、手机弹窗截图位于 `output/orbital-workspace-20261012/final/`。最终对照为 1586×992、DPR 1。视觉检查范围详见 `design-qa.md`，不把所有截图生成等同逐张人工验收。

## 首轮问题与保留证据

- 红灯单测先因缺少 `status.ts` 失败，随后实现并通过。
- `initial/` 保留首次浏览器结果：一次开发资源 `ERR_NO_BUFFER_SPACE` 导致空页，改用图标逐文件导入后后续两轮通过；另一次测试夹具残留旧 bills 数组，修正夹具使 bills/upcoming_bills 一致。
- 最后检查原 5173 时出现 React `useContext` 空引用白屏；原开发与临时验证服务共享 Vite 依赖缓存。为验证服务设置独立 cacheDir，并在 Vite 配置显式 dedupe React/React DOM 后，两个端口分别通过只读浏览器导航用例，生产构建再次通过。首次失败记录保留在 `dev-port/`。
- 保留 `initial/`、`green/`、`final/`、`real/` 以及前几轮所有历史证据。

## 环境与交付

5194 前端与 8042 独立验证后端保持运行，方便本地预览；只读入口 `http://127.0.0.1:5194/?plan=preview&stage=school`。原开发前端 5173 已通过实际浏览器只读导航验证，刷新原页面即可读取这次源码改动。5173 的 Vite 配置变更触发自动重载；没有手动停止原开发服务，没有重启 8000，也没有重建 Docker。5194 使用 `output/orbital-workspace-20261012/vite.config.mjs` 和独立缓存。

早稻田/马来亚估算偏差、THB 贷款限制和「标记已付」只是记录等原有限制不变。地球为装饰，未实现地图交互或按学校旋转定位；日期到达不改变实际入学状态。

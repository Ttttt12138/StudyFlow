# 消费学习与资金执行验证

日期：2026-10-05（Asia/Bangkok）。验证对象是统一 Django 后端、PostgreSQL、C 本地包和真实 loopback HTTP；没有前端或真实银行资金执行。

## 结果

| 检查 | 结果 |
|---|---|
| Django `finance auto_test` | 142 项通过，包含 PostgreSQL 并发、迁移与旧工作流回归 |
| C 模块 pytest | 134 项通过；从 `studyflow-ai` 目录运行 |
| 迁移漂移检查 | `makemigrations --check --dry-run` 无变化 |
| API 契约 | OpenAPI `--validate --fail-on-warn` 通过，更新根 `openapi.yaml` |
| 新增模块静态检查 | Ruff 通过；Python 编译检查通过 |
| 完整模拟演示 | `demo_consumption --runs 3` 三轮通过，使用独立身份、真实 HTTP 和 PostgreSQL |

详细运行输出保存在本地 gitignored `output/consumption-tests.txt`、`output/consumption-c-tests.txt`、`output/consumption-http-demo.json`。

## 演示链路

1. 导入固定三个月合成消费，分类、识别周期费用、产生校准修订；钱包余额不变。
2. 运营签发 Sponsor 链接，受限预览与确认；确认本身不产生钱包余额。
3. 比较 Express / Standard / Economy 三条模拟路线；排除无法按学费截止日到账的更便宜路线。
4. 按所选报价模拟到账，上传并确认学费发票，核验模拟收款人。
5. 从 readiness funding run 创建付款，经用户授权、提交、模拟结算取得 receipt，再匹配发票核销。
6. 模拟贷款放款后导入消费上涨样例，主动简报识别未来月供现金缺口。

## 核心回归覆盖

- 重复导入、跨文件交易 ID 去重、无 ID 合法同额消费、错误行、非 THB、退款关联和跨用户隔离。
- 校准保留原预算、部分期间不能降低估算、单一周期费用按预计日期预测、分析变更使支付授权失效。
- 学生不能自确认家庭资金、不能签发链接；链接旋转/撤销、幂等重放和两个并发决定只允许一个成功。
- 两个并发导入确认不重复保存交易；历史未核验家庭资金降级且已到账/期初资金不变。
- 学费 receipt 与发票一致时核销；未知支付结果保持占款，重复结算只产生一笔账本扣款；发票不匹配保留异常。
- 模板升级先预览再确认，保留既有个人费用；扫描件进入人工转录，继续提取和用户确认，不伪造 OCR 成功。
- 规划余额确认不充值钱包；消费日期晚于余额锚点时要求重新确认，资料不足不能显示资金安全。

## 明确边界

消费导入首版仅支持 THB，周期识别为月度规则，报价和资金执行全为模拟。Sponsor 信任依赖演示运营端交付，不代表真实身份认证。模板新增的第二学校/城市是明确的 Synthetic 样例。OCR 仅接口和人工转录路径；无真实 OCR 引擎。本轮未验证真实材料准确率、银行 API、浏览器或生产部署。

迁移 `0008`–`0012` 已应用到本地 demo 数据库。部署时应先迁移，再通过 `STUDYFLOW_CONSUMPTION_ENABLED=true` 启用消费学习；家庭资助权限收紧始终生效。

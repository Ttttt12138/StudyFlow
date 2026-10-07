# B 借贷模块测试复跑记录

用户请求“进行这些测试”后的独立复跑。日期：2026-10-04（Asia/Bangkok）。
本轮未修改业务源码，未调用真实支付或模型服务。

| 项目 | 实际结果 |
|---|---|
| B 完整测试 | 46 passed，0 failed，0 errors，0 skipped；6.94 秒 |
| C 原项目回归 | 130 passed，0 failed，0 errors，0 skipped；2.45 秒 |
| 金额及日期计算 | 零息、非零利率、手续费、尾差守恒、月末、闰年及非法输入通过 |
| 审批与生命周期 | 缺资料复核、足额批准、不足拒绝、取消、版本冲突、放款前复查、逐期还款与结清通过 |
| 资金一致性 | 真实 PostgreSQL 下并发放还款、同键重试、不同键重复操作、余额不足、异常回滚通过 |
| 权限与契约 | 角色限制、跨学生隔离、C 报价保真、缺资料提示、已到账资金不可重分配、原到账日期保留通过 |
| 独立完整演示 | UNDER_REVIEW → APPROVED → DISBURSED；12 期全部 PAID，贷款 CLOSED，最终余额 0.00 THB |
| 数据库重启恢复 | 实际重启本项目 PostgreSQL；业务快照摘要一致，旧放款幂等键返回原结果，不重新记账 |
| 重启后 HTTP 服务 | /health 返回 ok；/openapi.json 可访问，19 个路径；无令牌访问 /api/v1/wallet 返回 401 |
| 迁移与静态检查 | Alembic 为 0002 head，无 ORM 差异；Ruff、pip check 通过 |

## 本轮证据

- [B 测试 JUnit](../output/verification-rerun-1791124268386/backend-junit.xml)
- [C 测试 JUnit](../output/verification-rerun-1791124268386/c-junit.xml)
- [完整 B/C 演示 JSON](../output/verification-rerun-1791124268386/demo-with-c.json)
- [重启前快照摘要](../output/verification-rerun-1791124268386/restart-snapshot.json)

数据库集成测试使用 studyflow_b_test 内的独立随机 schema，结束后只清理该测试 schema。
完整演示使用 studyflow_b_demo 内的新模拟身份，保留历史演示数据。
重启仅针对本项目 Compose 的 db 服务，服务已恢复。

本轮涵盖已交付后端与 C 契约；A 前端尚未接入，因此不包含页面点击、页面错误提示及浏览器端到端测试。
预算仍为显式演示夹具，不属于完整预算与真实授信验收。

# 命题 C 实现决策记录

本文件记录尚未由团队拍板、实现中先采用的默认值。修改默认值只需改配置，不需要重写逻辑；每项注明生效位置。

| ID | 决策 | 默认值 | 状态 | 生效位置 |
|---|---|---|---|---|
| D1 | 本币（预算、借款、学费结算） | THB | 默认 | `STUDYFLOW_HOME_CURRENCY`（W1） |
| D2 | 钱包与汇款支持币种 | THB、CNY、USD、EUR | 默认 | `STUDYFLOW_SUPPORTED_CURRENCIES`（W1） |
| D3 | 汇路 | CNY/USD/EUR→THB、THB→CNY，各 express/standard/economy 三档 | 默认 | `Corridor` 种子数据（W1） |
| D4 | 单笔/日限额（T2） | THB 50,000/100,000；CNY 10,000/20,000；USD 1,500/3,000；EUR 1,400/2,800 | 默认 | `finance/policy.py`（W2B） |
| D5 | Step-up 方式 | 重新输入密码，签发 5 分钟范围令牌；不引入 TOTP 依赖 | 默认 | W2B |
| D6 | 汇率来源 | Frankfurter（ECB 每日参考价），CI 与测试使用固定数据；真实网络调用需单独批准 | 默认 | `STUDYFLOW_FX_LIVE`（W2A） |
| D7 | Agent 模型 | 沿用 C 的 LLM 配置；CI 用 mock 规则 planner；live 调用需单独批准 | 默认 | W4 |
| D8 | 多语言 | zh-hans、en；暂不含泰语 | 默认 | W5 |
| D9 | 信用建立 | 内部准时记录档案（模拟），不对接征信、不输出数值评分 | 默认 | W4 |

## 已确定

- 前端（缺口第 7 项）不在本轮范围。
- 借款引擎维持 B 的 THB-only 契约；多币种只作用于钱包余额、换汇和汇款。

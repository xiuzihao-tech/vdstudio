---
id: points
name: 积分规则
category: rule
version: 1.0.0
order: 41
summary: 点数怎么算、样片打几折、新用户送多少、充值套餐、诊断价格
---
# 积分规则（点数）

**口径**：1 点≈1 秒成片（`secondsPerPoint`）。前台叫「点」（`pointName`），后台叫积分。

| 字段 | 说明 |
|---|---|
| `sampleRate` | 样片价 = 成片价 × 这个比例（默认 0.4，四成） |
| `sampleMin` | 样片最低收几点 |
| `minCost` | 改时长后成片最低收几点 |
| `initialPoints` | 新访客（没注册也有）的试用点数；`null` = 跟服务器环境变量 INITIAL_POINTS |
| `signupBonus` | 注册成功再送几点（所有人都有；被邀请的人另外还有邀请奖励） |
| `lowBalance` | 余额低于这个数时前台提醒充值 |
| `diagPrice` | 大哲诊断账号解锁价（分）。89900 = ¥899 |
| `orderTtlMin` | 订单多少分钟不付自动关闭 |
| `packages` | 充值套餐：`id` 固定别改、`n` 名称、`price` 价格（分）、`points` 点数、`bonus` 赠送、`tag` 角标 |

**注意**：价格是占位，要按上游（方舟 Seedance）的实际计费和毛利定。后台「积分系统」页有表单，改的就是这里。

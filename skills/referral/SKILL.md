---
id: referral
name: 邀请赠送
category: rule
version: 1.0.0
order: 42
summary: 分享链接 → 好友注册双方得点；好友充值邀请人返点；首充奖励；防刷规则
---
# 邀请赠送

**流程**：用户在「余额与充值 → 邀请有礼」拿到自己的链接（`/?ref=邀请码`）和海报 → 好友点开（记点开数）→ 用这个链接注册（记邀请关系）→ 按 `invite.rewardOn` 发注册奖励 → 好友以后充值，邀请人按 `rebate` 返点。

| 字段 | 说明 |
|---|---|
| `enabled` | 总开关；关掉后链接还能打开，但不发奖励 |
| `invite.inviterPoints` / `invite.inviteePoints` | 好友注册：邀请人得几点 / 好友多得几点 |
| `invite.rewardOn` | 什么时候发：`register` 注册就发、`first_gen` 好友第一次出片后发（防假号）、`first_pay` 好友第一次充值后发 |
| `invite.dailyCap` / `invite.monthlyCap` | 一个邀请人每天 / 每月最多奖励几位 |
| `invite.ipDailyLimit` | 同一个网络（IP）一天内用同一个邀请码注册超过几个就不奖励 |
| `rebate.rate` | 好友充值时，邀请人得「好友买到的点数 × rate」 |
| `rebate.scope` | `first` 只返首充、`all` 每次都返 |
| `rebate.days` | 注册后多少天内的充值才返 |
| `rebate.capPerInvitee` | 一个好友最多给邀请人返多少点 |
| `firstRecharge.fixed` / `firstRecharge.rate` | 首次充值的人自己额外得：固定几点 + 买到点数的比例 |
| `shareDaily` | 每天第一次分享送几点（0 = 不送；分享没法核实，建议保持 0） |
| `shareTitle` / `shareText` | 分享文案（复制链接、海报上用） |
| `rules` | 给用户看的规则说明，`{inviter}` `{invitee}` `{rate}` `{days}` `{dailyCap}` `{monthlyCap}` 会换成上面的值 |

自己邀请自己（同一个账号）不奖励；后台「邀请赠送」能看每一条邀请记录，发现刷号可以「收回奖励」。

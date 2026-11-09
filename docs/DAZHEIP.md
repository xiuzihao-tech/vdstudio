# 接进 dazheip.com：夏工那边要改的

dazheip 现有的 7 个菜单、页面、登录都不动，只在左侧菜单「制作封面图文」后面加两项：

| 菜单名 | 打开 | 说明 |
| --- | --- | --- |
| 视频 IP（新） | `https://video.dazheip.com/` | 今天、生成视频、AI 运营、知识库与形象、我的作品 |
| 口播数字人（新） | `https://video.dazheip.com/talk` | 建形象和声音 → 按风格写口播稿 → 数字人出镜出片 |

视频站部署在子域名 `video.dazheip.com`，左侧菜单和 dazheip 一模一样：原有的 7 项链回 `www.dazheip.com` 对应页面，学员在两边来回点感觉是一个网站。

## 部署

- 构建时设 `DAZHEIP_URL=https://www.dazheip.com`（默认就是这个），菜单里原有的 7 项链到主站。
- `MODULES_PRESET=phase1`：只开一期。口播数字人、声音复刻、数字人形象已经算一期。

## 第二步：一个账号（要夏工配合）

1. dazheip 的登录 Cookie 设在 `.dazheip.com`（现在 `/api/me` 未登录返回 401，登录后返回当前用户）。
2. 视频站收到请求时，带着这个 Cookie 去调 `https://www.dazheip.com/api/me` 拿用户 ID 和手机号，自动对上视频站的账号，学员不用再登录一次。
3. 视频站读 `/api/personas` 当人设档案；dazheip 写好的文案加一个「生成视频」按钮，带着文案跳到 `video.dazheip.com/gen`。

## 要和夏工确认

- 登录 Cookie 能不能设到 `.dazheip.com`，`/api/me` 返回哪些字段。
- 点数和「解锁 AI 运营」记在哪边。
- 菜单里两个新入口的位置和名字。

## 后台（11/9）：视频站的后台做成了 dazheip 后台的样子

视频站后台在 `video.dazheip.com/admin`，长得和 dazheip 后台一样（明黄侧栏、「管理权限」、「管理菜单」、描边数据块、黑表头表格），
菜单把 dazheip 原有的几项和视频站的新功能排在一起，原有的几项链回 `DAZHEIP_ADMIN_URL`（默认 `https://www.dazheip.com/admin/<页面>`）。
详细说明见 `docs/后台与技能.md`。

**夏工那边要改的（最少）**：dazheip 后台的「管理菜单」里加这几项，直接链到视频站后台：

| 菜单名 | 链到 | 放在哪 |
| --- | --- | --- |
| 技能中心（新） | `https://video.dazheip.com/admin/skills` | 合规规则后面 |
| 上游接口（新） | `https://video.dazheip.com/admin/upstreams` | 技能中心后面 |
| 积分系统（新） | `https://video.dazheip.com/admin/points` | 会员管理后面 |
| 邀请赠送（新） | `https://video.dazheip.com/admin/referral` | 积分系统后面 |
| 充值订单 | `https://video.dazheip.com/admin/orders` | 邀请赠送后面 |
| 出片任务（新） | `https://video.dazheip.com/admin/jobs` | 充值订单后面 |

要和夏工确认：

- dazheip 后台里每个菜单的真实地址（`DAZHEIP_ADMIN_URL` 下面的 `knowledge` `strategy` `persona` `samples` `compliance` `members` `notice` `service` `course` `settings` 是按菜单名猜的，`src/server/admin-routes.ts` 的 `DAZHEIP_MENU` 里改）。
- 后台账号要不要打通：现在视频站后台认 `ADMIN_EMAILS` 和视频站「后台账号」里加的邮箱；打通以后可以按 dazheip 的「管理权限」直接给角色。
- dazheip 的「数据总览」要不要也显示视频站的数：调 `GET https://video.dazheip.com/api/admin/dashboard`（要后台账号的 Cookie，跨域要把 dazheip 后台域名加进 `CORS_ORIGINS`），里面有用户、订单、收入、出片、积分、邀请的数。
- 积分（点数）记在视频站这边：充值、出片扣点、邀请赠送都在视频站的数据库里；dazheip 的「会员记录」「已支付订单」要不要合并统计。

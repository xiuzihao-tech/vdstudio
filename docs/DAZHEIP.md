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

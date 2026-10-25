# 上线路线图

> 开发总指引：现在到哪一步、接下来每一步改哪些文件、做完怎么验证、需要你提供什么。
> 已完成的功能清单见 `PLAN.md`，部署操作见 `DEPLOY.md`，小范围验证方法见 `VALIDATION.md`。

## 一、现在的状态（2026-10-24）

| 项 | 状态 |
|---|---|
| 功能 | 选题文案、简易生成、制作台（基础版）、素材库、排期与 AI 预选题、账号、邀请制、管理后台、额度与开关、埋点与反馈、整条视频合成 |
| 文案 AI | **OpenLux**（`https://api.openlux.ai/v1`，OpenAI 兼容），已实测通过 |
| 视频 AI | **土豆 API**（`https://api.ai-tudou.net/v1`，new-api 异步视频端点 `/videos/generations`），已实测生成一条 4 秒样片 |
| 运行 | 你的 Mac 上双击 `启动.command`；部署包（Docker + Caddy）已备好，还没上线 |

### 选定的模型（后台「AI 服务」→「用推荐配置」一键填入，随时可改，不用重启）

| 用途 | 模型 | 价格（按两站价格页） | 为什么 |
|---|---|---|---|
| 文案（默认） | `deepseek-v4.1-flash` | 输入约 $0.3 / 百万 token | 中文写作好、快、便宜 |
| 文案（✦ 精写） | `deepseek-v4-pro` | 约默认的 4 倍 | 开头钩子和细节更讲究 |
| 文案（备用） | `deepseek-v4-flash` | 同默认 | 主模型出错时自动顶上（已实测可用） |
| 视频 · Seedance 2.5 | `seedance-2.5` | 0.6 / 秒 | 画质最好，4–30 秒，720p |
| 视频 · Seedance 2.0 | `seedance-2.0` | 0.33 / 秒 | 支持真人脸，4–15 秒，720p |
| 视频 · Seedance 2.0 Fast | `seedance-2.0-fast` | 0.25 / 秒 | 更快，已实测 124 秒出片 |
| 视频 · 万相 3.0 | `wan3.0` | 720p 0.2 / 秒、1080p 0.25 / 秒 | 便宜、支持 1080p、2–30 秒 |
| 视频 · 样片 | `seedance-2.0-mini` | 0.15 / 秒 | 开了样片模式先用它出 480p 看效果 |

土豆上的 Seedance 系列标注为「720p 满血版」，所以这几个档位在页面上最高只能选 720p，选了更高会自动退档。

## 二、文件规划

✅ 已有　🆕 本轮新增　✏️ 本轮修改　⏳ 以后

```
src/
├─ shared/                     前后端共用（类型、规则、校验）
│  ├─ catalog.ts        ✏️    模型档位 + 中转站实际能力（TUDOU_CAPS）
│  ├─ gen.ts            ✏️    分镜、费用、冲突检查；当前生效的档位目录
│  └─ types.ts / schemas.ts / copy.ts / schedule.ts   ✅
├─ server/
│  ├─ index.ts          ✏️    启动入口：加载配置 → 上线自检 → 开服务
│  ├─ config.ts         ✏️    所有环境变量集中在这里
│  ├─ startup-check.ts  🆕    上线自检：生产环境缺关键配置就拒绝启动
│  ├─ app.ts            ✏️    路由；CORS（前后端分开部署时用）；请求 ID 日志
│  ├─ storage/          🆕    文件存储
│  │  ├─ index.ts             Storage 接口：put / get / url / delete
│  │  ├─ local.ts             本机磁盘（现在）
│  │  └─ s3.ts                S3 兼容（阿里云 OSS / 腾讯云 COS / AWS），签名自己算，不加依赖
│  ├─ services.ts       ✏️    生成任务：每镜视频转存到自己的存储；任务可恢复
│  ├─ providers/              AI 供应方
│  │  ├─ llm.ts         ✏️    文案：默认 / 精写 / 备用模型
│  │  ├─ newapi-video.ts ✏️   土豆视频：拆成「提交」和「查询」两步，便于重启后接着查
│  │  └─ seedance.ts / mock.ts / types.ts   ✅
│  ├─ compose.ts        ✅    ffmpeg 合成整条
│  ├─ auth.ts           ✅    邮箱登录；⏳ 手机验证码 / 微信登录在这里加
│  ├─ repo.ts / ops.ts / db.ts   ✅  数据访问（⏳ 换 Postgres 只动这三个）
│  └─ http.ts           ✅
└─ web/
   ├─ config.ts         🆕    前端配置：API_BASE（前后端分开部署时指向后端域名）
   ├─ api.ts            ✏️    所有请求走 API_BASE
   ├─ store.tsx         ✏️    拿到会话后同步档位目录
   └─ pages/、ui/       ✏️    文案页「精写」、后台「AI 服务」
deploy/                 ✅    Docker、Caddy、备份；✏️ 加 S3 / CORS 配置示例
scripts/check-ai.mjs    ✅    实测两个站
docs/                   ✏️    本文件、DEPLOY、VALIDATION
```

## 三、一步一步

每一步做完都会：跑单元测试 + 浏览器端到端测试 → 提交 → 推到 GitHub。

| 步骤 | 做什么 | 改哪些文件 | 怎么算完成 |
|---|---|---|---|
| **A0 定模型** ✅ | 按两站价格和能力选模型；档位按中转站实际能力限制；样片低价模型；文案精写与备用 | catalog、gen、llm、newapi-video、Admin、Copy | 单测通过；后台能一键填推荐配置 |
| **B1 存储层** | Storage 接口；生成好的每镜视频和整条视频都转存到自己的存储（中转站的视频链接会过期） | storage/*、services、app、config | 本地：`data/files` 里有视频；S3：用假 S3 单测通过 |
| **B2 任务可恢复** | 记下每镜在中转站的任务 ID；服务重启后接着查，不白花钱 | newapi-video、services、repo、db | 单测：生成到一半重启，任务最后成功 |
| **B3 本地图生视频** | 没有公网地址时，首帧素材图直接用 base64 发给中转站 | services、app | 你 Mac 上选一张素材图生成，视频画面以这张图开头 |
| **B4 上线预留** | 前端 API_BASE；CORS 白名单；生产环境启动自检；每个请求带请求 ID 记日志 | web/config、api、app、startup-check、index | 单测：生产模式缺 `FILE_SIGN_SECRET` 等配置时拒绝启动 |
| **B5 实跑** | 在你 Mac 上：拉代码 → 重启 → 用真实模型走一遍「选题 → 精写 → 样片 → 成片」 | — | 作品页能播放并下载整条视频 |
| C 上线 | 见下一节 | | |

## 四、正式上线需要你准备的

1. **服务器 + 域名**：2 核 4G 起。服务器放国内的话，域名要先做 **ICP 备案**（1–3 周，最好现在就办）。
2. **对象存储**：阿里云 OSS 或腾讯云 COS 建一个桶，开 CDN；把 AccessKey 填进服务器的 `.env`（B1 做完就能用）。
3. **合规**：页面和成片已标「AI 生成」。面向公众提供生成服务，需按《生成式人工智能服务管理暂行办法》使用已备案的模型、做好内容审核；上线前建议咨询一下法务。
4. **收费**（如需要）：微信 / 支付宝商户号。点数流水表已经有了，接支付时只加充值入口。
5. 然后按 `DEPLOY.md` 部署，`VALIDATION.md` 邀请第一批人试用。

## 五、安全约定

- 两把密钥只在你 Mac 上的 `.env` 里（已在 `.gitignore`），**绝不提交到 GitHub**；仓库目前是**公开**的。
- 密钥在聊天里出现过，正式上线前请在两个站各重新生成一把，旧的作废，再填进服务器的 `.env`。
- 两个站后台都建议设一个消费上限，和本站的「全站每日预算」形成双保险。

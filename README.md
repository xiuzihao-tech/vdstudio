# FIND AI × 大哲 · 联合视频平台

选题文案 → 生成视频 → 排期发布。由交互原型 `FIND_AI_大哲_联合视频平台_预览_v2.html` 工程化而来。

## 快速开始

需要 Node.js 22.13 以上（用到内置的 `node:sqlite`）。

**本地试用（推荐）：**

```bash
npm run local        # 第一次会自动装依赖、生成 .env、构建，然后启动并打开浏览器
```

用 `admin@local.test` 注册的账号是管理员，顶栏会出现“后台”。不填 AI 密钥时一切走模拟。

**手动：**

```bash
npm install
npm run build        # 打包前端到 dist/web、服务端到 dist/server.js
npm start            # http://localhost:5173
```

上线部署见 `docs/DEPLOY.md`，小规模验证怎么做见 `docs/VALIDATION.md`。

开发时：`npm run dev`（前端 esbuild 监听 + 服务端 tsx 热重载）。

| 命令 | 作用 |
|---|---|
| `npm test` | 领域规则单元测试 + 接口集成测试（内存数据库，Mock 零延迟） |
| `npm run test:e2e` | 先 `npm run build`，再用 Playwright 走一遍主链路并截图 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run seed:reset` | 清空本地数据库，下次启动重建种子数据 |

环境变量见 `.env.example`：复制为 `.env`，用 `node --env-file=.env dist/server.js` 启动。不填密钥时一切走 Mock。

## 接入真实 AI

| 能力 | 怎么开 | 说明 |
|---|---|---|
| 文案大模型 | 填 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` | 兼容 OpenAI Chat Completions 的服务都行（豆包/方舟、DeepSeek 等）。接管：写文案、改写、活人感优化、案例策划出选题、深挖角度。对标拆解和按素材出选题仍是 Mock（需要视频/图片理解，下一轮做） |
| Seedance 视频 | 填 `ARK_API_KEY` | 每一镜建一个方舟生成任务，并发 2 个、轮询到结束。设了 `PUBLIC_BASE_URL` 才会把素材图作为首帧（签名链接，2 小时有效） |

真实视频服务目前返回的是**每镜一段**视频，页面上逐镜连播；把多段合成一条、配音、配乐、字幕需要 ffmpeg 合成服务，列在下一轮。方舟返回的视频地址 24 小时过期，正式上线前要转存到自己的对象存储。

## 账号

邮箱 + 密码（scrypt 哈希），会话 30 天。默认允许匿名试用，注册时匿名期间的内容原样带进账号；`AUTH_REQUIRED=1` 则必须登录。上线请同时设 `SECURE_COOKIES=1`。

## 目录

```
src/
  shared/        前后端共用：类型、目录数据、zod 校验、业务规则
    types.ts       领域模型
    catalog.ts     人设、镜头结构、模型、选题分类、违禁词（从原型迁移）
    copy.ts        文案：时长估算、违禁词（含上下文例外）、裁剪、改写兜底
    gen.ts         生成：分镜拆分、费用、冲突检查与修复项
    schedule.ts    排期：两周窗口、发布日、预选题挑选顺序、格子状态
    schemas.ts     接口入参校验
  server/
    app.ts         路由与静态文件（见 docs/API.md）
    services.ts    工作区种子、排期补齐/挪动、生成任务（扣点、失败退点）
    repo.ts        数据访问
    db.ts          SQLite 与迁移
    providers/     AI 供应方接口与 Mock 实现
  web/
    store.tsx      会话、路由、弹层、提示、跨页交接
    ui/            基础组件、外壳、素材选择器、排期选择器
    pages/         首页、选题文案（ip/）、生成视频、制作台、排期、作品与素材
    styles.css     设计变量与样式（四套主题，移植自原型）
tests/unit/      node:test
tests/e2e/       Playwright 冒烟
docs/            开发计划、接口文档
```

## 关键设计

- **AI 都在接口后面。** `providers/types.ts` 定义了选题、文案、视频、声音、转写五个接口；现在只有 Mock。接真实服务时新增实现、在 `providers/index.ts` 加一个分支，页面和路由不用改。
- **规则前后端共用。** 冲突检查、费用、分镜拆分在前端实时显示，提交时后端用同一份代码再算一遍，以后端为准。
- **工作区 = 一个身份。** 切换人设就是切换工作区，选题、草稿、素材、排期各自独立。未登录时用匿名 Cookie，登录后归到账号下。
- **扣点有账。** 每次生成先扣点再跑，失败或服务重启自动退点，流水在 `ledger` 表。

## 现状与限制

- 不填密钥时 AI 能力全部是 Mock：结果确定、可离线跑。真实适配器已用假服务器测过请求格式，还没用真实密钥跑过。
- 热门选题、课程是示意数据。
- 制作台是基础版（逐镜台词、时长、景别、运镜、首帧、排序）；原型里的机位摇杆、多版本对比、时间线在下一轮移植。
- 开发环境里没有 `@types/react`，前端是用一份宽松的 React 类型替身做的类型检查，加上构建和端到端测试验证；GitHub 上的 CI 会用真实类型再查一遍。

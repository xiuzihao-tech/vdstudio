# FIND AI × 大哲 · 联合视频平台

选题文案 → 生成视频 → 排期发布。由交互原型 `FIND_AI_大哲_联合视频平台_预览_v2.html` 工程化而来。

## 快速开始

需要 Node.js 22.13 以上（用到内置的 `node:sqlite`）。

```bash
npm install
npm run build        # 打包前端到 dist/web、服务端到 dist/server.js
npm start            # http://localhost:5173
```

开发时：`npm run dev`（前端 esbuild 监听 + 服务端 tsx 热重载）。

| 命令 | 作用 |
|---|---|
| `npm test` | 领域规则单元测试 + 接口集成测试（内存数据库，Mock 零延迟） |
| `npm run test:e2e` | 先 `npm run build`，再用 Playwright 走一遍主链路并截图 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run seed:reset` | 清空本地数据库，下次启动重建种子数据 |

环境变量：`PORT`、`DATA_DIR`（默认 `./data`，数据库与上传文件都在这里）、`AI_PROVIDER`（默认 `mock`）、`MOCK_DELAY_MS`（Mock 延迟）、`TODAY`（固定“今天”，测试用）。

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
- **工作区 = 一个身份。** 切换人设就是切换工作区，选题、草稿、素材、排期各自独立。现在用 Cookie 识别匿名用户，M6 换成正式登录。
- **扣点有账。** 每次生成先扣点再跑，失败或服务重启自动退点，流水在 `ledger` 表。

## 现状与限制

- AI 能力全部是 Mock：结果确定、可离线跑，但不是真的生成视频或调用大模型。
- 热门选题、课程是示意数据。
- 制作台是基础版（逐镜台词、时长、景别、运镜、首帧、排序）；原型里的机位摇杆、多版本对比、时间线在下一轮移植。
- 在开发环境里，服务端与共享层做过 `tsc` 类型检查；前端 TSX 因为环境里没有 `@types/react`，是靠构建和端到端测试验证的。装好依赖后请跑一次 `npm run typecheck`。

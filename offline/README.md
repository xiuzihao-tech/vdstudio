# 离线单文件版

`npm run build:offline` → `dist/视频站-离线版.html`（约 2 MB）。双击就能用，不用联网、不用装 Node。

- 真正的后端代码（`src/server/app.ts`）跑在浏览器里：数据库用 sql.js（浏览器里的 SQLite），上传的文件和数据库存在这台电脑浏览器的 IndexedDB 里，刷新后还在。
- 前端照常请求 `/api/...`，`offline/server.ts` 把请求接过来交给后端处理，不经过网络。
- AI 全部是模拟结果；没有 ffmpeg，所以不合成整条视频、读不到视频时长。
- 默认「只开一期」。用 `admin@demo.local` 注册就是管理员，能进后台改模块开关。
- 左下角「清空演示数据」回到新账号。
- `offline/shims/` 是 Node 内置模块（fs、sqlite、crypto、http 等）在浏览器里的最小替身，只实现了后端用到的部分。

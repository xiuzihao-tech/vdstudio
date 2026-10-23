# 部署与小规模线上验证

## 方式一：本机跑（先自己试）

需要 Node.js 22.13 以上。

```bash
npm install
npm run build
cp .env.example .env        # 按需填写
npm run start:env           # = node --env-file=.env dist/server.js
```

打开 http://localhost:5173 。想进后台：在 `.env` 里写 `ADMIN_EMAILS=你的邮箱`，重启后用这个邮箱注册。
想要合成整条视频，本机需要装 ffmpeg（macOS：`brew install ffmpeg`；Windows：`winget install ffmpeg`）。

## 方式二：一台云服务器（给 20–50 人试用）

推荐配置：2 核 4G 的轻量应用服务器（阿里云 / 腾讯云），Ubuntu 22.04，开放 80、443 端口。
**面向中国大陆用户、用自己的域名，需要先完成 ICP 备案**；备案期间可以先用海外区服务器，或只给内部同事试用。

1. 装 Docker：`curl -fsSL https://get.docker.com | sh`
2. 把代码放到服务器（`git clone` 或上传压缩包），进入目录
3. 填配置：
   ```bash
   cp .env.example .env
   cp deploy/.env.example deploy/.env      # 写上你的域名 DOMAIN=...
   ```
   验证期建议的 `.env`：
   ```
   AUTH_REQUIRED=1
   INVITE_REQUIRED=1
   ADMIN_EMAILS=你的邮箱
   INITIAL_POINTS=600          # 每人起步点数
   DAILY_JOBS_PER_USER=10      # 每人每天最多生成 10 次
   DAILY_BUDGET_POINTS=3000    # 全站每天最多花 3000 点，超了自动停
   PUBLIC_BASE_URL=https://你的域名
   FILE_SIGN_SECRET=一串长随机字符
   LLM_BASE_URL=... LLM_API_KEY=... LLM_MODEL=...   # 文案模型
   ARK_API_KEY=...                                   # Seedance
   ```
4. 域名 A 记录指到服务器 IP，然后：
   ```bash
   cd deploy && docker compose up -d --build
   ```
   Caddy 会自动申请 HTTPS 证书。`docker compose logs -f app` 看日志；`curl https://你的域名/healthz` 应返回 `{"ok":true,...}`。
5. 用 `ADMIN_EMAILS` 里的邮箱注册（管理员不需要邀请码）→ 顶栏「后台」→「邀请码」生成链接，发给试用者。

### 日常运维

| 要做什么 | 怎么做 |
|---|---|
| 临时停掉所有生成（发现花费异常） | 后台 → 概览 → 关掉「生成开放中」 |
| 给某人加点 | 后台 → 用户 → ＋500 点 |
| 看用户反馈 | 后台 → 反馈 |
| 更新版本 | `git pull && cd deploy && docker compose up -d --build` |
| 备份 | `backup` 容器每天自动做一份，保留 14 份，在数据卷的 `/data/backups` |
| 恢复备份 | 停掉 app，把备份文件复制成 `/data/app.db`，再启动 |

## 上线前检查

- [ ] `.env` 里 `AUTH_REQUIRED=1`、`INVITE_REQUIRED=1`（`SECURE_COOKIES` 由 compose 自动设为 1）
- [ ] 设了 `DAILY_BUDGET_POINTS`，并在方舟控制台也设了消费上限（双保险）
- [ ] 设了 `FILE_SIGN_SECRET`（否则重启后旧的首帧链接失效）
- [ ] 用一个普通账号走一遍：注册 → 出选题 → 写文案 → 生成 → 下载
- [ ] `/healthz` 正常；`docker compose ps` 三个容器都在运行

## 已知限制

- 单机 SQLite，适合几十人规模；人多了换 Postgres（见 PLAN.md M7）。
- 生成任务在进程内跑，重启时进行中的任务会失败并自动退点。
- 合成整条视频目前只有画面和字幕，没有配音和配乐（TTS 接入后补）。
- Docker 镜像在开发环境里没能完整构建（沙箱连不上 apt / npm 源），第一次在服务器上构建时请留意日志。

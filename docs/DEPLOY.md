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
   SECRETS_KEY=另一串长随机字符   # 后台「上游接口」里填的密钥用它加密，设了别改
   LLM_BASE_URL=... LLM_API_KEY=... LLM_MODEL=...   # 文案模型（也可以上线后在后台「上游接口」里填）
   ARK_API_KEY=...                                   # Seedance
   ```
4. 域名 A 记录指到服务器 IP，然后：
   ```bash
   cd deploy && docker compose up -d --build
   ```
   Caddy 会自动申请 HTTPS 证书。`docker compose logs -f app` 看日志；`curl https://你的域名/healthz` 应返回 `{"ok":true,...}`。
5. 用 `ADMIN_EMAILS` 里的邮箱注册（管理员不需要邀请码）→ 打开 `https://你的域名/admin` 用同一个账号登录后台 →「兑换码与邀请码」生成链接，发给试用者。后台怎么用见 `docs/后台与技能.md`。

### 日常运维

| 要做什么 | 怎么做 |
|---|---|
| 临时停掉所有生成（发现花费异常） | 后台 → 数据总览 → 最下面关掉「生成开放中」；或 上游接口 → 视频用哪家 → 模拟 |
| 给某人加点 / 扣点 | 后台 → 积分系统 → 手动调整（要写原因，记操作日志） |
| 用户说片子不满意要退点 | 后台 → 出片任务 → 人工退点（每条一次） |
| 改价格、提示词、邀请奖励 | 后台 → 积分系统 / 技能中心 / 邀请赠送（存版本，能回滚） |
| 换大模型、视频、支付的密钥 | 后台 → 上游接口 → 测试连接 → 保存（马上生效，不用重启） |
| 看用户反馈 | 后台 → 用户反馈 |
| 谁改了什么 | 后台 → 操作日志 |
| 更新版本 | `git pull && cd deploy && docker compose up -d --build` |
| 备份 | `backup` 容器每天自动做一份，保留 14 份，在数据卷的 `/data/backups` |
| 恢复备份 | 停掉 app，把备份文件复制成 `/data/app.db`，再启动 |

## 上线前检查

- [ ] `.env` 里 `AUTH_REQUIRED=1`、`INVITE_REQUIRED=1`（`SECURE_COOKIES` 由 compose 自动设为 1）
- [ ] 设了 `DAILY_BUDGET_POINTS`，并在 OpenLux、土豆两个站的后台也设了消费上限（双保险）
- [ ] 设了 `FILE_SIGN_SECRET`（`openssl rand -hex 32` 生成）和 `ADMIN_EMAILS`——没设的话服务**会拒绝启动**，`docker compose logs app` 里能看到缺什么
- [ ] 设了 `SECRETS_KEY`（同样 `openssl rand -hex 32`），没设启动时会提醒；`DEMO_ADMIN_LOGIN` 不能设
- [ ] 文件存储：建好 OSS / COS 桶，填 `STORAGE=s3` 和 `S3_*`（见 `.env.example`）；先用本机存储也行，但要备份数据卷
- [ ] 两个 AI 站的密钥换成新生成的（旧的在聊天里出现过）
- [ ] 后台「上游接口」：文案大模型、视频、支付逐个「测试连接」都通过
- [ ] 后台「邀请赠送」「积分系统」里的奖励和价格改成定好的数（现在是占位）
- [ ] 用一个普通账号走一遍：注册 → 出选题 → 写文案 → 生成 → 下载
- [ ] `/healthz` 正常；`docker compose ps` 三个容器都在运行

## 已知限制

- 单机 SQLite，适合几十人规模；人多了换 Postgres（见 PLAN.md M7）。
- 生成任务在进程内跑，重启时进行中的任务会失败并自动退点。
- 合成整条视频目前只有画面和字幕，没有配音和配乐（TTS 接入后补）。
- Docker 镜像在开发环境里没能完整构建（沙箱连不上 apt / npm 源），第一次在服务器上构建时请留意日志。

// 启动入口。环境变量见 .env.example
import { join } from 'node:path';
import { createApp } from './app.ts';
import { configFromEnv } from './config.ts';
import { checkConfig, reportConfig } from './startup-check.ts';

const port = Number(process.env.PORT ?? 5173);
const dataDir = process.env.DATA_DIR ?? 'data';
const cfg = configFromEnv();
// 上线自检：生产环境缺关键配置就不启动
if (!reportConfig(checkConfig(cfg, process.env))) process.exit(1);
const { server } = createApp({ ...cfg, dbFile: join(dataDir, 'app.db'), dataDir, webDir: process.env.WEB_DIR ?? 'dist/web' });
// 收到停止信号时先停止接新请求，再退出（Docker 重启时不切断正在上传的请求）
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => { console.log(`收到 ${sig}，正在停止…`); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 10_000).unref(); });
server.listen(port, () => console.log(`FIND AI × 大哲 已启动：http://localhost:${port}`));

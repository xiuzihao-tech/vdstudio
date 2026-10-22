// 启动入口。环境变量见 .env.example
import { join } from 'node:path';
import { createApp } from './app.ts';
import { configFromEnv } from './config.ts';

const port = Number(process.env.PORT ?? 5173);
const dataDir = process.env.DATA_DIR ?? 'data';
const { server } = createApp({ ...configFromEnv(), dbFile: join(dataDir, 'app.db'), dataDir, webDir: process.env.WEB_DIR ?? 'dist/web' });
server.listen(port, () => console.log(`FIND AI × 大哲 已启动：http://localhost:${port}`));

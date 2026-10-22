// 启动入口。环境变量见 .env.example
import { join } from 'node:path';
import { createApp } from './app.ts';

const port = Number(process.env.PORT ?? 5173);
const dataDir = process.env.DATA_DIR ?? 'data';
const { server } = createApp({ dbFile: join(dataDir, 'app.db'), dataDir, webDir: process.env.WEB_DIR ?? 'dist/web', authRequired: process.env.AUTH_REQUIRED === '1', secureCookies: process.env.SECURE_COOKIES === '1' });
server.listen(port, () => console.log(`FIND AI × 大哲 已启动：http://localhost:${port}`));

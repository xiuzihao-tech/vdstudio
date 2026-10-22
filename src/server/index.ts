// 启动入口。环境变量：PORT（默认 5173）、DATA_DIR（默认 ./data）、AI_PROVIDER（默认 mock）、TODAY（测试时固定日期）
import { join } from 'node:path';
import { createApp } from './app.ts';

const port = Number(process.env.PORT ?? 5173);
const dataDir = process.env.DATA_DIR ?? 'data';
const { server } = createApp({ dbFile: join(dataDir, 'app.db'), dataDir, webDir: process.env.WEB_DIR ?? 'dist/web' });
server.listen(port, () => console.log(`FIND AI × 大哲 已启动：http://localhost:${port}`));

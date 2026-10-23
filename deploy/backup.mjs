// 数据库在线备份：用 SQLite 的 VACUUM INTO 生成一致的快照，保留最近 N 份。
// 用法：node deploy/backup.mjs   （环境变量 DATA_DIR、BACKUP_DIR、BACKUP_KEEP）
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const data = process.env.DATA_DIR ?? 'data';
const dir = process.env.BACKUP_DIR ?? join(data, 'backups');
const keep = Number(process.env.BACKUP_KEEP ?? 14);
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const out = join(dir, `app-${stamp}.db`);
const db = new DatabaseSync(join(data, 'app.db'));
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();
const all = readdirSync(dir).filter(f => /^app-.*\.db$/.test(f)).sort();
for (const f of all.slice(0, Math.max(0, all.length - keep))) rmSync(join(dir, f));
console.log(`备份完成：${out}（保留最近 ${keep} 份）`);

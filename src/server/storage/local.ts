// 本机磁盘存储（开发、单机部署）：文件在 DATA_DIR/files 下。
import { mkdirSync, existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { safeKey, type Storage } from './index.ts';

export function makeLocalStorage(root: string): Storage {
  const base = resolve(root);
  mkdirSync(base, { recursive: true });
  const pathOf = (key: string) => join(base, safeKey(key));
  return {
    kind: 'local',
    async put(key, data) { const p = pathOf(key); mkdirSync(dirname(p), { recursive: true }); await writeFile(p, data); },
    async get(key) { try { return await readFile(pathOf(key)); } catch { return null; } },
    async delete(key) { await rm(pathOf(key), { force: true }); },
    localPath(key) { const p = pathOf(key); return existsSync(p) ? p : null; },
  };
}

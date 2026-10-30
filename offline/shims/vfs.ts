// 浏览器里的小文件系统：文件放内存，同时存进 IndexedDB（刷新后还在）。只实现服务端用到的那几个函数。
import { Buffer } from 'buffer';
export const files = new Map<string, Uint8Array>();
const dirs = new Set<string>(['/']);
const norm = (p: string) => ('/' + String(p)).replace(/\/+/g, '/').replace(/\/$/, '') || '/';

/* ---------- IndexedDB 持久化 ---------- */
const DBN = 'findai-offline', ST = 'kv';
let idb: IDBDatabase | null = null;
export async function openStore(): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  try {
    idb = await new Promise<IDBDatabase>((ok, no) => { const r = indexedDB.open(DBN, 1); r.onupgradeneeded = () => r.result.createObjectStore(ST); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    await new Promise<void>((ok) => {
      const tx = idb!.transaction(ST, 'readonly'), c = tx.objectStore(ST).openCursor();
      c.onsuccess = () => { const cur = c.result; if (cur) { out.set(String(cur.key), new Uint8Array(cur.value as ArrayBuffer)); cur.continue(); } else ok(); };
      c.onerror = () => ok();
    });
  } catch { idb = null; }
  return out;
}
export function idbPut(k: string, v: Uint8Array | null) {
  if (!idb) return;
  try { const tx = idb.transaction(ST, 'readwrite'); if (v) tx.objectStore(ST).put(v.slice().buffer, k); else tx.objectStore(ST).delete(k); } catch { /* 存不了就只在内存 */ }
}
export function idbClear() { if (!idb) return Promise.resolve(); return new Promise<void>(ok => { const tx = idb!.transaction(ST, 'readwrite'); tx.objectStore(ST).clear(); tx.oncomplete = () => ok(); tx.onerror = () => ok(); }); }
export function loadFiles(saved: Map<string, Uint8Array>) { for (const [k, v] of saved) if (k.startsWith('f:')) files.set(k.slice(2), v); }

/* ---------- node:fs ---------- */
export function mkdirSync(p: string) { dirs.add(norm(p)); }
export function existsSync(p: string) { const n = norm(p); return files.has(n) || dirs.has(n) || [...files.keys()].some(k => k.startsWith(n + '/')); }
export function readFileSync(p: string, enc?: string) { const b = files.get(norm(p)); if (!b) { const e: any = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e; } const buf = Buffer.from(b); return enc ? buf.toString(enc as BufferEncoding) : buf; }
export function writeFileSync(p: string, data: string | Uint8Array) { const n = norm(p), b = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data); files.set(n, b); if (!n.startsWith('/tmp/')) idbPut('f:' + n, b); }
export function rmSync(p: string) { const n = norm(p); for (const k of [...files.keys()]) if (k === n || k.startsWith(n + '/')) { files.delete(k); idbPut('f:' + k, null); } dirs.delete(n); }
let tmpN = 0;
export function mkdtempSync(prefix: string) { const d = `${prefix}${Date.now().toString(36)}${tmpN++}`; dirs.add(norm(d)); return d; }
export function statSync(p: string) { const n = norm(p); const isFile = files.has(n); if (!isFile && !existsSync(n)) { const e: any = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e; } return { isDirectory: () => !isFile, isFile: () => isFile, size: files.get(n)?.length ?? 0, mtimeMs: Date.now() }; }
export function createReadStream(p: string) { return { pipe(res: { end: (b: Uint8Array) => void }) { res.end(files.get(norm(p)) ?? new Uint8Array()); } }; }
export function cpSync() { /* 不需要 */ }
export function readdirSync() { return []; }
export const promises = {
  readFile: async (p: string, enc?: string) => readFileSync(p, enc),
  writeFile: async (p: string, d: string | Uint8Array) => writeFileSync(p, d),
  rm: async (p: string) => rmSync(p),
  mkdir: async (p: string) => mkdirSync(p),
};
export const { readFile, writeFile, rm, mkdir } = promises;
export default { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, mkdtempSync, statSync, createReadStream, cpSync, readdirSync, promises };

// 离线单文件版的「服务端」：把真正的后端代码（src/server/app.ts）跑在浏览器里。
// 数据库是浏览器里的 SQLite（sql.js），文件和数据库都存进 IndexedDB；AI 全部用模拟结果。
// 前端照常 fetch('/api/...')，这里把请求接过来交给后端的 handle()，不经过网络。
import initSqlJs from 'sql.js/dist/sql-asm.js';
import { Buffer } from 'buffer';
import { setSqlJs } from './shims/sqlite.ts';
import { files, idbClear, loadFiles, openStore } from './shims/vfs.ts';
import { getHandler } from './shims/misc.ts';

const W = window as any;
const ENV = { AI_PROVIDER: 'mock', MOCK_DELAY_MS: '600', ADMIN_EMAILS: 'admin@demo.local', MODULES_PRESET: 'phase1', INITIAL_POINTS: '1280' };
Object.assign((globalThis as any).process.env, ENV);

const JAR = 'findai.offline.cookies';
const jar: Record<string, string> = (() => { try { return JSON.parse(localStorage.getItem(JAR) ?? '{}'); } catch { return {}; } })();
const saveJar = () => { try { localStorage.setItem(JAR, JSON.stringify(jar)); } catch { /* 忽略 */ } };

async function boot() {
  const saved = await openStore();
  loadFiles(saved);
  const SQL = await initSqlJs();
  setSqlJs(SQL, saved.get('db') ?? null);
  const { createApp } = await import('../src/server/app.ts');
  createApp({ dbFile: '/data/app.db', dataDir: '/data', webDir: '/web', env: ENV as any, modulesPreset: 'phase1', adminEmails: ['admin@demo.local'] });
  const handle = getHandler()!;

  const realFetch = window.fetch.bind(window);
  W.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('/')) return realFetch(input as RequestInfo, init);
    const headers: Record<string, string> = {};
    new Headers(init.headers ?? {}).forEach((v, k) => { headers[k] = v; });
    headers.cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const b = init.body;
    const bodyBuf = b == null ? Buffer.alloc(0) : typeof b === 'string' ? Buffer.from(b) : b instanceof Blob ? Buffer.from(await b.arrayBuffer()) : b instanceof ArrayBuffer ? Buffer.from(b) : Buffer.from(String(b));
    const req = { url, method: (init.method ?? 'GET').toUpperCase(), headers, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { if (bodyBuf.length) yield bodyBuf; } };
    return await new Promise<Response>(resolve => {
      const hs: Record<string, string> = {};
      const fin: (() => void)[] = [];
      const cookies: string[] = [];
      const res: any = {
        statusCode: 200, headersSent: false,
        setHeader(k: string, v: string | string[]) { if (k.toLowerCase() === 'set-cookie') cookies.push(...(Array.isArray(v) ? v : [v])); else hs[k.toLowerCase()] = String(v); },
        getHeader(k: string) { return hs[k.toLowerCase()]; },
        writeHead(s: number, h: Record<string, string> = {}) { res.statusCode = s; for (const [k, v] of Object.entries(h)) hs[k.toLowerCase()] = String(v); res.headersSent = true; return res; },
        on(ev: string, f: () => void) { if (ev === 'finish') fin.push(f); return res; },
        end(data?: string | Uint8Array) {
          for (const sc of cookies) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i).trim(), v = kv.slice(i + 1); if (/Max-Age=0\b/.test(sc) || !v) delete jar[k]; else jar[k] = v; }
          if (cookies.length) saveJar();
          const status = res.statusCode || 200;
          const body = status === 204 || status === 304 ? null : data == null ? '' : data;
          resolve(new Response(body as BodyInit | null, { status, headers: hs }));
          fin.forEach(f => f());
        },
      };
      handle(req, res);
    });
  };

  // <img src="/files/...">、<video src> 不走 fetch：换成内存里那份文件的 blob 地址
  const cache = new Map<string, string>();
  W.__offlineFileUrl = (u: string) => {
    const rel = decodeURIComponent(u.split('?')[0].slice(7)), p = `/data/files/${rel}`;
    const b = files.get(p); if (!b) return undefined;
    let x = cache.get(p); if (!x) { const ext = rel.split('.').pop()?.toLowerCase() ?? ''; const type = ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4' } as Record<string, string>)[ext] ?? 'application/octet-stream'; x = URL.createObjectURL(new Blob([b.slice()], { type })); cache.set(p, x); }
    return x;
  };
  W.__offlineReset = async () => { await idbClear(); try { localStorage.clear(); } catch { /* 忽略 */ } location.hash = ''; location.reload(); };
  W.__HASH_ROUTES = true;
}

boot().then(() => {
  const src = document.getElementById('webapp')!.textContent!;
  const s = document.createElement('script'); s.textContent = src; document.body.appendChild(s);
  document.getElementById('boot')?.remove();
}).catch(e => { console.error(e); const el = document.getElementById('boot'); if (el) el.textContent = `启动失败：${(e as Error).message}`; });

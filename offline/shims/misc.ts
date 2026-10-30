// node:os / node:util / node:child_process / node:http 的最小替身
export const tmpdir = () => '/tmp';
export const platform = () => 'browser';
export const homedir = () => '/';
export function promisify(fn: (...a: any[]) => void) { return (...a: any[]) => new Promise((ok, no) => fn(...a, (e: Error | null, v: unknown) => e ? no(e) : ok(v))); }
// 浏览器里没有 ffmpeg：合成、读时长都走「没有 ffmpeg」的分支
export function spawnSync() { return { status: 1, stdout: '', stderr: '', error: new Error('浏览器版没有 ffmpeg') }; }
export function spawn() { const h: Record<string, ((...a: any[]) => void)[]> = {}; const p = { stdout: { on() {} }, stderr: { on() {} }, on(ev: string, f: (...a: any[]) => void) { (h[ev] ??= []).push(f); if (ev === 'error' || ev === 'close') setTimeout(() => ev === 'error' ? f(new Error('浏览器版没有 ffmpeg')) : f(1), 0); return p; }, kill() {} }; return p; }
let handler: ((req: any, res: any) => void) | null = null;
export function createServer(h: (req: any, res: any) => void) { handler = h; return { listen(_p?: unknown, cb?: () => void) { cb?.(); return this; }, close(cb?: () => void) { cb?.(); }, address: () => ({ port: 0 }), on() { return this; } }; }
export const getHandler = () => handler;
export default { tmpdir, platform, homedir, promisify, spawnSync, spawn, createServer };

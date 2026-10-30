// 服务端代码会调 setTimeout(...).unref()：浏览器的计时器返回数字，没有 unref，这里包一层
const wrap = (id: ReturnType<typeof globalThis.setTimeout>) => ({ id, unref() { return this; }, ref() { return this; }, hasRef: () => false, [Symbol.toPrimitive]: () => id });
const idOf = (x: any) => (x && typeof x === 'object' && 'id' in x ? x.id : x);
export const setTimeout = (f: (...a: any[]) => void, ms?: number, ...a: any[]) => wrap(globalThis.setTimeout(f, ms, ...a));
export const setInterval = (f: (...a: any[]) => void, ms?: number, ...a: any[]) => wrap(globalThis.setInterval(f, ms, ...a));
export const clearTimeout = (x: any) => globalThis.clearTimeout(idOf(x));
export const clearInterval = (x: any) => globalThis.clearInterval(idOf(x));
import { Buffer as B } from 'buffer';
// buffer 包不认 base64url（会话令牌用它）：补上
const toS = B.prototype.toString;
(B.prototype as any).toString = function (enc?: string, ...a: any[]) { return enc === 'base64url' ? toS.call(this, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : toS.call(this, enc as any, ...a); };
const fromS = B.from as any;
(B as any).from = function (v: any, enc?: any, ...a: any[]) { if (enc === 'base64url' && typeof v === 'string') { v = v.replace(/-/g, '+').replace(/_/g, '/'); enc = 'base64'; } return fromS.call(B, v, enc, ...a); };
export const Buffer = B;
export const process = (globalThis as any).process ?? ((globalThis as any).process = { env: {}, cwd: () => '/', versions: {}, platform: 'browser', on() {}, exit() {}, nextTick: (f: () => void) => queueMicrotask(f), hrtime: { bigint: () => BigInt(Math.round(performance.now() * 1e6)) } });

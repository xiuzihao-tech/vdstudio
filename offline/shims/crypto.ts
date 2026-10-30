// node:crypto 里服务端用到的几个：随机数、HMAC/哈希（js-sha256）、密码派生（演示用，够用就行）。
import { Buffer } from 'buffer';
import { sha256 } from 'js-sha256';
export const randomBytes = (n: number) => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(n)));
export const randomUUID = () => globalThis.crypto.randomUUID();
const out = (bytes: number[] | ArrayBuffer, enc?: string) => { const b = Buffer.from(bytes as ArrayBuffer); return enc ? b.toString(enc as BufferEncoding).replace(...(enc === 'base64url' ? [/=+$/, ''] as const : [/$^/, ''] as const)) : b; };
export function createHmac(_alg: string, key: string | Uint8Array) {
  const h = sha256.hmac.create(typeof key === 'string' ? key : Array.from(key));
  const api = { update(d: string | Uint8Array) { h.update(typeof d === 'string' ? d : Array.from(d)); return api; }, digest(enc?: string) { const b = Buffer.from(h.arrayBuffer()); return enc === 'base64url' ? b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : enc ? b.toString(enc as BufferEncoding) : b; } };
  return api;
}
export function createHash(_alg: string) {
  const h = sha256.create();
  const api = { update(d: string | Uint8Array) { h.update(typeof d === 'string' ? d : Array.from(d)); return api; }, digest(enc?: string) { const b = Buffer.from(h.arrayBuffer()); return enc ? b.toString(enc as BufferEncoding) : b; } };
  return api;
}
export function timingSafeEqual(a: Uint8Array, b: Uint8Array) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i]; return r === 0; }
export function scrypt(pw: string, salt: Uint8Array, len: number, cb: (e: Error | null, k?: Buffer) => void) {
  let h = sha256.array(Buffer.concat([Buffer.from(salt), Buffer.from(pw)]));
  for (let i = 0; i < 2000; i++) h = sha256.array(h.concat(Array.from(salt)));
  const k = Buffer.alloc(len); for (let i = 0; i < len; i++) k[i] = h[i % h.length] ^ (i >> 5);
  setTimeout(() => cb(null, k), 0);
}
void out;

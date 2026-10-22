// 极简 HTTP 工具：路由匹配、JSON 读写、Cookie、错误。没有引入框架，迁移到 Next.js/Hono 时路由处理函数可直接搬。
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

export interface Req { raw: IncomingMessage; method: string; path: string; query: URLSearchParams; params: Record<string, string>; cookies: Record<string, string> }
export type Handler = (req: Req, res: ServerResponse) => Promise<unknown> | unknown;

interface Route { method: string; re: RegExp; keys: string[]; h: Handler }
export class Router {
  private routes: Route[] = [];
  on(method: string, pattern: string, h: Handler) {
    const keys: string[] = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    this.routes.push({ method, re, keys, h });
    return this;
  }
  get(p: string, h: Handler) { return this.on('GET', p, h); }
  post(p: string, h: Handler) { return this.on('POST', p, h); }
  put(p: string, h: Handler) { return this.on('PUT', p, h); }
  patch(p: string, h: Handler) { return this.on('PATCH', p, h); }
  delete(p: string, h: Handler) { return this.on('DELETE', p, h); }
  match(method: string, path: string) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = path.match(r.re);
      if (m) return { h: r.h, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
}

export function parseCookies(h?: string): Record<string, string> {
  return Object.fromEntries((h ?? '').split(';').map(s => s.trim()).filter(Boolean).map(s => { const i = s.indexOf('='); return [s.slice(0, i), decodeURIComponent(s.slice(i + 1))]; }));
}

export async function readBuffer(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new HttpError(413, `文件太大，上限 ${Math.round(limit / 1024 / 1024)}MB`); chunks.push(c as Buffer); }
  return Buffer.concat(chunks);
}

export async function body<S extends ZodTypeAny>(req: Req, schema: S): Promise<z.infer<S>> {
  const buf = await readBuffer(req.raw, 1024 * 1024);
  let data: unknown;
  try { data = buf.length ? JSON.parse(buf.toString('utf8')) : {}; } catch { throw new HttpError(400, '请求体不是合法的 JSON'); }
  return schema.parse(data);
}

export function send(res: ServerResponse, status: number, data: unknown) {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

export function sendError(res: ServerResponse, e: unknown) {
  if (e instanceof HttpError) return send(res, e.status, { error: e.message });
  if (e instanceof ZodError) return send(res, 400, { error: '参数不对', issues: e.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
  console.error(e);
  send(res, 500, { error: '服务器出错了，稍后再试' });
}

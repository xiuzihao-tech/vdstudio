// S3 兼容对象存储（阿里云 OSS、腾讯云 COS、AWS S3、MinIO 等）。AWS Signature V4 自己算，不引入 SDK。
//   阿里云 OSS：S3_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com   S3_REGION=oss-cn-hangzhou
//   腾讯云 COS：S3_ENDPOINT=https://cos.ap-guangzhou.myqcloud.com  S3_REGION=ap-guangzhou   S3_BUCKET=<桶名-APPID>
//   MinIO：     S3_ENDPOINT=http://127.0.0.1:9000  S3_FORCE_PATH_STYLE=1
// 桶保持私有；浏览器下载用限时签名链接，配了 CDN（S3_PUBLIC_BASE_URL）就直接用 CDN 地址。
import { createHash, createHmac } from 'node:crypto';
import { safeKey, type Storage } from './index.ts';

export interface S3Config {
  endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string;
  pathStyle?: boolean; publicBaseUrl?: string; prefix?: string; fetch?: typeof fetch;
}

const EMPTY_SHA = createHash('sha256').update('').digest('hex');
const sha256 = (d: string | Buffer) => createHash('sha256').update(d).digest('hex');
const hmac = (k: string | Buffer, d: string) => createHmac('sha256', k).update(d).digest();
/** RFC 3986：除 A-Z a-z 0-9 - _ . ~ 外都编码 */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encPath = (p: string) => p.split('/').map(enc).join('/');
const amzDate = (d: Date) => d.toISOString().replace(/[:-]|\.\d{3}/g, '');

export function makeSigner(cfg: S3Config) {
  const ep = new URL(cfg.endpoint);
  const host = cfg.pathStyle ? ep.host : `${cfg.bucket}.${ep.host}`;
  const pathFor = (key: string) => `${cfg.pathStyle ? `/${cfg.bucket}` : ''}/${encPath(key)}`;
  const scope = (day: string) => `${day}/${cfg.region}/s3/aws4_request`;
  const signingKey = (day: string) => hmac(hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, day), cfg.region), 's3'), 'aws4_request');
  const signature = (canonical: string, stamp: string) => {
    const day = stamp.slice(0, 8);
    const toSign = ['AWS4-HMAC-SHA256', stamp, scope(day), sha256(canonical)].join('\n');
    return createHmac('sha256', signingKey(day)).update(toSign).digest('hex');
  };
  const query = (q: Record<string, string>) => Object.keys(q).sort().map(k => `${enc(k)}=${enc(q[k])}`).join('&');

  return {
    host,
    /** 请求头签名（PUT / GET / DELETE） */
    signHeaders(method: string, key: string, payloadHash: string, extra: Record<string, string> = {}, now = new Date()) {
      const stamp = amzDate(now);
      const h: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp };
      for (const [k, v] of Object.entries(extra)) h[k.toLowerCase()] = v.trim();
      const names = Object.keys(h).sort();
      const canonical = [method, pathFor(key), '', names.map(n => `${n}:${h[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
      const auth = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope(stamp.slice(0, 8))}, SignedHeaders=${names.join(';')}, Signature=${signature(canonical, stamp)}`;
      return { url: `${ep.protocol}//${host}${pathFor(key)}`, headers: { ...h, authorization: auth } };
    },
    /** 限时签名链接（GET） */
    presign(key: string, ttlSec: number, now = new Date()) {
      const stamp = amzDate(now);
      const q: Record<string, string> = {
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${cfg.accessKeyId}/${scope(stamp.slice(0, 8))}`,
        'X-Amz-Date': stamp, 'X-Amz-Expires': String(ttlSec), 'X-Amz-SignedHeaders': 'host',
      };
      const canonical = ['GET', pathFor(key), query(q), `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
      return `${ep.protocol}//${host}${pathFor(key)}?${query(q)}&X-Amz-Signature=${signature(canonical, stamp)}`;
    },
  };
}

export function makeS3Storage(cfg: S3Config): Storage {
  const f = cfg.fetch ?? fetch;
  const s = makeSigner(cfg);
  const full = (key: string) => `${(cfg.prefix ?? '').replace(/^\/+|\/+$/g, '')}${cfg.prefix ? '/' : ''}${safeKey(key)}`;
  const fail = async (what: string, r: Response) => new Error(`对象存储${what}失败（${r.status}）：${(await r.text().catch(() => '')).slice(0, 200)}`);
  return {
    kind: 's3',
    async put(key, data, mime) {
      const { url, headers } = s.signHeaders('PUT', full(key), sha256(data), { 'content-type': mime || 'application/octet-stream' });
      const r = await f(url, { method: 'PUT', headers, body: data as unknown as BodyInit, signal: AbortSignal.timeout(120_000) });
      if (!r.ok) throw await fail('上传', r);
    },
    async get(key) {
      const { url, headers } = s.signHeaders('GET', full(key), EMPTY_SHA);
      const r = await f(url, { headers, signal: AbortSignal.timeout(120_000) });
      if (r.status === 404) return null;
      if (!r.ok) throw await fail('读取', r);
      return Buffer.from(await r.arrayBuffer());
    },
    async delete(key) {
      const { url, headers } = s.signHeaders('DELETE', full(key), EMPTY_SHA);
      const r = await f(url, { method: 'DELETE', headers });
      if (!r.ok && r.status !== 404) throw await fail('删除', r);
    },
    directUrl(key, ttlSec = 3600) {
      if (cfg.publicBaseUrl) return `${cfg.publicBaseUrl.replace(/\/$/, '')}/${encPath(full(key))}`;
      return s.presign(full(key), ttlSec);
    },
  };
}

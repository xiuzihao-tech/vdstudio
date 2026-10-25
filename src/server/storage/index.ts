// 文件存储：上传的素材、转存的每镜视频、合成好的整条视频都走这里。
// 页面上的地址统一是 /files/<key>（权限在 app.ts 里检查）：本机存储直接读盘返回；S3 兼容存储则 302 跳到限时签名链接或 CDN 地址。
// 换存储（本机 → 阿里云 OSS / 腾讯云 COS / AWS S3）只改环境变量，数据库里存的 key 不变。
import { makeLocalStorage } from './local.ts';
import { makeS3Storage, type S3Config } from './s3.ts';

export interface Storage {
  kind: 'local' | 's3';
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  /** 本机存储：磁盘上的绝对路径（用来直接回传文件）；S3：没有 */
  localPath?(key: string): string | null;
  /** S3：给浏览器 / 视频服务的直接下载地址（CDN 或限时签名链接） */
  directUrl?(key: string, ttlSec?: number): string;
}

/** key 只能是「工作区 ID / 文件名」这种相对路径，不能跳出存储根目录 */
export function safeKey(key: string): string {
  const k = key.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!k || k.split('/').some(p => p === '..' || p === '.' || p === '')) throw new Error(`非法的文件路径：${key}`);
  return k;
}

export type StorageEnv = { STORAGE?: string; S3_ENDPOINT?: string; S3_REGION?: string; S3_BUCKET?: string; S3_ACCESS_KEY_ID?: string; S3_SECRET_ACCESS_KEY?: string; S3_FORCE_PATH_STYLE?: string; S3_PUBLIC_BASE_URL?: string; S3_PREFIX?: string };

export function makeStorage(env: StorageEnv, filesDir: string, opts: { fetch?: typeof fetch } = {}): Storage {
  if ((env.STORAGE ?? 'local') === 's3') {
    const need = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
    const miss = need.filter(k => !env[k]);
    if (miss.length) throw new Error(`STORAGE=s3 但缺少：${miss.join('、')}`);
    const cfg: S3Config = {
      endpoint: env.S3_ENDPOINT!, region: env.S3_REGION || 'us-east-1', bucket: env.S3_BUCKET!,
      accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      pathStyle: env.S3_FORCE_PATH_STYLE === '1', publicBaseUrl: env.S3_PUBLIC_BASE_URL || undefined, prefix: env.S3_PREFIX || '', fetch: opts.fetch,
    };
    return makeS3Storage(cfg);
  }
  return makeLocalStorage(filesDir);
}

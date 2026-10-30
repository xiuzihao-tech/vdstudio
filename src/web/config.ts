// 前端配置（构建时写入）。
// API_BASE：后端地址。默认为空 = 前后端同一个域名（现在的部署方式）。
// 以后前端放 CDN、后端单独一台机器时，构建前设 API_BASE=https://api.你的域名 即可，后端要在 CORS_ORIGINS 里放行前端域名。
declare const process: { env: Record<string, string | undefined> };
export const API_BASE = (process.env.API_BASE ?? '').replace(/\/$/, '');
/** 跨域部署时请求要带上 Cookie */
export const CREDENTIALS: RequestCredentials = API_BASE ? 'include' : 'same-origin';
/** 后端返回的 /files/... 地址补上后端域名；完整网址原样返回 */
const offlineFile = typeof window !== 'undefined' ? (window as unknown as { __offlineFileUrl?: (u: string) => string | undefined }).__offlineFileUrl : undefined;
export const fileUrl = (u: string | null | undefined): string | undefined => (!u ? undefined : offlineFile && u.startsWith('/files/') ? offlineFile(u) : u.startsWith('/') ? `${API_BASE}${u}` : u);

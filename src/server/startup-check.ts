// 上线自检：生产环境（NODE_ENV=production）缺关键配置时拒绝启动，其余给出提醒。
// 开发、本机试用不拦，只打印提醒。
import type { Config } from './config.ts';

export interface CheckResult { errors: string[]; warnings: string[] }

export function checkConfig(cfg: Config, env: NodeJS.ProcessEnv): CheckResult {
  const errors: string[] = [], warnings: string[] = [];
  const prod = env.NODE_ENV === 'production';
  const need = (ok: boolean, msg: string) => { if (!ok) (prod ? errors : warnings).push(msg); };

  need(cfg.secureCookies, 'SECURE_COOKIES 要设为 1（Cookie 只走 HTTPS）');
  need(!!cfg.fileSignSecret && cfg.fileSignSecret.length >= 32, 'FILE_SIGN_SECRET 要设一个至少 32 位的随机串（否则重启后签名链接全部失效，多台机器也对不上）');
  need(cfg.adminEmails.length > 0, 'ADMIN_EMAILS 要填管理员邮箱，否则没人能进后台');
  if (cfg.cookieSameSite === 'None' && !cfg.secureCookies) errors.push('COOKIE_SAMESITE=None 必须同时 SECURE_COOKIES=1（浏览器规定）');
  if (cfg.corsOrigins.some(o => o === '*')) errors.push('CORS_ORIGINS 不能用 *（要带 Cookie 必须写明域名）');

  if (prod) {
    if (!cfg.authRequired) warnings.push('AUTH_REQUIRED 不是 1：没登录的人也能用（匿名试用）');
    if (!cfg.inviteRequired) warnings.push('INVITE_REQUIRED 不是 1：任何人都能注册');
    if (!cfg.dailyBudget) warnings.push('DAILY_BUDGET_POINTS 是 0：全站每天的生成花费不封顶');
    if ((env.STORAGE ?? 'local') !== 's3') warnings.push('STORAGE 是 local：文件存在这台机器上，记得备份 DATA_DIR');
    if (!env.LLM_API_KEY) warnings.push('没配 LLM_API_KEY：文案是模拟结果');
    if (!env.VIDEO_API_KEY && !env.ARK_API_KEY) warnings.push('没配视频服务密钥：视频是模拟结果');
    if (!cfg.publicBaseUrl) warnings.push('没配 PUBLIC_BASE_URL：素材图会以 Base64 发给视频服务（大图会先压缩）');
  }
  return { errors, warnings };
}

/** 打印结果；生产环境有错误就返回 false（调用方退出） */
export function reportConfig(r: CheckResult, log: (s: string) => void = console.log): boolean {
  for (const w of r.warnings) log(`⚠ 提醒：${w}`);
  for (const e of r.errors) log(`✗ 配置错误：${e}`);
  if (r.errors.length) log('生产环境配置不完整，已停止启动。改好服务器上的 .env 再启动（说明见 docs/DEPLOY.md）。');
  return !r.errors.length;
}

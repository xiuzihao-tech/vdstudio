// 运行配置：全部来自环境变量（见 .env.example），启动时读一次。
export interface Config {
  authRequired: boolean; inviteRequired: boolean; secureCookies: boolean;
  adminEmails: string[]; initialPoints: number;
  /** 每个账号每天最多提交几次生成（0 = 不限） */
  dailyJobsPerUser: number;
  /** 全站每天最多花多少点在生成上（0 = 不限），超了自动拒绝新任务 */
  dailyBudget: number;
  publicBaseUrl?: string; fileSignSecret?: string;
  /** 合成整条视频：auto = 有 ffmpeg 就合成；off = 不合成 */
  compose: 'auto' | 'off'; subtitleFont?: string;
  /** 每个 IP 每分钟写请求上限 */
  rateLimit: number;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const num = (k: string, d: number) => (env[k] !== undefined && env[k] !== '' ? Number(env[k]) : d);
  return {
    authRequired: env.AUTH_REQUIRED === '1',
    inviteRequired: env.INVITE_REQUIRED === '1',
    secureCookies: env.SECURE_COOKIES === '1',
    adminEmails: (env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    initialPoints: num('INITIAL_POINTS', 1280),
    dailyJobsPerUser: num('DAILY_JOBS_PER_USER', 0),
    dailyBudget: num('DAILY_BUDGET_POINTS', 0),
    publicBaseUrl: env.PUBLIC_BASE_URL || undefined,
    fileSignSecret: env.FILE_SIGN_SECRET || undefined,
    compose: env.COMPOSE === 'off' ? 'off' : 'auto',
    subtitleFont: env.SUBTITLE_FONT || undefined,
    rateLimit: num('RATE_LIMIT_PER_MIN', 120),
  };
}

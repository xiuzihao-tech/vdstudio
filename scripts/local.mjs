// 本地一键启动：检查 Node 版本 → 首次自动安装依赖、生成 .env → 构建 → 启动并打开浏览器。
// 用法：node scripts/local.mjs     （只用 Node 自带模块，装依赖之前也能跑）
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { platform } from 'node:os';

const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  console.error(`需要 Node.js 22.13 或更高，当前是 ${process.versions.node}。到 https://nodejs.org 下载 LTS 版本。`);
  process.exit(1);
}
const npm = platform() === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args) => { const r = spawnSync(cmd, args, { stdio: 'inherit', shell: platform() === 'win32' }); if (r.status !== 0) process.exit(r.status ?? 1); };

if (!existsSync('node_modules/react')) { console.log('第一次运行，安装依赖…'); run(npm, ['install', '--no-audit', '--no-fund']); }
if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  // 本地试用：不强制登录、不要邀请码；第一个用 admin@local 注册的账号是管理员
  let env = readFileSync('.env', 'utf8');
  env = env.replace(/^AUTH_REQUIRED=.*$/m, 'AUTH_REQUIRED=0').replace(/^INVITE_REQUIRED=.*$/m, 'INVITE_REQUIRED=0').replace(/^ADMIN_EMAILS=.*$/m, 'ADMIN_EMAILS=admin@local.test');
  writeFileSync('.env', env);
  console.log('已生成 .env（本地试用配置）。要接真实 AI，填里面的 LLM_* 和 ARK_API_KEY 后重启。');
}
console.log('构建中…');
run(npm, ['run', 'build', '--silent']);

const port = (readFileSync('.env', 'utf8').match(/^PORT=(\d+)/m) ?? [])[1] ?? '5173';
const url = `http://localhost:${port}`;
const srv = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', '--env-file=.env', 'dist/server.js'], { stdio: 'inherit' });
setTimeout(() => {
  console.log(`\n打开 ${url}\n管理后台：用 admin@local.test 注册（密码自己定）后，顶栏会出现“后台”。按 Ctrl+C 停止。\n`);
  const opener = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
  spawn(opener, [url], { stdio: 'ignore', shell: platform() === 'win32', detached: true }).on('error', () => {}).unref();
}, 1200);
process.on('SIGINT', () => { srv.kill('SIGINT'); process.exit(0); });
srv.on('exit', c => process.exit(c ?? 0));

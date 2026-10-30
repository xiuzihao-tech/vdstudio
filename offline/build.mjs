// 打包离线单文件版：node offline/build.mjs → dist/视频站-离线版.html
// 后端（src/server）和前端（src/web）都打进一个 HTML，双击就能用，不用联网、不用装 Node。
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = new URL('./shims/', import.meta.url).pathname;
const alias = { 'node:fs': S + 'vfs.ts', fs: S + 'vfs.ts', 'node:fs/promises': S + 'fs-promises.ts', 'node:sqlite': S + 'sqlite.ts', 'node:crypto': S + 'crypto.ts', 'node:os': S + 'misc.ts', 'node:util': S + 'misc.ts', 'node:child_process': S + 'misc.ts', 'node:http': S + 'misc.ts', 'node:path': require.resolve('path-browserify'), path: require.resolve('path-browserify'), crypto: S + 'crypto.ts' };
const common = { bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2020', minify: true, legalComments: 'none', logLevel: 'warning', charset: 'utf8' };
const server = await esbuild.build({ ...common, entryPoints: ['offline/server.ts'], alias, inject: [S + 'timers.ts'], define: { 'import.meta.url': '"file:///offline.js"', global: 'globalThis' } });
const web = await esbuild.build({ ...common, entryPoints: ['src/web/main.tsx'], jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'process.env.API_BASE': '""' } });
const css = await esbuild.build({ ...common, entryPoints: ['src/web/styles.css'], format: undefined, loader: { '.css': 'css' } });
const idx = readFileSync('src/web/index.html', 'utf8');
const head = (idx.match(/<head>([\s\S]*?)<\/head>/) ?? [, ''])[1].replace(/<link[^>]*styles\.css[^>]*>/g, '').replace(/<script[^>]*src=[^>]*><\/script>/g, '').replace(/<link[^>]*(fonts\.googleapis|fonts\.gstatic)[^>]*>/g, '');
const bodyTag = (idx.match(/<body[^>]*>/) ?? ['<body>'])[0];
const esc = s => s.replace(/<\/script/gi, '<\\/script');
const html = `<!doctype html>
<html lang="zh-CN"><head>${head}
<title>FIND AI × 大哲 · 视频站（离线版）</title>
<style>${css.outputFiles[0].text}</style>
<style>#boot{position:fixed;inset:0;display:grid;place-items:center;font:15px system-ui,sans-serif;color:#555;background:#f5f4f0}</style>
</head>${bodyTag}
<div id="boot">正在启动（第一次打开要几秒）…</div>
<div id="root"></div>
<button id="offReset" style="position:fixed;left:12px;bottom:12px;z-index:50;font:12px system-ui,sans-serif;padding:6px 10px;border-radius:99px;border:1px solid rgba(0,0,0,.15);background:rgba(255,255,255,.85);color:#555;cursor:pointer" onclick="if(confirm('清空这台电脑上的演示数据，回到新账号？'))window.__offlineReset&&window.__offlineReset()">离线版 · 清空演示数据</button>
<script type="text/plain" id="webapp">${esc(web.outputFiles[0].text)}</script>
<script>${esc(server.outputFiles[0].text)}</script>
</body></html>`;
mkdirSync('dist', { recursive: true });
writeFileSync('dist/视频站-离线版.html', html);
console.log(`dist/视频站-离线版.html  ${(html.length / 1e6).toFixed(2)} MB`);

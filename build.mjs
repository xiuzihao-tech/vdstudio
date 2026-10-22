// 构建：前端打包到 dist/web，服务端打包为 dist/server.js
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');
mkdirSync('dist/web', { recursive: true });
cpSync('src/web/index.html', 'dist/web/index.html');

const web = {
  entryPoints: { app: 'src/web/main.tsx', styles: 'src/web/styles.css' },
  bundle: true,
  outdir: 'dist/web',
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: true,
  minify: !watch,
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  logLevel: 'info',
};
const server = {
  entryPoints: ['src/server/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/server.js',
  packages: 'external',
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(web);
  await ctx.watch();
} else {
  await Promise.all([esbuild.build(web), esbuild.build(server)]);
}

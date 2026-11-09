// 把后台「技能中心 → 导出 JSON」下载的技能写回仓库 skills/<id>/：提示词 → prompt.md，参数 → config.json，
// 然后重新生成 bundle（等于把线上调好的版本变成新的默认值）。上游接口只有开关，地址和密钥不进仓库。
// 用法：node scripts/skill-import.mjs 下载的文件.json [--dry]     --dry 只看会改什么，不写文件
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSkills, render } from './build-skills.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [file, flag] = process.argv.slice(2);
const dry = flag === '--dry';
if (!file) { console.error('用法：node scripts/skill-import.mjs 导出的文件.json [--dry]'); process.exit(1); }

let x;
try { x = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error(`读不了 ${file}：${e.message}`); process.exit(1); }
if (!x || typeof x.id !== 'string' || !/^[a-z0-9-]+$/.test(x.id)) { console.error('这不是技能中心导出的文件（缺 id）'); process.exit(1); }
const dir = join(root, 'skills', x.id);
if (!existsSync(dir)) { console.error(`仓库里没有 skills/${x.id}，先建好文件夹和 SKILL.md`); process.exit(1); }
if (x.category === 'upstream') { console.log(`「${x.name ?? x.id}」是上游接口：地址和密钥只存在服务器上，不导入仓库。`); process.exit(0); }

const changes = [];
// 提示词：保持原来的分段顺序，新段落接在后面
const promptFile = join(dir, 'prompt.md');
if (x.prompts && typeof x.prompts === 'object' && Object.keys(x.prompts).length) {
  const old = existsSync(promptFile) ? readFileSync(promptFile, 'utf8') : '';
  const order = [...old.matchAll(/^##\s+([A-Za-z0-9_-]+)\s*$/gm)].map(m => m[1]);
  const keys = [...order.filter(k => k in x.prompts), ...Object.keys(x.prompts).filter(k => !order.includes(k))];
  for (const k of keys) if (typeof x.prompts[k] !== 'string' || !x.prompts[k].trim()) { console.error(`提示词「${k}」是空的，不导入`); process.exit(1); }
  const md = keys.map(k => `## ${k}\n${x.prompts[k].trim()}\n`).join('\n');
  if (md !== old) changes.push(['prompt.md', md]);
}
// 参数
if (x.config && typeof x.config === 'object' && !Array.isArray(x.config)) {
  const cfgFile = join(dir, 'config.json');
  const text = `${JSON.stringify(x.config, null, 2)}\n`;
  if (!existsSync(cfgFile) || readFileSync(cfgFile, 'utf8') !== text) changes.push(['config.json', text]);
}

if (!changes.length) { console.log(`skills/${x.id} 和导出的内容一样，不用改。`); process.exit(0); }
console.log(`「${x.name ?? x.id}」${x.version ? `（后台第 ${x.version} 版）` : ''}要改：${changes.map(c => c[0]).join('、')}`);
if (dry) { console.log('（--dry：没有写文件）'); process.exit(0); }
for (const [name, text] of changes) writeFileSync(join(dir, name), text);
// 重新生成 bundle；生成出错（比如参数格式不对）就提示，文件已经写了，改好再跑 npm run skills
try {
  writeFileSync(join(root, 'src/server/skills/bundle.gen.ts'), render(buildSkills()));
  console.log('已写回仓库并重新生成 bundle。提交前跑一下 npm test。部署后，后台这个技能点「恢复默认」就会用仓库里的这一版。');
} catch (e) { console.error(`写好了，但生成 bundle 出错：${e.message}`); process.exit(1); }

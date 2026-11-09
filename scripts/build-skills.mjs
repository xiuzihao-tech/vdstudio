// 把 skills/ 目录下的技能包编译成 src/server/skills/bundle.gen.ts（服务端、离线版、测试都从这里读）。
// 每个技能一个文件夹：
//   SKILL.md      开头 --- 之间是元信息（id、name、category、version、order、uses、summary），后面是给维护的人看的说明
//   prompt.md     （AI 技能）提示词，用「## 名字」分段，比如 ## system、## user；正文里 {{变量}} 运行时替换
//   config.json   参数和数据（题库、模板、价格、规则……）
//   examples.json （可选）试运行用的输入 [{ "name": "", "input": {} }]
//   fields.json   （上游接口）后台表单的字段定义
//   labels.json   （可选）后台参数表单里字段的中文名和说明 { "字段名": { "n": "名字", "help": "说明" } }，不写用通用词表
// 用法：npm run skills（build、test 之前会自动跑）；node scripts/build-skills.mjs --check 只检查生成文件是不是最新
import { readFileSync, readdirSync, existsSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'skills');
const out = join(root, 'src/server/skills/bundle.gen.ts');
const CATS = ['ai', 'rule', 'upstream'];

function frontmatter(md, file) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}：开头要有 --- 包起来的元信息`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i < 0) throw new Error(`${file}：这一行看不懂「${line}」（要写成 键: 值）`);
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m[2].trim() };
}
function sections(md) {
  const out = {}; let key = null, buf = [];
  const flush = () => { if (key) out[key] = buf.join('\n').trim(); };
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^##\s+([A-Za-z0-9_-]+)\s*$/);
    if (h) { flush(); key = h[1]; buf = []; } else if (key) buf.push(line);
  }
  flush();
  return out;
}
const readJson = (f, dflt) => {
  if (!existsSync(f)) return dflt;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) { throw new Error(`${f} 不是合法的 JSON：${e.message}`); }
};

export function buildSkills() {
  const skills = [];
  for (const id of readdirSync(dir).sort()) {
    const d = join(dir, id);
    if (!statSync(d).isDirectory()) continue;
    const skillMd = join(d, 'SKILL.md');
    if (!existsSync(skillMd)) throw new Error(`skills/${id} 缺 SKILL.md`);
    const { meta, body } = frontmatter(readFileSync(skillMd, 'utf8'), `skills/${id}/SKILL.md`);
    if (meta.id !== id) throw new Error(`skills/${id}/SKILL.md 里的 id 要和文件夹同名（现在是 ${meta.id}）`);
    if (!CATS.includes(meta.category)) throw new Error(`skills/${id}：category 只能是 ${CATS.join(' / ')}`);
    if (!meta.name) throw new Error(`skills/${id}：缺 name`);
    const promptFile = join(d, 'prompt.md');
    skills.push({
      id, name: meta.name, category: meta.category, version: meta.version || '1.0.0', order: Number(meta.order) || 99,
      summary: meta.summary || '', uses: (meta.uses || '').split(',').map(s => s.trim()).filter(Boolean),
      doc: body,
      prompts: existsSync(promptFile) ? sections(readFileSync(promptFile, 'utf8')) : {},
      config: readJson(join(d, 'config.json'), {}),
      examples: readJson(join(d, 'examples.json'), []),
      fields: readJson(join(d, 'fields.json'), []),
      labels: readJson(join(d, 'labels.json'), {}),
    });
  }
  skills.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return skills;
}

export function render(skills) {
  return `// 自动生成，不要手改：改 skills/ 目录下的文件，然后 npm run skills。
import type { SkillFile } from '../../shared/skills.ts';

export const SKILL_FILES: SkillFile[] = ${JSON.stringify(skills, null, 1)};
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = render(buildSkills());
  if (process.argv.includes('--check')) {
    const cur = existsSync(out) ? readFileSync(out, 'utf8') : '';
    if (cur !== text) { console.error('src/server/skills/bundle.gen.ts 不是最新的：跑一下 npm run skills'); process.exit(1); }
    console.log('技能包是最新的');
  } else {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
    console.log(`技能包：${buildSkills().length} 个 → src/server/skills/bundle.gen.ts`);
  }
}

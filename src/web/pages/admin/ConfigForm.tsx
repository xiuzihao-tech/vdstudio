// 技能参数的表单编辑器：任何技能的 config 都按值的样子自动出表单——文字、数字、开关、颜色、一行一个的列表、
// 一组组的条目（能加、删、复制、上下移）、按类分组的对象。字段的中文名先看技能包里的 labels.json，再看下面的通用词表。
// 不认识的字段照样能改（显示字段名）。复杂的改法切到「JSON」。
import { useEffect, useState, type ReactNode } from 'react';
import type { FieldLabel } from '../../../shared/skills.ts';

type V = unknown;
type Obj = Record<string, V>;

/** 通用词表：各技能里常见的字段 */
export const LABELS: Record<string, FieldLabel> = {
  id: { n: '编号', help: '英文，别重复；已经在用的别改' }, n: { n: '名字' }, name: { n: '名字' }, d: { n: '一句话说明' }, enabled: { n: '启用' },
  useLlm: { n: '接了大模型就用大模型', help: '关掉 = 只按规则出' }, tag: { n: '角标' }, note: { n: '备注 / 授权说明' },
  // 成片类型与价格
  types: { n: '成片类型' }, pts: { n: '成片价（积分）' }, secs: { n: '推荐时长（秒）' }, need: { n: '需要什么素材' }, face: { n: '默认出镜', help: 'avatar 数字人 / voice 只要声音 / none 只放音乐', options: ['avatar', 'voice', 'none'] },
  parts: { n: '组成示意' }, bgm: { n: '音乐' }, sampleCats: { n: '样片分类', kind: 'lines' }, samples: { n: '首页样片' }, cat: { n: '分类' }, t: { n: '标题' },
  dur: { n: '时长' }, play: { n: '播放说明' }, scenes: { n: '镜头' }, ask: { n: '问用户' }, type: { n: '类型' },
  // 积分
  pointName: { n: '积分叫什么' }, secondsPerPoint: { n: '1 积分≈几秒' }, sampleRate: { n: '样片价比例', help: '0.4 = 成片价的四成' }, sampleMin: { n: '样片最低' }, minCost: { n: '每条最低' },
  initialPoints: { n: '新访客试用积分', help: '空 = 跟服务器设置' }, signupBonus: { n: '注册赠送' }, lowBalance: { n: '余额不足提醒线' }, diagPrice: { n: '诊断价格（分）', help: '89900 = ¥899' },
  orderTtlMin: { n: '订单有效期（分钟）' }, packages: { n: '充值套餐' }, price: { n: '价格（分）' }, points: { n: '到账积分' }, bonus: { n: '赠送积分' },
  // 邀请赠送
  invite: { n: '好友注册' }, inviterPoints: { n: '邀请人得' }, inviteePoints: { n: '好友得' }, rewardOn: { n: '什么时候发', help: 'register 注册就发 / first_gen 第一次出片后 / first_pay 第一次充值后', options: ['register', 'first_gen', 'first_pay'] },
  dailyCap: { n: '每天最多奖励', help: '0 = 不限' }, monthlyCap: { n: '每月最多奖励', help: '0 = 不限' }, ipDailyLimit: { n: '同一网络 24 小时最多' },
  rebate: { n: '好友充值返点' }, rate: { n: '比例', help: '0.1 = 10%' }, scope: { n: '返哪几次', help: 'all 每次 / first 只首充', options: ['all', 'first'] }, days: { n: '有效天数' }, capPerInvitee: { n: '每个好友最多返' },
  firstRecharge: { n: '首充奖励' }, fixed: { n: '固定积分' }, shareDaily: { n: '每天第一次分享奖励' }, shareTitle: { n: '分享标题' }, shareText: { n: '分享文案', kind: 'textarea' }, rules: { n: '规则说明', kind: 'lines' },
  // 视频风格
  styles: { n: '风格' }, typeDefault: { n: '每类成片默认风格', help: '填风格的编号' }, like: { n: '参考谁' }, best: { n: '最适合的视频类型', kind: 'lines' },
  copy: { n: '文案写法（给大模型）', kind: 'textarea' }, visual: { n: '画面拍法（给视频模型）', kind: 'textarea' }, pace: { n: '每镜几秒' },
  subs: { n: '字幕样式', help: 'doc 纪录片小字 / key 关键词大字 / plain 普通', options: ['doc', 'key', 'plain'] }, hot: { n: '招牌风格（排最前）' }, draft: { n: '还没对过样片' },
  // 成片参数
  durations: { n: '时长选项', kind: 'lines', help: '一行一个，写成「30 秒」；第一项「AI 推荐」' }, ratios: { n: '画面比例', kind: 'lines' }, fonts: { n: '字幕字体' },
  mood: { n: '适合什么片' }, use: { n: '合成用的曲子', help: '服务端曲库里的曲子', options: ['温暖钢琴', '城市律动', '弦乐氛围', '轻电子', '不要'] },
  // 封面、账号
  templates: { n: '模板' }, layout: { n: '排法', help: 'band 底部色块 / top 顶部标题 / split 上图下字', options: ['band', 'top', 'split'] }, bg: { n: '底色', kind: 'color' }, fg: { n: '字色', kind: 'color' }, accounts: { n: '默认发布账号', kind: 'lines' },
  // 数字人
  avatars: { n: '数字人形象' }, voices: { n: '声音选项', kind: 'lines' }, skin: { n: '肤色', kind: 'color' }, hair: { n: '发色', kind: 'color' }, top: { n: '衣服颜色', kind: 'color' },
  bg2: { n: '背景色 2', kind: 'color' }, hairStyle: { n: '发型', options: ['crop', 'short', 'bob', 'long'] }, glasses: { n: '戴眼镜' }, mine: { n: '用户自己的形象' },
  // 分镜、建议、发布包装
  charsPerSec: { n: '每秒念几个字' }, minShots: { n: '最少几镜' }, maxShots: { n: '最多几镜' }, lines: { n: '默认旁白' },
  keywords: { n: '关键词' }, msg: { n: '话术' }, thinMin: { n: '文案太短的字数' }, copyOnlyAllow: { n: '只有文案时能推荐的类型', kind: 'lines' },
  city: { n: '默认城市' }, titleMax: { n: '标题最多几个字' }, cta: { n: '结尾引导', kind: 'lines' }, groups: { n: '话题分组' }, tags: { n: '话题', kind: 'lines' }, pick: { n: '默认选第几个' },
  tagMin: { n: '话题最少' }, tagMax: { n: '话题最多' }, banned: { n: '广告法禁词', kind: 'lines' },
  // 一键生成视频的 8 类成片（按类分组的参数用）
  tour: { n: '空间漫游' }, explain: { n: '空间讲解' }, talk: { n: '真人口播' }, before: { n: '改造前后' }, case: { n: '案例故事' }, product: { n: '产品种草' }, site: { n: '工地记录' }, vlog: { n: 'Vlog' },
  // 诊断
  welcome: { n: '欢迎语', kind: 'textarea' }, stages: { n: '四个阶段', kind: 'lines' }, questions: { n: '题库' }, stage: { n: '阶段（0–3）' }, q: { n: '问题', kind: 'textarea' },
  more: { n: '题问完以后的追问', kind: 'lines' }, acks: { n: '接话（记下了…）', kind: 'lines' }, minAnswers: { n: '至少回答几题' }, maxQuestions: { n: '最多问几题' },
  demoName: { n: '演示人' }, demoAnswers: { n: '演示回答', kind: 'lines' }, sample: { n: '示例报告' }, sampleKeyword: { n: '示例报告触发词' }, personal: { n: '个性标签词库', kind: 'lines' },
  who: { n: '是谁' }, pro: { n: '专业标签', kind: 'lines' }, brand: { n: '品牌标签', kind: 'lines' }, columns: { n: '栏目' }, eg: { n: '示例选题' }, freq: { n: '一周几条' }, src: { n: '来源标签' }, unit: { n: '单位' },
  total: { n: '一共排几条' }, weekdays: { n: '哪几天发', help: '1–7，逗号隔开' }, time: { n: '几点发' }, generic: { n: '通用模板', kind: 'lines', help: '{col} 栏目名、{eg} 示例、{n} 第几期' },
};

const isObj = (v: V): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const titleOf = (x: V, i: number) => isObj(x) ? String(x.n ?? x.name ?? x.title ?? x.t ?? x.q ?? x.id ?? `第 ${i + 1} 项`).slice(0, 40) : `第 ${i + 1} 项`;
/** 新增一项：照着最后一项的样子，文字清空、数字留着、id 加后缀 */
const blankLike = (x: V): V => {
  if (typeof x === 'string') return '';
  if (Array.isArray(x)) return x.map(blankLike);
  if (isObj(x)) return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === 'id' && typeof v === 'string' ? `${v}-new` : k === 'enabled' ? true : blankLike(v)]));
  return x;
};

export function ConfigForm({ value, onChange, labels = {} }: { value: Obj; onChange: (v: Obj) => void; labels?: Record<string, FieldLabel> }) {
  const L = (k: string): FieldLabel => labels[k] ?? LABELS[k] ?? { n: k };
  return <div className="cf" id="skForm"><ObjFields v={value} set={x => onChange(x as Obj)} L={L} path="" /></div>;
}

type Lf = (k: string) => FieldLabel;

function ObjFields({ v, set, L, path }: { v: Obj; set: (x: V) => void; L: Lf; path: string }) {
  const keys = Object.keys(v);
  const simple = keys.filter(k => !isComplex(v[k], L(k))), complex = keys.filter(k => isComplex(v[k], L(k)));
  const put = (k: string) => (x: V) => set({ ...v, [k]: x });
  return <>
    {simple.length > 0 && <div className="cf-grid">{simple.map(k => <Field key={k} k={k} L={L(k)} path={`${path}.${k}`}><Leaf v={v[k]} set={put(k)} L={L(k)} /></Field>)}</div>}
    {complex.map(k => <fieldset key={k} className="cf-set" data-path={`${path}.${k}`}>
      <legend>{L(k).n} <code>{k}</code>{L(k).help && <em>{L(k).help}</em>}</legend>
      <Node v={v[k]} set={put(k)} L={L} path={`${path}.${k}`} lab={L(k)} />
    </fieldset>)}
  </>;
}

const isPrimArr = (v: V) => Array.isArray(v) && v.every(x => typeof x === 'string' || typeof x === 'number');
/** 放进网格的简单字段：文字、数字、开关、短列表；其余单独一块 */
const isComplex = (v: V, lab: FieldLabel) => isObj(v) || (Array.isArray(v) && !isPrimArr(v)) || (isPrimArr(v) && (lab.kind === 'lines' || (v as V[]).length > 6 || (v as V[]).some(x => String(x).length > 16))) || (typeof v === 'string' && (lab.kind === 'textarea' || v.length > 60 || v.includes('\n')));

function Node({ v, set, L, path, lab }: { v: V; set: (x: V) => void; L: Lf; path: string; lab: FieldLabel }) {
  if (isObj(v)) return <ObjFields v={v} set={set} L={L} path={path} />;
  if (Array.isArray(v)) {
    if (isPrimArr(v) && (v.length === 0 ? lab.kind === 'lines' : true) && !v.some(x => Array.isArray(x) || isObj(x))) return <Lines v={v as (string | number)[]} set={set} />;
    if (v.every(Array.isArray)) return <Tuples v={v as V[][]} set={set} />;
    return <Items v={v} set={set} L={L} path={path} />;
  }
  return <Leaf v={v} set={set} L={lab} big />;
}

function Field({ k, L, path, children }: { k: string; L: FieldLabel; path: string; children: ReactNode }) {
  return <label className="cf-f" data-path={path}><span>{L.n} <code>{k}</code></span>{children}{L.help && <em>{L.help}</em>}</label>;
}

function Leaf({ v, set, L, big }: { v: V; set: (x: V) => void; L: FieldLabel; big?: boolean }) {
  if (typeof v === 'boolean') return <span className="cf-sw"><input type="checkbox" checked={v} onChange={e => set(e.target.checked)} />{v ? '是' : '否'}</span>;
  if (L.options && (typeof v === 'string' || typeof v === 'number')) return <select value={String(v)} onChange={e => set(typeof v === 'number' ? Number(e.target.value) : e.target.value)}>{(L.options.includes(String(v)) ? L.options : [String(v), ...L.options]).map(o => <option key={o} value={o}>{o}</option>)}</select>;
  if (typeof v === 'number') return <input type="number" value={Number.isFinite(v) ? v : ''} step="any" onChange={e => set(e.target.value === '' ? 0 : Number(e.target.value))} />;
  if (v === null || v === undefined) return <input placeholder="空着 = 不设" onChange={e => set(e.target.value === '' ? null : Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : e.target.value)} />;
  if (isPrimArr(v)) return <Lines v={v as (string | number)[]} set={set} inline />;
  const s = String(v);
  if (L.kind === 'color' || /^#[0-9a-fA-F]{6}$/.test(s)) return <span className="cf-color"><input type="color" value={/^#[0-9a-fA-F]{6}$/.test(s) ? s : '#000000'} onChange={e => set(e.target.value)} /><input value={s} onChange={e => set(e.target.value)} /></span>;
  if (big || L.kind === 'textarea' || s.length > 60 || s.includes('\n')) return <textarea rows={Math.min(10, Math.max(2, Math.ceil(s.length / 46) + s.split('\n').length - 1))} value={s} onChange={e => set(e.target.value)} />;
  return <input value={s} onChange={e => set(e.target.value)} />;
}

/** 一行一个（数字列表用逗号） */
function Lines({ v, set, inline }: { v: (string | number)[]; set: (x: V) => void; inline?: boolean }) {
  const nums = v.length > 0 && v.every(x => typeof x === 'number');
  const joined = nums ? v.join(', ') : inline ? v.join(', ') : v.join('\n');
  const [text, setText] = useState(joined);
  const parse = (t: string): (string | number)[] => nums ? t.split(/[,，\s]+/).filter(Boolean).map(Number).filter(Number.isFinite) : inline ? t.split(/[,，]/).map(x => x.trim()).filter(Boolean) : t.split('\n').map(x => x.trim()).filter(Boolean);
  // 外面换了值（恢复默认、切版本）就跟着换
  useEffect(() => { if (JSON.stringify(parse(text)) !== JSON.stringify(v)) setText(joined); }, [joined]); // eslint-disable-line react-hooks/exhaustive-deps
  if (nums || inline) return <input value={text} onChange={e => { setText(e.target.value); set(parse(e.target.value)); }} />;
  return <><textarea className="cf-lines" rows={Math.min(14, Math.max(3, v.length + 1))} value={text} onChange={e => { setText(e.target.value); set(parse(e.target.value)); }} /><em className="cf-hint">一行一个，共 {v.length} 个</em></>;
}

/** 一组组固定长度的（比如镜头：[名字, 画面, 提示]） */
function Tuples({ v, set }: { v: V[][]; set: (x: V) => void }) {
  return <div className="cf-tuples">
    {v.map((row, i) => <div key={i} className="cf-row">
      <span className="cf-i">{i + 1}</span>
      {row.map((c, j) => <input key={j} value={String(c ?? '')} onChange={e => set(v.map((r, a) => a === i ? r.map((x, b) => b === j ? (typeof x === 'number' ? Number(e.target.value) : e.target.value) : x) : r))} />)}
      <button type="button" className="cf-x" title="删掉这一行" onClick={() => set(v.filter((_, a) => a !== i))}>×</button>
    </div>)}
    <button type="button" className="btn g sm" onClick={() => set([...v, v.length ? blankLike(v[v.length - 1]) : ['', '', '']])}>＋ 加一行</button>
  </div>;
}

/** 一组条目：可折叠的卡片，能加、删、复制、上下移 */
function Items({ v, set, L, path }: { v: V[]; set: (x: V) => void; L: Lf; path: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const move = (i: number, d: number) => { const a = [...v]; const [x] = a.splice(i, 1); a.splice(i + d, 0, x); set(a); setOpen(i + d); };
  return <div className="cf-items">
    {v.map((x, i) => <div key={i} className={`cf-item${open === i ? ' on' : ''}${isObj(x) && x.enabled === false ? ' off' : ''}`}>
      <div className="cf-ih">
        <button type="button" className="cf-it" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}><span className="cf-i">{i + 1}</span>{titleOf(x, i)}{isObj(x) && x.enabled === false && <i>已停用</i>}</button>
        <span className="cf-ops">
          <button type="button" disabled={i === 0} title="上移" onClick={() => move(i, -1)}>↑</button>
          <button type="button" disabled={i === v.length - 1} title="下移" onClick={() => move(i, 1)}>↓</button>
          <button type="button" title="复制一份" onClick={() => { const c = clone(x); if (isObj(c) && typeof c.id === 'string') c.id = `${c.id}-2`; const a = [...v]; a.splice(i + 1, 0, c); set(a); setOpen(i + 1); }}>复制</button>
          <button type="button" title="删掉" onClick={() => { if (confirm(`删掉「${titleOf(x, i)}」？保存前都能放弃修改。`)) { set(v.filter((_, a) => a !== i)); setOpen(null); } }}>删除</button>
        </span>
      </div>
      {open === i && <div className="cf-ib"><Node v={x} set={y => set(v.map((z, a) => a === i ? y : z))} L={L} path={`${path}[${i}]`} lab={{ n: '' }} /></div>}
    </div>)}
    <button type="button" className="btn g sm cf-add" onClick={() => { set([...v, v.length ? blankLike(v[v.length - 1]) : '']); setOpen(v.length); }}>＋ 新增一项</button>
  </div>;
}

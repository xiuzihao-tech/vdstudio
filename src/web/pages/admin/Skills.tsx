// 技能中心：每个功能一个技能包（仓库 skills/<id>/），后台能改提示词和参数、试运行、看调用、存版本、回滚、恢复默认、导出。
// 改动存成新版本并马上生效；仓库里的是默认值。上游接口类的技能在「上游接口」页填。
import { useEffect, useMemo, useState } from 'react';
import { api, type SkillRun } from '../../api.ts';
import { useApp, useData } from '../../store.tsx';
import { Seg, Skel } from '../../ui/kit.tsx';
import { CATEGORY_NAME, templateVars, type SkillCategory, type SkillData, type SkillView } from '../../../shared/skills.ts';
import { Chip, Doc, Table, download, fmtTime } from './ui.tsx';

const PROMPT_NAME: Record<string, string> = {
  system: '系统提示词（角色和总规则）', next: '下一个问题', report: '出诊断：标签和栏目', topics: '排选题', advise: '推荐成片类型', storyboard: '排分镜',
  pack: '标题、文案、话题', write_style: '写法要求', fine_note: '精写提醒', footage: '看素材写画外音', humanize: '改得更口语',
};
const UP_NAME: Record<string, string> = { 'up-llm': '文案大模型', 'up-vision': '看素材', 'up-seedance': '火山方舟 Seedance', 'up-newapi': '土豆网关', 'up-tts': '配音', 'up-wxpay': '微信支付', 'up-alipay': '支付宝' };
/** 有专门页面的规则技能：参数在那边用表单改更方便 */
const FORM_PAGE: Record<string, [string, string]> = { points: ['points', '积分系统'], 'video-types': ['points', '积分系统 → 成片类型与价格'], referral: ['referral', '邀请赠送'] };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function SkillsPage() {
  const { route } = useApp();
  return route.id ? <SkillDetail key={route.id} id={route.id} /> : <SkillList />;
}

function SkillList() {
  const { nav } = useApp();
  const [cat, setCat] = useState<'all' | SkillCategory>('all');
  const d = useData(() => api.admin.skills(), []);
  if (!d.data) return <Skel h={360} />;
  const list = d.data.skills.filter(s => cat === 'all' || s.category === cat).sort((a, b) => a.order - b.order);
  const open = (s: SkillView) => s.category === 'upstream' ? nav({ view: 'admin', sub: 'upstreams' }) : nav({ view: 'admin', sub: 'skills', id: s.id });
  return <div id="admSkills">
    <div className="adm-callout">
      <b>每个功能一个技能包，能单独维护。</b>提示词、题库、模板、价格、奖励规则都在技能里。改完点保存，存成新版本、马上生效；不满意随时切回旧版本或「恢复默认」。
      仓库 <code>skills/</code> 目录里是默认值，开发改文件、运营在这里改，互不影响。
    </div>
    <div className="adm-toolbar"><Seg value={cat} options={['all', 'ai', 'rule', 'upstream'] as const} render={v => v === 'all' ? `全部 ${d.data!.skills.length}` : `${CATEGORY_NAME[v]} ${d.data!.skills.filter(s => s.category === v).length}`} onChange={setCat} /></div>
    <Table id="admSkillTbl" head={['技能', '类别', '做什么', '当前', '状态', '近 7 天', '']} num={[]}
      rows={list.map(s => [
        <button className="adm-link" data-skill={s.id} onClick={() => open(s)}><b>{s.name}</b><br /><code>{s.id}</code></button>,
        <Chip k={s.category === 'ai' ? 'y' : s.category === 'upstream' ? 'dark' : ''}>{CATEGORY_NAME[s.category]}</Chip>,
        <span className="adm-sum">{s.summary}</span>,
        s.category === 'upstream' ? (s.upstream?.configured ? <Chip k="ok">已接通</Chip> : <Chip>没接</Chip>) : s.activeVersion ? <Chip k="warn">后台第 {s.activeVersion} 版</Chip> : <Chip>默认 v{s.version}</Chip>,
        s.data.enabled ? <Chip k="ok">启用</Chip> : <Chip k="err">停用</Chip>,
        s.stats.calls ? <span className="adm-sum">{s.stats.calls} 次{s.stats.llm ? ` · 模型 ${s.stats.llm}` : ''}{s.stats.fails ? <> · <span className="adm-err">失败 {s.stats.fails}</span></> : ''}</span> : <span className="adm-note">—</span>,
        <button className="btn g sm" onClick={() => open(s)}>{s.category === 'upstream' ? '去填' : '打开'}</button>,
      ])} />
  </div>;
}

type Tab = 'prompts' | 'config' | 'test' | 'versions' | 'doc' | 'calls';
function SkillDetail({ id }: { id: string }) {
  const { nav, toast, fail } = useApp();
  const d = useData(() => api.admin.skill(id), [id]);
  const s = d.data?.skill;
  const [draft, setDraft] = useState<SkillData | null>(null);
  const [cfgText, setCfgText] = useState('');
  const [cfgErr, setCfgErr] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState<Tab | null>(null);
  useEffect(() => {
    if (!s) return;
    setDraft(clone(s.data)); setCfgText(JSON.stringify(s.data.config, null, 2)); setCfgErr(null);
    setTab(t => t ?? (s.category === 'ai' ? 'prompts' : s.category === 'rule' ? 'config' : 'doc'));
  }, [s]);
  if (!s || !draft || !tab) return <Skel h={360} />;
  const dirty = !same(draft, s.data) || !!cfgErr;
  const promptKeys = Object.keys(s.defaults.prompts);
  const setCfg = (text: string) => {
    setCfgText(text);
    try { const v = JSON.parse(text); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('要是一个 { … } 对象'); setDraft({ ...draft, config: v }); setCfgErr(null); }
    catch (e) { setCfgErr((e as Error).message); }
  };
  const save = async () => {
    if (cfgErr) { toast(`参数格式不对：${cfgErr}`); setTab('config'); return; }
    setBusy('save');
    try { const r = await api.admin.saveSkill(id, draft, note.trim() || '后台修改'); d.set({ skill: r.skill, calls: d.data!.calls }); setNote(''); toast(`已存成第 ${r.version} 版，马上生效`); }
    catch (e) { fail(e); } finally { setBusy(''); }
  };
  const activate = async (v: number) => {
    if (dirty && !confirm('有没保存的修改，切换版本会丢掉。继续？')) return;
    setBusy(`v${v}`);
    try { const r = await api.admin.activateSkill(id, v); d.set({ skill: r.skill, calls: d.data!.calls }); toast(v ? `已切到第 ${v} 版` : '已恢复仓库默认'); }
    catch (e) { fail(e); } finally { setBusy(''); }
  };
  const toggle = async () => {
    if (s.data.enabled && !confirm(s.category === 'ai' ? `停用「${s.name}」以后不再调用大模型，按规则兜底。确定？` : `停用「${s.name}」？`)) return;
    try { const r = await api.admin.enableSkill(id, !s.data.enabled); d.set({ skill: r.skill, calls: d.data!.calls }); toast(r.skill.data.enabled ? '已启用' : '已停用'); } catch (e) { fail(e); }
  };
  const exp = async () => { try { const f = await api.admin.exportSkill(id); if (await download(f.name, f.blob) !== 'declined') toast(`已导出 ${f.name}`); } catch (e) { fail(e); } };
  const tabs: [Tab, string][] = [
    ...(promptKeys.length ? [['prompts', `提示词 ${promptKeys.length} 段`] as [Tab, string]] : []),
    ...(s.category !== 'upstream' ? [['config', '参数'] as [Tab, string], ['test', '试运行'] as [Tab, string], ['versions', `版本 ${s.versions.length}`] as [Tab, string]] : []),
    ['doc', '维护说明'], ['calls', '调用记录'],
  ];
  const form = FORM_PAGE[id];
  return <div id="admSkill" data-id={id}>
    <button className="lnk s" onClick={() => nav({ view: 'admin', sub: 'skills' })}>← 技能中心</button>
    <div className="adm-skhd">
      <div>
        <h2>{s.name} <code>{s.id}</code></h2>
        <p>{s.summary}</p>
        <div className="adm-chips">
          <Chip k={s.category === 'ai' ? 'y' : s.category === 'upstream' ? 'dark' : ''}>{CATEGORY_NAME[s.category]}</Chip>
          {s.activeVersion ? <Chip k="warn">现在用：后台第 {s.activeVersion} 版</Chip> : <Chip>现在用：仓库默认 v{s.version}</Chip>}
          {s.data.enabled ? <Chip k="ok">启用</Chip> : <Chip k="err">停用</Chip>}
          {s.uses.map(u => <Chip key={u} title="用到的上游接口">用 {UP_NAME[u] ?? u}</Chip>)}
          <span className="adm-note">近 7 天调用 {s.stats.calls} 次{s.stats.llm ? `，走大模型 ${s.stats.llm} 次` : ''}{s.stats.fails ? `，失败 ${s.stats.fails} 次` : ''}{s.stats.avgMs ? `，平均 ${(s.stats.avgMs / 1000).toFixed(1)} 秒` : ''}</span>
        </div>
        {s.stats.lastError && <p className="adm-err" style={{ marginTop: 6 }}>最近一次出错：{s.stats.lastError}</p>}
      </div>
      <div className="adm-skops">
        {s.category !== 'upstream' && <button className="btn g sm" id="skToggle" onClick={toggle}>{s.data.enabled ? '停用' : '启用'}</button>}
        <button className="btn g sm" id="skExport" onClick={exp}>导出 JSON</button>
        {s.category === 'upstream' && <button className="btn y sm" onClick={() => nav({ view: 'admin', sub: 'upstreams' })}>去上游接口填</button>}
      </div>
    </div>
    {form && <p className="adm-callout sm">这个技能的参数在「<button className="lnk" onClick={() => nav({ view: 'admin', sub: form[0] })}>{form[1]}</button>」页有表单，改那边更方便；这里能看全部字段、试运行、管版本。</p>}

    <div className="adm-tabs" role="tablist">{tabs.map(([k, n]) => <button key={k} role="tab" data-tab={k} aria-selected={tab === k} onClick={() => setTab(k)}>{n}</button>)}</div>

    {tab === 'prompts' && <div id="skPrompts">
      <p className="adm-note" style={{ marginBottom: 12 }}><code>{'{{名字}}'}</code> 是运行时换进去的内容（比如用户的文案、素材、可选类型），不要删；没换上的会在试运行里提示。模型必须只输出 JSON，格式写在每段最后。</p>
      {promptKeys.map(k => {
        const v = draft.prompts[k] ?? '', changed = v !== s.defaults.prompts[k];
        return <div key={k} className="adm-prompt">
          <div className="adm-prompth"><b>{PROMPT_NAME[k] ?? k}</b><code>## {k}</code>{changed && <Chip k="warn">和默认不一样</Chip>}<span className="sp" />
            {changed && <button className="lnk xs" onClick={() => setDraft({ ...draft, prompts: { ...draft.prompts, [k]: s.defaults.prompts[k] } })}>这一段恢复默认</button>}</div>
          <textarea className="adm-code" data-prompt={k} rows={Math.min(22, Math.max(4, v.split('\n').length + 1))} value={v} onChange={e => setDraft({ ...draft, prompts: { ...draft.prompts, [k]: e.target.value } })} spellCheck={false} />
          <div className="adm-chips">{templateVars(v).map(x => <code key={x} className="adm-var">{`{{${x}}}`}</code>)}<span className="adm-note">{v.length} 字</span></div>
        </div>;
      })}
    </div>}

    {tab === 'config' && <div id="skConfig">
      <p className="adm-note" style={{ marginBottom: 8 }}>参数是 JSON：数字直接写，文字加英文双引号，最后一项后面不要逗号。保存时服务端会再检查一遍，格式不对不让存。</p>
      <textarea className={`adm-code${cfgErr ? ' bad' : ''}`} id="skCfg" rows={Math.min(36, Math.max(10, cfgText.split('\n').length + 1))} value={cfgText} onChange={e => setCfg(e.target.value)} spellCheck={false} />
      <div className="adm-chips" style={{ marginTop: 8 }}>
        {cfgErr ? <span className="adm-err">JSON 格式不对：{cfgErr}</span> : <span className="adm-ok">✓ 格式没问题</span>}
        <span className="sp" />
        <button className="btn g sm" disabled={!!cfgErr} onClick={() => setCfgText(JSON.stringify(draft.config, null, 2))}>整理格式</button>
        <button className="btn g sm" disabled={same(draft.config, s.defaults.config)} onClick={() => { setDraft({ ...draft, config: clone(s.defaults.config) }); setCfgText(JSON.stringify(s.defaults.config, null, 2)); setCfgErr(null); }}>参数恢复默认</button>
      </div>
    </div>}

    {tab === 'test' && <TestRun s={s} draft={draft} dirty={dirty && !cfgErr} />}

    {tab === 'versions' && <Versions s={s} busy={busy} onActivate={activate} onLoad={x => { setDraft(x); setCfgText(JSON.stringify(x.config, null, 2)); setCfgErr(null); setTab(promptKeys.length ? 'prompts' : 'config'); toast('已把这一版的内容放进编辑区，保存后才生效'); }} />}

    {tab === 'doc' && <div className="adm-card"><Doc text={s.doc} /></div>}

    {tab === 'calls' && <Table head={['时间', '走的路', '结果', '耗时', '错误']} num={[3]} empty="最近还没有调用"
      rows={d.data!.calls.map(c => [fmtTime(c.createdAt), { llm: '大模型', rule: '规则', test: '测试连接', upstream: '上游调用' }[c.path] ?? c.path, c.ok ? <Chip k="ok">成功</Chip> : <Chip k="err">失败</Chip>, `${c.ms} 毫秒`, c.error ?? ''])} />}

    {s.category !== 'upstream' && dirty && <div className="adm-savebar" id="skSave">
      <b>有没保存的修改</b>
      <input className="adm-in" placeholder="改了什么（写进版本记录）" value={note} onChange={e => setNote(e.target.value)} maxLength={200} />
      <button className="btn g" onClick={() => { setDraft(clone(s.data)); setCfgText(JSON.stringify(s.data.config, null, 2)); setCfgErr(null); }}>放弃修改</button>
      <button className="btn y" id="skSaveBtn" disabled={!!busy || !!cfgErr} onClick={save}>{busy === 'save' ? '保存中…' : `存成第 ${(s.versions[0]?.version ?? 0) + 1} 版并启用`}</button>
    </div>}
  </div>;
}

function TestRun({ s, draft, dirty }: { s: SkillView; draft: SkillData; dirty: boolean }) {
  const { fail } = useApp();
  const ex = s.examples.length ? s.examples : [{ name: '空输入', input: {} }];
  const [pick, setPick] = useState(0);
  const [text, setText] = useState(() => JSON.stringify(ex[0].input, null, 2));
  const [force, setForce] = useState<'auto' | 'rule' | 'llm'>('auto');
  const [useDraft, setUseDraft] = useState(dirty);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<SkillRun | null>(null);
  const bad = useMemo(() => { try { JSON.parse(text); return null; } catch (e) { return (e as Error).message; } }, [text]);
  const run = async () => {
    setBusy(true); setOut(null);
    try { setOut(await api.admin.testSkill(s.id, JSON.parse(text), useDraft ? draft : undefined, force === 'auto' ? undefined : force)); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  return <div id="skTest">
    <div className="adm-form">
      <label className="adm-field"><span>用哪个例子</span><select value={pick} onChange={e => { const i = Number(e.target.value); setPick(i); setText(JSON.stringify(ex[i].input, null, 2)); }}>{ex.map((x, i) => <option key={i} value={i}>{x.name}</option>)}</select></label>
      {s.category === 'ai' && <label className="adm-field"><span>走哪条路</span><select id="skForce" value={force} onChange={e => setForce(e.target.value as typeof force)}><option value="auto">跟线上一样（接了大模型就走模型）</option><option value="rule">只用规则兜底</option><option value="llm">强制走大模型</option></select></label>}
      <label className="adm-field"><span>用哪份内容</span><select value={useDraft ? 'draft' : 'live'} onChange={e => setUseDraft(e.target.value === 'draft')}><option value="draft">编辑区里的（含没保存的修改）</option><option value="live">线上现在用的</option></select></label>
    </div>
    <label className="adm-field wide" style={{ marginTop: 12 }}><span>输入（JSON）</span><textarea className={`adm-code${bad ? ' bad' : ''}`} rows={Math.min(18, Math.max(6, text.split('\n').length + 1))} value={text} onChange={e => setText(e.target.value)} spellCheck={false} /></label>
    <div className="adm-chips" style={{ marginTop: 10 }}>
      <button className="btn k" id="skRun" disabled={busy || !!bad} onClick={run}>{busy ? '在跑…' : '试运行'}</button>
      {bad && <span className="adm-err">输入不是合法 JSON：{bad}</span>}
      <span className="adm-note">试运行不记进调用统计，也不扣任何人的积分。</span>
    </div>
    {out && <div className="adm-result" id="skOut">
      <div className="adm-chips">
        {out.path === 'llm' ? <Chip k="ok">走了大模型{out.model ? ` · ${out.model}` : ''}</Chip> : <Chip>走了规则</Chip>}
        <span className="adm-note">{out.ms} 毫秒</span>
        {out.error && <span className="adm-err">大模型没用上：{out.error}</span>}
        {out.prompt?.missing.length ? <span className="adm-warn">提示词里这些变量没换上：{out.prompt.missing.join('、')}</span> : null}
      </div>
      <p className="adm-lb2">输出</p>
      <pre className="adm-pre">{JSON.stringify(out.out, null, 2)}</pre>
      {out.prompt && (out.prompt.system || out.prompt.user) && <details><summary>看拼好的提示词</summary>
        <p className="adm-lb2">系统提示词</p><pre className="adm-pre">{out.prompt.system || '（空）'}</pre>
        <p className="adm-lb2">用户提示词</p><pre className="adm-pre">{out.prompt.user || '（空）'}</pre>
      </details>}
      {out.raw && <details><summary>模型原始回复</summary><pre className="adm-pre">{out.raw}</pre></details>}
    </div>}
  </div>;
}

function Versions({ s, busy, onActivate, onLoad }: { s: SkillView; busy: string; onActivate: (v: number) => void; onLoad: (d: SkillData) => void }) {
  const { fail } = useApp();
  const [view, setView] = useState<{ v: number; data: SkillData } | null>(null);
  const look = async (v: number) => { try { setView({ v, data: (await api.admin.skillVersion(s.id, v)).data }); } catch (e) { fail(e); } };
  return <div id="skVersions">
    <Table head={['版本', '说明', '谁改的', '时间', '']}
      rows={[
        ...s.versions.map(v => [<b>第 {v.version} 版</b>, v.note, v.author, fmtTime(v.createdAt, true),
          <span className="adm-chips">{s.activeVersion === v.version ? <Chip k="ok">正在用</Chip> : <button className="btn g sm" data-act={v.version} disabled={!!busy} onClick={() => onActivate(v.version)}>{busy === `v${v.version}` ? '切换中…' : '切到这一版'}</button>}<button className="lnk xs" onClick={() => look(v.version)}>看内容</button></span>]),
        [<b>仓库默认 v{s.version}</b>, 'skills/ 目录里的文件', '开发', '—',
          <span className="adm-chips">{s.activeVersion === 0 ? <Chip k="ok">正在用</Chip> : <button className="btn g sm" id="skDefault" disabled={!!busy} onClick={() => onActivate(0)}>恢复默认</button>}<button className="lnk xs" onClick={() => setView({ v: 0, data: s.defaults })}>看内容</button></span>],
      ]} />
    {view && <div className="adm-result">
      <div className="adm-chips"><b>{view.v ? `第 ${view.v} 版` : '仓库默认'}的内容</b><span className="sp" /><button className="btn g sm" onClick={() => onLoad(clone(view.data))}>放进编辑区</button><button className="lnk xs" onClick={() => setView(null)}>收起</button></div>
      <pre className="adm-pre">{JSON.stringify(view.data, null, 2)}</pre>
    </div>}
  </div>;
}

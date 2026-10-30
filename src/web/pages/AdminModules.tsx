// 后台 · 模块开关：50 个模块按区排，每个单独设开放 / 内测 / 预告 / 隐藏，改完立刻生效。
// 上面三个一键套用；还能标专家版、填解锁价格、内测名单、保存期限和容量，看每个模块的使用次数。
import { useState } from 'react';
import { api } from '../api.ts';
import { useApp, useData } from '../store.tsx';
import { Skel } from '../ui/kit.tsx';
import { setAsStudent } from '../ui/mods.tsx';
import { closedParents, moduleOf, type ModState, type ModuleConfig, type Preset } from '../../shared/modules.ts';

const STN: Record<ModState, string> = { on: '开放', beta: '内测', soon: '预告', off: '隐藏' };
const PHN = ['', '一期', '二期', '三期'];

export function AdminModules() {
  const { fail, toast, reloadSession, sheet } = useApp();
  const d = useData(() => api.admin.modules(), []);
  const [beta, setBeta] = useState<string | null>(null);
  if (!d.data) return <Skel h={400} />;
  const { modules, presets, config: c, usage } = d.data;
  const save = async (p: Parameters<typeof api.admin.saveModules>[0], msg = '改好了，立刻生效') => {
    try { const r = await api.admin.saveModules(p); d.set({ ...d.data!, config: r.config }); await reloadSession(); toast(msg); } catch (e) { fail(e); }
  };
  const setState = (id: string, v: ModState) => {
    const parents = v === 'off' ? [] : closedParents({ ...c, states: { ...c.states, [id]: v } } as ModuleConfig, id);
    if (!parents.length) return void save({ states: { [id]: v } });
    sheet({
      title: '上级模块还关着',
      body: <p className="s">「{moduleOf(id)!.n}」属于「{parents.map(p => moduleOf(p)!.n).join('」「')}」。上级关着，学员还是看不到它。要一起设成「{STN[v]}」吗？</p>,
      foot: <><button className="btn g" onClick={() => { sheet(null); void save({ states: { [id]: v } }); }}>只改这一个</button><button className="btn y" id="modWithParents" onClick={() => { sheet(null); void save({ states: { [id]: v }, withParents: true }); }}>一起打开</button></>,
    });
  };
  const zones = [...new Set(modules.map(m => m.zone))];
  const count = (st: ModState) => modules.filter(m => c.states[m.id] === st).length;
  return <div id="modAdmin">
    <div className="card">
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <b className="t2" style={{ flex: 1, minWidth: 200 }}>一键套用</b>
        {(Object.keys(presets) as Preset[]).map(p => <button key={p} className={`btn ${c.preset === p ? 'y' : 'g'} sm`} data-preset={p} onClick={() => save({ preset: p }, `已套用「${presets[p]}」`)}>{presets[p]}</button>)}
        <button className="btn g sm" id="previewStudent" onClick={() => { setAsStudent(true); toast('已切到「按学员看」，顶栏再点一下切回来'); }}>按学员看</button>
      </div>
      <p className="xs m3" style={{ marginTop: 8 }}>当前：开放 {count('on')} · 内测 {count('beta')} · 预告 {count('soon')} · 隐藏 {count('off')}。套用后还能逐个调；父模块隐藏，下面的子模块跟着看不到。</p>
    </div>

    <div className="card" style={{ marginTop: 14 }}>
      <div className="modset">
        <label><span className="lb">解锁 AI 运营（点）</span><input className="fld" type="number" id="modPrice" min={0} defaultValue={c.price} onBlur={e => Number(e.target.value) !== c.price && save({ price: Math.max(0, Math.round(Number(e.target.value) || 0)) })} /><span className="xs m3">纪要里待定；0 = 免费</span></label>
        <label><span className="lb">保存天数</span><input className="fld" type="number" id="modDays" min={0} defaultValue={c.retentionDays} onBlur={e => Number(e.target.value) !== c.retentionDays && save({ retentionDays: Math.max(0, Math.round(Number(e.target.value) || 0)) })} /><span className="xs m3">上传的素材和成片；0 = 不限，到期前 7 天提醒</span></label>
        <label><span className="lb">每个账号容量（MB）</span><input className="fld" type="number" id="modCap" min={0} defaultValue={c.capacityMb} onBlur={e => Number(e.target.value) !== c.capacityMb && save({ capacityMb: Math.max(0, Math.round(Number(e.target.value) || 0)) })} /><span className="xs m3">0 = 不限</span></label>
      </div>
      <p className="lb" style={{ marginTop: 14 }}>内测名单（每行一个邮箱）</p>
      <textarea className="fld" id="modBeta" rows={3} value={beta ?? c.beta.join('\n')} onChange={e => setBeta(e.target.value)} placeholder="设成「内测」的模块只有这些账号能看到" />
      {beta !== null && <button className="btn y sm" style={{ marginTop: 8 }} onClick={() => { void save({ beta: beta.split(/[\s,，]+/).filter(Boolean) }, '内测名单存好了'); setBeta(null); }}>保存名单</button>}
    </div>

    {zones.map(z => <div key={z} className="modzone">
      <p className="eyebrow" style={{ margin: '26px 0 8px' }}>{z}</p>
      <div className="list modlist">{modules.filter(m => m.zone === z).map(m => {
        const u = usage[m.id];
        return <div key={m.id} data-mod={m.id}>
          <span style={{ flex: 1, minWidth: 220 }}>
            <b>{m.n}</b>{m.parent && <span className="xs m3"> · 属于「{moduleOf(m.parent)?.n}」</span>}<br />
            <span className="xs m3">{PHN[m.phase]}{m.first ? ' · 先做' : ''} · {m.src} · {m.d}</span><br />
            <span className="xs m3">近 30 天打开 {u?.opens ?? 0} 次{u?.users ? `（${u.users} 人）` : ''}{u?.done != null ? ` · 用完 ${u.done} 次` : ''}</span>
          </span>
          <label className="xs row" style={{ gap: 6 }} title="没解锁 AI 运营的账号看到解锁页"><input type="checkbox" data-pro={m.id} checked={c.pro.includes(m.id)} onChange={e => save({ pro: e.target.checked ? [...c.pro, m.id] : c.pro.filter(x => x !== m.id) })} />专家版</label>
          <div className="seg sm" role="group" aria-label={`${m.n} 的状态`}>{(Object.keys(STN) as ModState[]).map(v => <button key={v} data-st={v} aria-pressed={c.states[m.id] === v} onClick={() => c.states[m.id] !== v && setState(m.id, v)}>{STN[v]}</button>)}</div>
        </div>;
      })}</div>
    </div>)}
  </div>;
}

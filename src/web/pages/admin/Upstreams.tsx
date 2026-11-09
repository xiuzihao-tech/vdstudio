// 上游接口：大模型、看素材、视频（方舟 / 土豆网关）、配音、微信支付、支付宝。
// 后台填的优先，没填的用服务器环境变量；密钥加密存、只显示打码后的样子；保存后马上重新接上，不用重启。
import { useState } from 'react';
import { api, type UpstreamView } from '../../api.ts';
import { useApp, useData } from '../../store.tsx';
import { Seg, Skel } from '../../ui/kit.tsx';
import { Chip, Doc, Sec, fmtTime } from './ui.tsx';

const AI_NAME: Record<string, string> = { mock: '模拟（没接）', llm: '大模型已接', seedance: '火山方舟 Seedance', newapi: '土豆网关', minimax: 'MiniMax', none: '没接' };
const VP: Record<string, string> = { auto: '自动（有网关用网关，没有用方舟）', seedance: '火山方舟直连', newapi: '土豆网关', mock: '模拟（不花钱，演示用）' };
const SOURCE: Record<string, string> = { admin: '后台填的', env: '服务器环境变量', none: '没填' };
const MODEL_KEYS = ['model', 'fineModel', 's25', 's20', 's20f', 'draft'];

export function UpstreamsPage() {
  const { toast, fail } = useApp();
  const d = useData(() => api.admin.upstreams(), []);
  if (!d.data) return <Skel h={360} />;
  const x = d.data;
  const setVp = async (v: string) => { try { const r = await api.admin.setVideoProvider(v); d.set({ ...x, videoProvider: r.videoProvider, ai: r.ai }); toast(`视频改用：${VP[v]}`); } catch (e) { fail(e); } };
  return <div id="admUps">
    <div className="adm-callout"><b>后台填的优先，没填的用服务器的 .env。</b>密钥加密存在数据库里（服务器配 <code>SECRETS_KEY</code>），这里只显示打码后的样子，不改就留空。
      保存后马上重新接上，不用重启；先点「测试连接」确认能通再保存。</div>
    <div className="adm-kv" id="upNow">
      <div><span>文案大模型</span><b>{AI_NAME[x.ai.copy] ?? x.ai.copy}</b></div>
      <div><span>视频生成</span><b>{AI_NAME[x.ai.video] ?? x.ai.video}</b></div>
      <div><span>配音</span><b>{AI_NAME[x.ai.tts] ?? x.ai.tts}</b></div>
      <div><span>看素材</span><b>{x.ai.vision === 'llm' ? '已接' : '没接'}</b></div>
      <div><span>在线支付</span><b>{x.pay.channels.filter(c => c !== 'mock').map(c => c === 'wechat' ? '微信' : '支付宝').join('、') || '还没接'}{x.pay.mock ? ' · 模拟支付开着' : ''}</b></div>
      <div><span>视频近 7 天</span><b>{x.videoStats.calls} 条{x.videoStats.fails ? `，失败 ${x.videoStats.fails}` : ''}</b></div>
    </div>
    <Sec title="视频用哪家" note="两家都配了的时候选一家；选「模拟」可以先关掉真实出片">
      <Seg value={x.videoProvider} options={['auto', 'seedance', 'newapi', 'mock'] as const} render={v => VP[v].split('（')[0]} onChange={setVp} />
      <p className="adm-note" style={{ marginTop: 6 }}>{VP[x.videoProvider]}</p>
    </Sec>
    {x.upstreams.map(u => <UpCard key={u.id} u={u} onSaved={r => d.set({ ...x, ...r })} />)}
  </div>;
}

function UpCard({ u, onSaved }: { u: UpstreamView; onSaved: (r: Awaited<ReturnType<typeof api.admin.saveUpstream>>) => void }) {
  const { toast, fail } = useApp();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [clear, setClear] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [test, setTest] = useState<{ ok: boolean; ms: number; message: string } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [doc, setDoc] = useState(false);
  const dirty = Object.keys(vals).length > 0 || clear.length > 0;
  const st = u.status;
  const req = u.fields.filter(f => f.required), filled = req.filter(f => st.values[f.key]?.value).length;
  const save = async () => {
    setBusy('save');
    const values: Record<string, string | null> = { ...vals };
    for (const k of clear) values[k] = null;
    try { const r = await api.admin.saveUpstream(u.id, { values }); setVals({}); setClear([]); onSaved(r); toast(`「${u.name}」已保存，马上生效`); }
    catch (e) { fail(e); } finally { setBusy(''); }
  };
  const toggle = async () => {
    if (st.enabled && !confirm(`停用「${u.name}」？停用后这个接口不再调用（大模型、视频会退回模拟，支付渠道会关掉）。`)) return;
    try { const r = await api.admin.saveUpstream(u.id, { enabled: !st.enabled }); onSaved(r); toast(st.enabled ? '已停用' : '已启用'); } catch (e) { fail(e); }
  };
  const runTest = async () => {
    setBusy('test'); setTest(null);
    try { setTest(await api.admin.testUpstream(u.id, vals)); } catch (e) { fail(e); } finally { setBusy(''); }
  };
  const pull = async () => {
    setBusy('models');
    try { const r = await api.admin.upstreamModels(u.id); setModels(r.models); toast(`拉到 ${r.models.length} 个模型，填模型的地方可以直接选`); } catch (e) { fail(e); } finally { setBusy(''); }
  };
  const canList = ['up-llm', 'up-newapi', 'up-vision'].includes(u.id);
  return <section className="adm-card adm-up" data-up={u.id}>
    <div className="adm-uphd">
      <div><h3>{u.name}</h3><p className="adm-note">{u.summary}</p></div>
      <span className="sp" />
      {!st.enabled ? <Chip k="err">已停用</Chip> : st.configured ? <Chip k="ok">已接通</Chip> : filled ? <Chip k="warn">没填全 {filled}/{req.length}</Chip> : <Chip>没接</Chip>}
      <button className="btn g sm" onClick={toggle}>{st.enabled ? '停用' : '启用'}</button>
    </div>
    <div className="adm-form">
      {u.fields.map(f => {
        const cur = st.values[f.key] ?? { value: '', source: 'none', secret: !!f.secret };
        const cleared = clear.includes(f.key);
        const ph = f.secret
          ? (cleared ? '保存后清掉，改用服务器环境变量' : cur.value ? `${cur.value}（${SOURCE[cur.source]}，不改就留空）` : f.placeholder ?? '')
          : cur.source === 'env' ? `${cur.value}（${SOURCE.env}）` : f.placeholder ?? '';
        const value = vals[f.key] ?? (f.secret ? '' : cur.source === 'admin' ? cur.value : '');
        const set = (v: string) => { setClear(c => c.filter(k => k !== f.key)); setVals(o => { const n = { ...o }; if (!f.secret && v === (cur.source === 'admin' ? cur.value : '')) delete n[f.key]; else if (f.secret && !v) delete n[f.key]; else n[f.key] = v; return n; }); };
        const list = MODEL_KEYS.includes(f.key) && models.length ? `ml-${u.id}` : undefined;
        return <label key={f.key} className={`adm-field${f.type === 'textarea' ? ' wide' : ''}`} data-field={f.key}>
          <span>{f.label}{f.required && <b className="adm-req" title="必填">*</b>}{f.secret && <i className="adm-lock" title="加密存">🔒</i>}<code className="adm-env">{f.env}</code></span>
          {f.type === 'bool'
            ? <select value={value} onChange={e => set(e.target.value)}><option value="">{cur.source === 'env' ? `跟服务器（${cur.value === '1' ? '是' : '否'}）` : '默认（否）'}</option><option value="1">是</option><option value="0">否</option></select>
            : f.type === 'textarea'
              ? <textarea className="adm-code" rows={4} value={value} placeholder={ph} onChange={e => set(e.target.value)} spellCheck={false} />
              : <input type={f.type === 'number' ? 'number' : f.secret ? 'password' : 'text'} autoComplete="off" list={list} value={value} placeholder={ph} onChange={e => set(e.target.value)} />}
          <em className="hint">{f.help ?? ''}{cur.source !== 'none' && !f.secret ? `${f.help ? ' · ' : ''}现在：${SOURCE[cur.source]}` : ''}
            {f.secret && cur.source === 'admin' && !cleared && <button type="button" className="lnk xs" onClick={() => setClear(c => [...c, f.key])}>清除后台填的</button>}</em>
        </label>;
      })}
    </div>
    {models.length > 0 && <datalist id={`ml-${u.id}`}>{models.map(m => <option key={m} value={m} />)}</datalist>}
    <div className="adm-chips" style={{ marginTop: 12 }}>
      <button className="btn g sm" data-uptest={u.id} disabled={!!busy} onClick={runTest}>{busy === 'test' ? '测试中…' : '测试连接'}</button>
      {canList && <button className="btn g sm" disabled={!!busy} onClick={pull}>{busy === 'models' ? '拉取中…' : '拉模型列表'}</button>}
      <button className="btn y sm" data-upsave={u.id} disabled={!!busy || !dirty} onClick={save}>{busy === 'save' ? '保存中…' : '保存'}</button>
      {dirty && <button className="lnk xs" onClick={() => { setVals({}); setClear([]); }}>放弃修改</button>}
      {test && <span className={test.ok ? 'adm-ok' : 'adm-err'} data-uptestout={u.id}>{test.ok ? '✓' : '✗'} {test.message}（{test.ms} 毫秒）</span>}
      <span className="sp" />
      <span className="adm-note">{u.meta.updatedAt ? `${fmtTime(u.meta.updatedAt)} ${u.meta.by ?? ''} 改过` : '后台还没改过'}{u.stats.calls ? ` · 近 7 天 ${u.stats.calls} 次${u.stats.fails ? `，失败 ${u.stats.fails}` : ''}` : ''}</span>
      <button className="lnk xs" onClick={() => setDoc(!doc)}>{doc ? '收起说明' : '怎么填'}</button>
    </div>
    {u.stats.lastError && <p className="adm-err" style={{ marginTop: 6 }}>最近一次出错：{u.stats.lastError}</p>}
    {doc && <div style={{ marginTop: 12 }}><Doc text={u.doc} /></div>}
  </section>;
}

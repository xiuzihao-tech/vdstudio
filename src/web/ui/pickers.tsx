// 跨页复用的选择器：素材选择（含上传）、把选题排进某天或备选池。
import { useEffect, useState } from 'react';
import { api, type PlanBundle } from '../api.ts';
import { useApp } from '../store.tsx';
import { Ph, Skel, pickFiles } from './kit.tsx';
import type { Asset, Topic } from '../../shared/types.ts';

export const ACCEPT = 'image/*,video/*';

/** 上传若干文件，返回新素材 */
export async function uploadFiles(files: File[], source: string, onProgress?: (n: number) => void): Promise<Asset[]> {
  const out: Asset[] = [];
  for (const f of files) { out.push(await api.upload(f, source)); onProgress?.(out.length); }
  return out;
}

function AssetPickerBody({ onDone, already }: { onDone: (a: Asset[]) => void; already: string[] }) {
  const { sheet, fail, toast } = useApp();
  const [list, setList] = useState<Asset[] | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.assets().then(r => setList(r.assets)).catch(fail); }, [fail]);
  const toggle = (id: string) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const upload = async () => {
    const files = await pickFiles(ACCEPT); if (!files.length) return;
    setBusy(true);
    try { const a = await uploadFiles(files, '上传'); setList(l => [...a, ...(l ?? [])]); setSel(s => [...a.map(x => x.id), ...s]); toast(`已上传 ${a.length} 份，也存进了素材库`); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  return <>
    <p className="s m" style={{ marginBottom: 12 }}>点选要用的素材，可多选。</p>
    {!list ? <Skel h={120} /> : <div className="pk">{list.map(a => (
      <button key={a.id} data-pkk={a.id} aria-pressed={sel.includes(a.id)} aria-label={a.name} onClick={() => toggle(a.id)}>
        <Ph k={a.k} asset={a} /><span>{a.type}{already.includes(a.id) ? ' · 已在用' : ''}</span>
      </button>))}</div>}
    <div className="row" style={{ marginTop: 12 }}><button className="lnk xs" id="pkUp" onClick={upload} disabled={busy}>{busy ? '上传中…' : '＋ 上传新素材'}</button></div>
    <div className="sf" style={{ margin: '18px -24px -18px', paddingBottom: 18 }}>
      <button className="btn g" onClick={() => sheet(null)}>取消</button>
      <button className="btn y" id="pkOk" onClick={() => { if (!sel.length) { toast('先点选素材'); return; } onDone(sel.map(id => list!.find(a => a.id === id)!).filter(Boolean)); }}>{sel.length ? `导入 ${sel.length} 份` : '导入'}</button>
    </div>
  </>;
}

export function useAssetPicker() {
  const { sheet } = useApp();
  return (onDone: (a: Asset[]) => void, o: { title?: string; already?: string[] } = {}) =>
    sheet({ title: o.title ?? '从素材库导入', body: <AssetPickerBody already={o.already ?? []} onDone={a => { sheet(null); onDone(a); }} /> });
}

/* ---------- 选题 → 排期 ---------- */
function ScheduleBody({ topic, onDone }: { topic: Topic; onDone: (msg: string) => void }) {
  const { fail, session } = useApp();
  const [plans, setPlans] = useState<PlanBundle[] | null>(null);
  const [ai, setAi] = useState(0);
  useEffect(() => { api.plans().then(r => setPlans(r.plans)).catch(fail); }, [fail]);
  if (!plans) return <Skel h={200} />;
  const pb = plans[ai], today = session!.today;
  const days = pb.slots.filter(d => d.date > today);
  return <>
    <p className="s m" style={{ marginBottom: 12 }}>「{topic.title}」</p>
    {plans.length > 1 && <div className="pills" style={{ marginBottom: 12 }}>{plans.map((p, i) => <button key={p.plan.id} className="pill sm" aria-pressed={i === ai} onClick={() => setAi(i)}>{p.plan.account}</button>)}</div>}
    <div className="list">{days.map(d => {
      const isEmpty = 'empty' in d;
      const same = !isEmpty && d.topicId === topic.id;
      return <button key={d.date} data-ss={d.date} onClick={async () => {
        try { const r = await api.slot(pb.plan.id, d.date, 'set', topic.id); onDone(`${r.message}（${d.label}）`); } catch (e) { fail(e); }
      }}>
        <span>{d.weekday} {d.label}<br /><span className="xs m3">{isEmpty ? '这天没排，会加一条' : same ? '就是这个选题' : `${d.pin === 'fixed' ? '📌 已固定：' : 'AI 预选：'}${d.topic.title}`}</span></span>
        <span className="v">{!isEmpty && d.pin === 'fixed' && !same ? '替换 ›' : '放这天 ›'}</span>
      </button>;
    })}</div>
    <div className="sf" style={{ margin: '18px -24px -18px', paddingBottom: 18 }}>
      <button className="btn k" id="ssBack" onClick={async () => { try { await api.backlog(pb.plan.id, topic.id); onDone('已放进备选池，去排期里挑日子'); } catch (e) { fail(e); } }}>先放进备选池</button>
    </div>
  </>;
}

export function useScheduleTopic() {
  const { sheet, toast, bump } = useApp();
  return (topic: Topic) => sheet({ title: '加入排期', body: <ScheduleBody topic={topic} onDone={m => { sheet(null); toast(m); bump(); }} /> });
}

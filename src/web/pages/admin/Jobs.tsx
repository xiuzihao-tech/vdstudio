// 出片任务（全站）：谁在什么时候出了什么片、样片还是成片、花了多少积分、失败原因；失败的自动退过点，
// 成功但用户不满意（画面糊、跑题）可以人工退点（每条只能退一次，记操作日志）。
import { useState } from 'react';
import { api } from '../../api.ts';
import { useApp, useData } from '../../store.tsx';
import { Seg, Skel } from '../../ui/kit.tsx';
import { Chip, Sec, Table, Tile, fmtNum, fmtTime } from './ui.tsx';

const ST: Record<string, ['ok' | 'warn' | 'err' | '', string]> = { queued: ['', '排队'], running: ['warn', '生成中'], done: ['ok', '完成'], failed: ['err', '失败'] };

export function JobsPage() {
  const { toast, fail } = useApp();
  const [status, setStatus] = useState<'' | 'running' | 'done' | 'failed'>('');
  const [q, setQ] = useState(''), [qq, setQq] = useState('');
  const d = useData(() => api.admin.jobs({ status, q: qq }), [status, qq]);
  if (!d.data) return <Skel h={300} />;
  const x = d.data, c = x.counts;
  const refund = async (id: string, title: string, cost: number) => {
    const why = prompt(`给「${title}」人工退 ${cost} 积分（每条只能退一次）。写一下原因：`, '');
    if (why === null) return;
    if (why.trim().length < 2) { toast('原因至少写两个字'); return; }
    try { const r = await api.admin.refundJob(id, why.trim()); toast(`退了 ${r.points} 积分`); d.reload(); } catch (e) { fail(e); }
  };
  return <div id="admJobs">
    <div className="adm-tiles">
      <Tile label="全部任务" value={fmtNum(Object.values(c).reduce((a, n) => a + n, 0))} />
      <Tile label="生成中" value={fmtNum((c.running ?? 0) + (c.queued ?? 0))} tone={(c.running ?? 0) > 20 ? 'warn' : undefined} />
      <Tile label="完成" value={fmtNum(c.done ?? 0)} />
      <Tile label="失败" value={fmtNum(c.failed ?? 0)} sub="失败的自动退点" tone={c.failed ? 'warn' : undefined} />
    </div>
    <Sec title="任务列表" note="最近 200 条"
      extra={<div className="adm-chips">
        <Seg value={status} options={['', 'running', 'done', 'failed'] as const} render={v => v ? ST[v][1] : '全部'} onChange={setStatus} />
        <input className="adm-in" placeholder="搜邮箱、标题" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && setQq(q.trim())} />
        <button className="btn g sm" onClick={() => setQq(q.trim())}>搜</button>
      </div>}>
      <Table id="admJobTbl" head={['时间', '用户', '标题', '成片类型', '样片 / 成片', '状态', '积分', '']} num={[6]} empty="没有符合的任务"
        rows={x.jobs.map(j => [fmtTime(j.createdAt), <span className="adm-note">{j.email}</span>, <span>{j.title}{j.error && <><br /><span className="adm-err">{j.error}</span></>}</span>, j.type,
          j.kind === 'video_final' ? <Chip k="dark">成片</Chip> : j.draft ? <Chip>样片</Chip> : <Chip>视频</Chip>,
          <Chip k={ST[j.status]?.[0] ?? ''}>{ST[j.status]?.[1] ?? j.status}</Chip>, fmtNum(j.cost),
          j.manualRefund ? <Chip k="warn">已人工退</Chip> : j.status === 'done' ? <button className="btn g sm" data-jobrefund={j.id} onClick={() => refund(j.id, j.title, j.cost)}>人工退点</button> : null])} />
    </Sec>
    <p className="adm-note" style={{ marginTop: 12 }}>暂停全站生成的开关在「数据总览」最下面。视频服务的地址、密钥、模型在「上游接口」里。</p>
  </div>;
}

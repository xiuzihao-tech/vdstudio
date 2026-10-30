// 今天：打开网站第一眼看到的页。最多两件今天要做的事（新账号第一件是做 AI 面诊——会议定了定位最值钱）、
// 三个大入口（用我拍的素材 / 我来说一段 / AI 做画面）、正在生成的任务、最近出的片、快到期的文件。
import { api, type DayView } from '../api.ts';
import { useApp, useData } from '../store.tsx';
import { Mod, useModOpen, useMods } from '../ui/mods.tsx';
import { Src } from '../ui/kit.tsx';
import { fileUrl } from '../config.ts';
import { SUBTYPES, typeOf, type VideoType } from '../../shared/video.ts';
import type { GenSettings, SlotView } from '../../shared/types.ts';

const seedFor = (id: VideoType): Partial<GenSettings> => { const t = typeOf(id); return { type: id, sub: SUBTYPES[id]?.[0]?.id, model: t.model, bgm: t.bgm, avatar: 'none' }; };
const ENTRIES: [string, VideoType, string, string][] = [
  ['real', 'real', '用我拍的素材', '工地、案例、门店随手拍的几段，AI 看懂后写文案、配音、串成片'],
  ['talk', 'talk', '我来说一段', '说一个观点或避坑，AI 帮你写成口播稿，配上画面'],
  ['aiVideo', 'tour', 'AI 做画面', '没有素材也能做：空间漫游、改造前后、产品种草'],
];

export function TodayPage() {
  const { session, nav, setGenSeed } = useApp();
  const mods = useMods();
  useModOpen('today');
  const ops = mods.on('unlock') && mods.on('diag');
  const dg = useData(() => ops ? api.diagnosis() : Promise.resolve(null), [ops]);
  const plans = useData(() => mods.on('plan') ? api.plans() : Promise.resolve(null), [mods.on('plan')]);
  const jobs = useData(() => api.jobs(), []);
  const store = useData(() => mods.on('retention') ? api.storage() : Promise.resolve(null), [mods.on('retention')]);

  const today = session!.today;
  const slot = plans.data?.plans.flatMap(p => p.slots).find((s: DayView): s is SlotView => !('empty' in s) && s.date === today && !s.progress?.published);
  const noReport = ops && dg.data && !dg.data.diagnosis.report;
  const running = jobs.data?.jobs.filter(j => j.status === 'queued' || j.status === 'running') ?? [];
  const recent = jobs.data?.jobs.filter(j => j.status === 'done').slice(0, 3) ?? [];
  const expiring = store.data?.expiring ?? [];
  const go = (id: VideoType) => { setGenSeed(seedFor(id)); nav('gen'); };

  const first = noReport
    ? { id: 'todayDiag', k: '第一件事', t: '先做 15 分钟 AI 面诊', d: '聊聊你自己、你的专业和代理的品牌。AI 出三类标签和栏目，之后的计划和文案都按它来。', b: dg.data!.diagnosis.unlocked && Object.keys(dg.data!.diagnosis.answers).length ? '接着聊 →' : '开始面诊 →', act: () => nav({ view: 'ops', sub: 'diag' }) }
    : slot
      ? { id: 'todaySlot', k: `今天要发 · ${slot.column || slot.label}`, t: slot.topic.title, d: slot.why || slot.topic.hook || '按计划今天发这一条。', b: '去生成 →', act: () => { setGenSeed({ copy: `${slot.topic.title}\n${slot.topic.hook}`.trim(), title: slot.topic.title, topicId: slot.topicId }); nav('gen'); } }
      : { id: 'todayReal', k: '今天', t: '拍了什么都能做成片', d: '把手机里这几天拍的几段传上来，3 分钟出一条有配音、有字幕的片。', b: '传素材 →', act: () => go('real') };

  return <section className="view on" id="v-today"><div className="vb wrap" style={{ maxWidth: 1080 }}>
    <div className="hero tight" style={{ textAlign: 'left', padding: '40px 0 0' }}>
      <p className="eyebrow">{session!.workspace.positioning.name || '你好'} · 今天</p>
      <h1 className="d2">今天做<em>一件事</em>就好。</h1>
    </div>

    <div className="today">
      <div className="tcard main" id={first.id}>
        <span className="xs m3">{first.k}</span>
        <b className="t1">{first.t}</b>
        <p className="s m">{first.d}</p>
        <button className="btn y" onClick={first.act}>{first.b}</button>
      </div>
      {expiring.length > 0 && <div className="tcard warn" id="todayExpire">
        <span className="xs m3">快到期</span>
        <b className="t2">{expiring.length} 个文件 {Math.min(...expiring.map(e => e.daysLeft))} 天内到期</b>
        <p className="s m">上传的素材和生成的视频保存 {store.data!.retentionDays} 天，到期自动删除。要留着的先下载。</p>
        <button className="btn g" onClick={() => nav({ view: 'lib', sub: 'works' })}>去下载</button>
      </div>}
    </div>

    <Mod id="entries" soon={false}>
      <p className="lb" style={{ marginTop: 30 }}>做一条视频</p>
      <div className="entries" id="todayEntries">
        {ENTRIES.map(([mid, ty, n, d]) => <Mod key={mid} id={mid} soon={<div className="entry off" data-entry={ty}><b>{n}</b><span className="s m">{d}</span><span className="soonb sm">即将上线</span></div>}>
          <button className="entry" data-entry={ty} onClick={() => go(ty)}><b>{n}</b><span className="s m">{d}</span><span className="v">›</span></button>
        </Mod>)}
      </div>
    </Mod>

    {(running.length > 0 || recent.length > 0) && <>
      <p className="lb" style={{ marginTop: 30 }}>{running.length ? '正在生成' : '最近出的片'}</p>
      <div className="list" id="todayJobs">
        {running.map(j => <div key={j.id}><span>{j.title}<br /><span className="xs m3">{j.steps[Math.min(j.step, j.steps.length - 1)]}</span></span><Src k="gen">生成中</Src></div>)}
        {recent.map(j => <div key={j.id}><span>{j.title}<br /><span className="xs m3">{(j.output as { draft?: boolean } | null)?.draft ? '样片' : '成片'}</span></span>
          <span className="row" style={{ gap: 10 }}>{(j.output as { videoUrl?: string } | null)?.videoUrl && <a className="lnk xs" href={fileUrl((j.output as { videoUrl?: string }).videoUrl)} download>下载</a>}<button className="lnk xs" onClick={() => nav({ view: 'gen', sub: 'job', id: j.id })}>打开</button></span></div>)}
      </div>
    </>}
  </div></section>;
}

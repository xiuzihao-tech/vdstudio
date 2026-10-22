// 选题文案（大哲 IP 文案作战系统）：分区切换 + 从排期挑选题时的提示条。
import { useApp } from '../../store.tsx';
import { Steps } from '../../ui/kit.tsx';
import { Find } from './Find.tsx';
import { Copy } from './Copy.tsx';
import { Classroom, Cover, Mine, Tools } from './More.tsx';

const TABS: [string, string][] = [['find', '找选题'], ['copy', '写文案'], ['cover', '封面图文'], ['tools', '创作工具'], ['class', '实战课堂'], ['mine', '我的资产']];

export function IpPage() {
  const { route, nav, place, setPlace } = useApp();
  const tab = TABS.some(t => t[0] === route.sub) ? route.sub! : 'find';
  return <section className="view on" id="v-ip">
    <div className="vb wrap ipw">
      <div className="iphd">
        <div><p className="xs m3">大哲 IP · 文案作战系统</p><h1 className="d2" style={{ marginTop: 6 }}>先选题，再出片。</h1></div>
        <div className="ipnav"><div className="seg" id="ipTabs" role="group" aria-label="IP 分区">
          {TABS.map(([k, n]) => <button key={k} data-v={k} aria-pressed={tab === k} onClick={() => nav({ view: 'ip', sub: k, id: k === 'copy' && route.sub === 'copy' ? route.id : undefined })}>{n}</button>)}
        </div></div>
      </div>
      <Steps cur={tab === 'copy' ? 'copy' : 'find'} />
      {place && <div className="banner"><span>正在为 <b>{place.label}</b> 挑选题。点卡片上的“放到这天”，就固定到这一天。</span><span className="sp" /><button className="btn g sm" onClick={() => { setPlace(null); nav('plan'); }}>取消</button></div>}
      {tab === 'find' && <Find />}
      {tab === 'copy' && <Copy topicId={route.id} />}
      {tab === 'cover' && <Cover topicId={route.id} />}
      {tab === 'tools' && <Tools />}
      {tab === 'class' && <Classroom />}
      {tab === 'mine' && <Mine />}
    </div>
  </section>;
}

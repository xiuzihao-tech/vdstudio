import { createRoot } from 'react-dom/client';
import { AppProvider, useApp } from './store.tsx';
import { Header, Icons } from './ui/shell.tsx';
import { IpPage } from './pages/ip/IpPage.tsx';
import { GenPage } from './pages/Gen.tsx';
import { Workbench } from './pages/Workbench.tsx';
import { OpsPage } from './pages/AiOps.tsx';
import { MePage } from './pages/Me.tsx';
import { useOnboarding } from './ui/onboarding.tsx';
import { LibraryPage } from './pages/Library.tsx';
import { LoginScreen } from './ui/auth.tsx';
import { AdminPage } from './pages/Admin.tsx';
import { FeedbackButton } from './ui/feedback.tsx';
import { TodayPage } from './pages/Today.tsx';
import { SoonCard, useMods } from './ui/mods.tsx';
import { TAB_MODS } from './ui/shell.tsx';

function Pages() {
  const { session, route, needLogin, nav } = useApp();
  const mods = useMods();
  useOnboarding();
  if (needLogin) return <LoginScreen />;
  if (!session) return <div className="vb wrap" style={{ paddingTop: 120, textAlign: 'center' }}><p className="s m">加载中…</p></div>;
  // key：切换人设时整页重挂载，避免上一个工作区的状态残留
  const k = session.workspace.id;
  // 模块开关：这个区的模块全是预告就显示「即将上线」，全关了就说还没开放
  const ids = TAB_MODS[route.view === 'plan' ? 'ops' : route.view];
  if (route.view === 'home' && !mods.on('today')) return <GenPage key={k} />;
  if (ids && route.view !== 'home' && !mods.any(...ids)) return <section className="view on" id="v-closed"><div className="vb wrap" style={{ maxWidth: 640, paddingTop: 80 }}>
    {mods.anyShown(...ids) ? ids.filter(mods.shown).map(id => <SoonCard key={id} id={id} />) : <p className="s m" style={{ textAlign: 'center' }}>这个功能还没开放。</p>}
    <div style={{ textAlign: 'center', marginTop: 20 }}><button className="btn g" onClick={() => nav('home')}>回到今天</button></div>
  </div></section>;
  switch (route.view) {
    case 'home': return <TodayPage key={k} />;
    case 'ip': return <IpPage key={k} />;
    case 'gen': return <GenPage key={k} />;
    case 'wb': return <Workbench key={k} />;
    case 'plan': case 'ops': return <OpsPage key={k} />;
    case 'me': return <MePage key={k} />;
    case 'lib': return <LibraryPage key={k} />;
    case 'admin': return <AdminPage key={k} />;
    default: return <GenPage key={k} />;
  }
}

function Foot() {
  const { session } = useApp();
  const mockParts = [session?.ai.copy === 'mock' && '文案', session?.ai.video === 'mock' && '视频'].filter(Boolean).join('和');
  return <footer className="foot">FIND AI × 大哲 联合出品 · {mockParts ? `开发版：${mockParts}为模拟结果` : '文案与视频由真实 AI 服务生成'}，热门选题为示意数据，“点”为占位单位</footer>;
}

function App() {
  return <AppProvider>
    <Icons />
    <Header />
    <main id="main"><Pages /></main>
    <Foot />
    <FeedbackButton />
  </AppProvider>;
}

createRoot(document.getElementById('root')!).render(<App />);

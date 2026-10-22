import { createRoot } from 'react-dom/client';
import { AppProvider, useApp } from './store.tsx';
import { Header, Icons } from './ui/shell.tsx';
import { Home } from './pages/Home.tsx';
import { IpPage } from './pages/ip/IpPage.tsx';
import { GenPage } from './pages/Gen.tsx';
import { Workbench } from './pages/Workbench.tsx';
import { PlanPage } from './pages/Plan.tsx';
import { LibraryPage } from './pages/Library.tsx';

function Pages() {
  const { session, route } = useApp();
  if (!session) return <div className="vb wrap" style={{ paddingTop: 120, textAlign: 'center' }}><p className="s m">加载中…</p></div>;
  // key：切换人设时整页重挂载，避免上一个工作区的状态残留
  const k = session.workspace.id;
  switch (route.view) {
    case 'ip': return <IpPage key={k} />;
    case 'gen': return <GenPage key={k} />;
    case 'wb': return <Workbench key={k} />;
    case 'plan': return <PlanPage key={k} />;
    case 'lib': return <LibraryPage key={k} />;
    default: return <Home key={k} />;
  }
}

function App() {
  return <AppProvider>
    <Icons />
    <Header />
    <main id="main"><Pages /></main>
    <footer className="foot">FIND AI × 大哲 联合出品 · 开发版：AI 能力为 Mock，热门选题为示意数据，“点”为占位单位，模型参数以实际接入为准</footer>
  </AppProvider>;
}

createRoot(document.getElementById('root')!).render(<App />);

// 模块开关：整站拆成 9 个区、50 个模块（对应《视频站 · 模块化 demo 方案》的模块清单）。
// 每个模块在后台单独设成 开放 / 内测 / 预告 / 隐藏；可以另外标「专家版」（没解锁 AI 运营的人看到解锁页）。
// 前端按算好的状态显示入口，后端按 API_MODULES 拦接口，两边用同一份规则。

export type ModState = 'on' | 'beta' | 'soon' | 'off';
/** 给某个用户算出来的状态：on 能用；soon 显示「即将上线」；off 什么都不显示 */
export type ModView = 'on' | 'soon' | 'off';
export type Phase = 1 | 2 | 3;
export type Zone = '今天' | '做视频' | '初版与修改' | '发布' | 'AI 运营' | '我的' | '账号与点数' | '老师与获客' | '品牌方';

export interface ModuleDef {
  id: string; zone: Zone; n: string; d: string; phase: Phase;
  /** 会议定的重点（一期 · 先做） */
  first?: boolean;
  /** 默认是专家版（AI 运营整块付费解锁） */
  pro?: boolean;
  parent?: string;
  /** 来源：会议 N / 会议 / 原有 / 方案 */
  src: string;
}

export const MODULES: ModuleDef[] = [
  { id: 'today', zone: '今天', n: '今天页', d: '今天要做的 1–2 件事（新账号第一件是做面诊）、生成进度、最近出的片', phase: 1, src: '方案' },
  { id: 'entries', zone: '今天', n: '三个大入口', d: '用我拍的素材 / 我来说一段 / AI 做画面', phase: 1, parent: 'today', src: '方案' },

  { id: 'real', zone: '做视频', n: '实拍出片', d: '传视频和照片 → AI 看懂每段 → 写文案 → 每句配一段原片 → 配音合成', phase: 1, src: '会议 7' },
  { id: 'subtypes', zone: '做视频', n: '小类模板和样片', d: '大类 → 小类，每个小类带镜头模板、提示词和样片；模板在后台配', phase: 1, src: '会议 8' },
  { id: 'copyKb', zone: '做视频', n: '用知识库写文案', d: '「用我的知识库」开关 + 用法 skill，不重复同一个卖点', phase: 1, parent: 'kb', src: '会议 6' },
  { id: 'talk', zone: '做视频', n: '我来说一段', d: '写口播稿，配画面出片', phase: 1, src: '原有' },
  { id: 'teleprompter', zone: '做视频', n: '提词器自拍', d: '手机上看稿录一段，自动去停顿、配字幕', phase: 2, parent: 'talk', src: '方案' },
  { id: 'aiVideo', zone: '做视频', n: 'AI 做画面', d: '空间漫游、改造前后、产品种草、案例故事、工地记录、Vlog', phase: 1, src: '原有' },
  { id: 'draft', zone: '做视频', n: '样片模式', d: '先出低价样片，满意后再出 1080p；用户点了才出', phase: 1, parent: 'aiVideo', src: '原有' },
  { id: 'avatarShot', zone: '做视频', n: '数字人出镜', d: '口播由真人分身或照片形象出镜', phase: 3, parent: 'avatars', src: '原有' },
  { id: 'proMode', zone: '做视频', n: '专业模式', d: '分镜表格和高级参数（模型、景别、运镜、语速、种子……）', phase: 1, src: '原有' },

  { id: 'firstCut', zone: '初版与修改', n: '初版页', d: '播放器 + 镜头卡 + 设置条，一个主按钮', phase: 1, src: '方案' },
  { id: 'shotEdit', zone: '初版与修改', n: '单镜修改', d: '改台词、换素材、换一段（选起点）、重做这一镜', phase: 1, src: '原有' },
  { id: 'reaudio', zone: '初版与修改', n: '换配音 / 换音乐', d: '画面不重做，只重新配音或换音乐', phase: 1, src: '原有' },
  { id: 'extend', zone: '初版与修改', n: '再长一点', d: 'Seedance 2.5 延长，向前或向后续几秒', phase: 2, parent: 'shotEdit', src: '方案' },
  { id: 'shotRedraw', zone: '初版与修改', n: '改这一镜画面', d: 'Seedance 2.5 编辑：换主体、加减物体、局部重绘', phase: 2, parent: 'shotEdit', src: '方案' },
  { id: 'sayEdit', zone: '初版与修改', n: '说一句话改', d: '「第 3 镜换成黄昏」→ AI 拆成具体操作，先报价再执行', phase: 2, src: '方案' },
  { id: 'subtitleEdit', zone: '初版与修改', n: '字幕样式和改字', d: '换字幕样式、改错字、重点词加粗', phase: 2, src: '方案' },

  { id: 'publishPack', zone: '发布', n: '发布包', d: '3 个标题、话题、简介一键复制，手机存相册', phase: 1, src: '原有' },
  { id: 'wechatGuide', zone: '发布', n: '微信里的下载引导', d: '在微信里打开时提示「在浏览器打开」', phase: 1, src: '方案' },
  { id: 'cover', zone: '发布', n: 'AI 封面', d: '挑一帧加大字标题', phase: 2, parent: 'publishPack', src: '方案' },
  { id: 'douyinShare', zone: '发布', n: '分享到抖音', d: '手机上跳到抖音发布页，标题和话题填好', phase: 2, parent: 'publishPack', src: '方案' },

  { id: 'unlock', zone: 'AI 运营', n: '付费解锁', d: '没解锁时 AI 运营只显示介绍、报告示例和解锁按钮', phase: 1, first: true, src: '会议 2' },
  { id: 'diag', zone: 'AI 运营', n: 'AI 面诊', d: '按个人、专业、品牌三块聊；退出能接着聊，回答都进知识库', phase: 1, first: true, pro: true, parent: 'unlock', src: '会议 2' },
  { id: 'diagLinks', zone: 'AI 运营', n: '贴链接和截图', d: '面诊时传资料、贴主页链接或截图，用来拆账号现状', phase: 1, first: true, pro: true, parent: 'diag', src: '会议 2' },
  { id: 'diagVoice', zone: 'AI 运营', n: '语音回答', d: '按住说话，转成文字', phase: 2, parent: 'diag', src: '方案' },
  { id: 'report', zone: 'AI 运营', n: '面诊报告', d: '三类标签、账号现状、视觉和头像昵称简介建议、栏目，可改、可重新生成', phase: 1, first: true, pro: true, parent: 'diag', src: '会议 3' },
  { id: 'reportExport', zone: 'AI 运营', n: '报告导出', d: '导出成图片或 PDF，发给老师和学员', phase: 2, parent: 'report', src: '方案' },
  { id: 'plan', zone: 'AI 运营', n: '两周计划', d: '按「每个栏目几条」排，每条带栏目、视频类型和一句为什么', phase: 1, first: true, pro: true, parent: 'report', src: '会议 4' },
  { id: 'autoCopy', zone: 'AI 运营', n: '自动写文案', d: '托管两档（只排计划 / 自动写文案），任何档位都不自动花点数', phase: 1, first: true, pro: true, parent: 'plan', src: '会议 1' },
  { id: 'review', zone: 'AI 运营', n: '复盘回填', d: '发布后填播放、点赞、评论、私信，导出表格', phase: 1, parent: 'plan', src: '原有' },
  { id: 'colStats', zone: 'AI 运营', n: '栏目效果和调计划', d: '按栏目看私信和播放，AI 调下周配比', phase: 2, parent: 'review', src: '方案' },

  { id: 'works', zone: '我的', n: '作品', d: '出过的片，点开接着改', phase: 1, src: '原有' },
  { id: 'assets', zone: '我的', n: '素材库', d: '上传、时长、说明、示例素材', phase: 1, src: '原有' },
  { id: 'retention', zone: '我的', n: '保存期限和容量', d: '只存上传的和生成的；期限和容量后台设，到期前 7 天提醒下载', phase: 1, parent: 'assets', src: '会议 9' },
  { id: 'netdisk', zone: '我的', n: '网盘式存储', d: '素材长期存、分文件夹，和 AI 运营打包卖', phase: 3, parent: 'assets', src: '会议' },
  { id: 'assetSearch', zone: '我的', n: '素材资产库', d: 'AI 标空间、工艺、材料，能搜「护墙板收口特写」', phase: 3, parent: 'netdisk', src: '方案' },
  { id: 'kb', zone: '我的', n: '知识库', d: '个人 / 专业 / 品牌三块，增删改；改了提示「可重新提取」', phase: 1, src: '会议 5' },
  { id: 'kbImport', zone: '我的', n: '资料导入', d: '一条可以是一份文件或一个链接', phase: 1, parent: 'kb', src: '会议 5' },
  { id: 'xhsCollect', zone: '我的', n: '一键采集小红书', d: '贴小红书笔记链接，一键收进来做参考', phase: 3, parent: 'kbImport', src: '会议' },
  { id: 'voiceClone', zone: '我的', n: '声音复刻', d: '录 30 秒，配音用本人声音', phase: 2, src: '原有' },
  { id: 'avatars', zone: '我的', n: '数字人形象', d: '真人分身、照片形象，带本人授权', phase: 3, src: '原有' },

  { id: 'login', zone: '账号与点数', n: '登录注册', d: '手机号验证码或微信登录', phase: 1, src: '原有' },
  { id: 'points', zone: '账号与点数', n: '点数和兑换码', d: '余额、流水、兑换码', phase: 1, src: '原有' },
  { id: 'recharge', zone: '账号与点数', n: '充值', d: '微信 / 支付宝买点数，或和课程打包', phase: 2, parent: 'points', src: '方案' },
  { id: 'invite', zone: '账号与点数', n: '邀请有礼', d: '邀请链接，双方得点数', phase: 2, parent: 'points', src: '原有' },

  { id: 'teacher', zone: '老师与获客', n: '老师后台', d: '学员列表、面诊、计划、发布率', phase: 2, src: '方案' },
  { id: 'annotate', zone: '老师与获客', n: '批注和复核', d: '老师在草稿和报告上批注，修改存成样本', phase: 2, parent: 'teacher', src: '方案' },
  { id: 'booking', zone: '老师与获客', n: '预约页和线索', d: '每个学员一个预约链接，线索归到哪条视频', phase: 3, src: '方案' },

  { id: 'dealer', zone: '品牌方', n: '经销商版', d: '品牌给经销商开账号，提供官方素材、卖点和合规话术', phase: 3, src: '方案' },
];

export const MODULE_IDS = MODULES.map(m => m.id);
const BY_ID = new Map(MODULES.map(m => [m.id, m]));
export const moduleOf = (id: string) => BY_ID.get(id);

export type Preset = 'phase1' | 'phase2' | 'all';
export const PRESETS: Record<Preset, string> = { phase1: '只开一期', phase2: '开一期和二期', all: '全部打开' };
const PHASE_OF: Record<Preset, Phase> = { phase1: 1, phase2: 2, all: 3 };
export const presetStates = (p: Preset): Record<string, ModState> => Object.fromEntries(MODULES.map(m => [m.id, m.phase <= PHASE_OF[p] ? 'on' : 'off']));

/** 存在设置表里的整份配置 */
export interface ModuleConfig {
  preset: Preset;
  states: Record<string, ModState>;
  /** 内测名单：账号邮箱 */
  beta: string[];
  /** 标了专家版的模块 */
  pro: string[];
  /** 解锁价格（点）；纪要里待定，后台填 */
  price: number;
  /** 上传素材和成片保存几天（0 = 不限）、每个账号能存多少 MB（0 = 不限）；纪要里待定，后台填 */
  retentionDays: number;
  capacityMb: number;
}
export const defaultConfig = (preset: Preset = 'all', price = 300): ModuleConfig => ({ preset, states: presetStates(preset), beta: [], pro: MODULES.filter(m => m.pro).map(m => m.id), price, retentionDays: 0, capacityMb: 0 });

/** 读设置表里的配置：缺的模块按套用补上，未知模块丢掉（模块清单改了也不会坏） */
export function normalizeConfig(raw: unknown, fallback: Preset, price: number): ModuleConfig {
  const base = defaultConfig(fallback, price);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<ModuleConfig>;
  const preset: Preset = r.preset && r.preset in PRESETS ? r.preset : fallback;
  const fromPreset = presetStates(preset);
  const states: Record<string, ModState> = {};
  for (const id of MODULE_IDS) { const v = r.states?.[id]; states[id] = v === 'on' || v === 'beta' || v === 'soon' || v === 'off' ? v : fromPreset[id]; }
  return {
    preset, states,
    beta: Array.isArray(r.beta) ? r.beta.filter(x => typeof x === 'string').map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 500) : [],
    pro: Array.isArray(r.pro) ? r.pro.filter(x => BY_ID.has(x)) : base.pro,
    price: typeof r.price === 'number' && r.price >= 0 ? Math.round(r.price) : price,
    retentionDays: typeof r.retentionDays === 'number' && r.retentionDays >= 0 ? Math.round(r.retentionDays) : 0,
    capacityMb: typeof r.capacityMb === 'number' && r.capacityMb >= 0 ? Math.round(r.capacityMb) : 0,
  };
}

/**
 * 给某个用户算每个模块看到什么：内测只给名单里的人；父模块看不到，子模块也看不到；
 * 父模块是预告，子模块不单独出现（入口只有父模块那一个）。
 */
export function viewFor(cfg: ModuleConfig, email: string | null): Record<string, ModView> {
  const inBeta = !!email && cfg.beta.includes(email.toLowerCase());
  const out: Record<string, ModView> = {};
  const calc = (id: string, depth = 0): ModView => {
    if (out[id]) return out[id];
    const m = BY_ID.get(id)!, s = cfg.states[id] ?? 'off';
    let v: ModView = s === 'on' ? 'on' : s === 'beta' ? (inBeta ? 'on' : 'off') : s === 'soon' ? 'soon' : 'off';
    if (m.parent && depth < 10 && calc(m.parent, depth + 1) !== 'on') v = 'off';
    return (out[id] = v);
  };
  for (const id of MODULE_IDS) calc(id);
  return out;
}

/** 打开一个子模块时，哪些父模块也得一起打开 */
export function closedParents(cfg: ModuleConfig, id: string): string[] {
  const out: string[] = [];
  let m = BY_ID.get(id);
  while (m?.parent) { const p = BY_ID.get(m.parent)!; if (cfg.states[p.id] === 'off' || cfg.states[p.id] === 'soon') out.push(p.id); m = p; }
  return out;
}

/**
 * 接口归哪个模块：模块对这个用户是 off 或 soon 时，接口直接拒绝（防止绕过页面调接口）。
 * 没登记的接口（会话、登录、后台、任务列表等）不受开关影响。
 */
export const API_MODULES: [string, RegExp, string][] = [
  ['PUT', /^\/api\/diagnosis\/report$/, 'report'],
  ['*', /^\/api\/diagnosis\/(answer|report)$/, 'diag'],
  ['*', /^\/api\/diagnosis\/attach/, 'diagLinks'],
  ['*', /^\/api\/plans/, 'plan'],
  ['*', /^\/api\/published/, 'review'],
  ['*', /^\/api\/kb\/import/, 'kbImport'],
  ['*', /^\/api\/kb/, 'kb'],
  ['*', /^\/api\/gen\/footage/, 'real'],
  ['*', /^\/api\/voice\/clone/, 'voiceClone'],
  ['*', /^\/api\/avatars/, 'avatars'],
  ['*', /^\/api\/covers/, 'cover'],
  ['POST', /^\/api\/points\/redeem/, 'points'],
];
export function moduleForApi(method: string, path: string): string | null {
  for (const [m, re, id] of API_MODULES) if ((m === '*' || m === method) && re.test(path)) return id;
  return null;
}

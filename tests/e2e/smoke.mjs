// 端到端冒烟：启动构建后的服务（临时数据目录），用 Playwright 走一遍主链路，并截图。
// 用法：npm run build && npm run test:e2e   （SHOTS=目录 可指定截图位置）
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = 5300 + Math.floor(Math.random() * 500);
const data = mkdtempSync(join(tmpdir(), 'findai-e2e-'));
const shots = process.env.SHOTS ?? join(data, 'shots');
mkdirSync(shots, { recursive: true });
const srv = spawn(process.execPath, ['--no-warnings', 'dist/server.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: data, MOCK_DELAY_MS: '60', ADMIN_EMAILS: 'boss@example.com', DAILY_JOBS_PER_USER: '50', RATE_LIMIT_PER_MIN: '600' }, stdio: 'inherit' });
const base = `http://localhost:${PORT}`;
for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/session'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }

const errors = [];
let closing = false;
let failed = 0;
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
async function run(name, fn) {
  try { await fn(); console.log('ok  ', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n     ', String(e.message).split('\n').slice(0, 3).join(' | ')); await page.screenshot({ path: join(shots, `FAIL_${failed}.png`) }).catch(() => {}); await page.keyboard.press('Escape').catch(() => {}); }
}

const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error' && !closing) errors.push(`console: ${m.text()}`); });
page.on('response', r => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.request().method()} ${r.url()}`); });
const $ = (s, o) => page.locator(s, o);
const shot = n => page.screenshot({ path: join(shots, `${n}.png`), fullPage: true });

await page.goto(base + '/gen');
const COPY = '你家玄关，是不是一进门就乱？\n这个项目，我们只解决了一件事。\n鞋、外套、快递，三样东西三个高度。\n凳面四十二公分，老人孩子都好坐。\n很多人装修只看效果图，没想过住进去以后每天怎么用。\n想看你家能怎么改，私信发户型图。';
await run('导航：视频 IP 5 个入口和 dazheip 菜单同级（苗苗原型），旧入口不在菜单里', async () => {
  const tabs = (await $('.tabs [data-go]').allTextContents()).map(t => t.replace(/\d+$|🔥/gu, ''));
  for (const t of ['大哲诊断账号', '一键生成视频', '管理我的素材', '安排发布计划', '查看作品数据']) if (!tabs.includes(t)) throw new Error('缺少入口 ' + t + '：' + tabs.join(','));
  for (const t of ['今天', 'AI 运营', '知识库与形象', '口播数字人', '数字人与品牌']) if (tabs.includes(t)) throw new Error('旧入口还在：' + t);
});
const hasFf = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
await run('实拍出片（默认）：上传区是主角、看素材写文案、镜头不超过素材长度、成片说明配音和音乐', async () => {
  await $('#gTypes [data-ty=real][aria-pressed=true]').waitFor();
  await $('#gToStep2').click();
  await $('#gDrop').waitFor();
  if (!(await $('#gNext').isDisabled())) throw new Error('没放素材也能下一步');
  if (!hasFf) return;
  // Playwright 往文件框塞中文文件名会静默失败（真实浏览器没这个问题），测试里用英文名
  const clips = [['hall-wide.mp4', 5], ['door-edge-closeup.mp4', 3]].map(([n, d]) => { const f = join(data, n); spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=360x640:rate=25:duration=${d}`, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', f]); return f; });
  const chooser = page.waitForEvent('filechooser'); await $('#gUpload').click(); await (await chooser).setFiles(clips);
  await page.waitForFunction(() => document.querySelectorAll('#gDrop .slots li.on').length === 2, null, { timeout: 15000 });
  await shot('00a_real_upload');
  await $('#gNext').click();
  await $('#gBoard .sbrow').first().waitFor({ timeout: 15000 });
  if (!(await $('#gBoard [aria-label=从第几秒开始]').count())) throw new Error('实拍镜头没有「从第几秒开始」');
  if (await $('#gBoard [aria-label=景别]').count()) throw new Error('实拍镜头还显示景别');
  const durs = await $('#gBoard [aria-label="时长（秒）"]').evaluateAll(t => t.map(x => Number(x.value)));
  if (durs[1] > 3) throw new Error('第二镜比素材还长：' + durs.join(','));
  await shot('00b_real_board');
  await $('#gGo').click(); await $('#payOk').click();
  await $('#gResult').waitFor({ timeout: 30000 });
  await $('#gAudioNote').waitFor({ timeout: 5000 });
  const note = await $('#gAudioNote').textContent();
  if (!/配音/.test(note)) throw new Error('成片没说明配音情况：' + note);
  await shot('00c_real_result');
  await $('[data-gs="1"]').click();
});
await run('生成第 1 步：8 种类型（实拍出片排第一）、小类带镜头清单', async () => {
  await $('#gTypes [data-ty]').nth(7).waitFor();
  if (await $('#gTypes [data-ty]').first().getAttribute('data-ty') !== 'real') throw new Error('实拍出片没有排第一');
  await $('[data-ty=talk]').click();
  await $('#gSub').waitFor();
  await shot('01_types');
  await $('#gToStep2').click();
});
await run('生成第 2 步：文案、比例只剩三种、高级参数', async () => {
  await $('#gCopy').fill(COPY);
  if (await $('#gCtl .pill', { hasText: '3:4' }).count()) throw new Error('3:4 还在');
  await $('#gAdv summary').click(); await $('#gAdv [data-gk=model][data-v=s20]').click();
  await shot('02_content');
  await $('#gNext').click();
});
await run('生成第 3 步：按句拆镜、一句不丢、逐镜可改', async () => {
  await $('#gBoard .sbrow').first().waitFor();
  const lines = (await $('#gBoard textarea[aria-label=台词]').evaluateAll(t => t.map(x => x.value))).join('');
  for (const k of ['玄关', '一件事', '三个高度', '好坐', '怎么用', '户型图']) if (!lines.includes(k)) throw new Error('分镜丢句：' + k);
  await $('#gBoard [aria-label=景别]').first().selectOption('特写');
  await $('#gBoard [aria-label=画面描述]').first().fill('玄关全景，鞋柜和换鞋凳，清晨暖光');
  await shot('03_board');
});
await run('生成 → 作品详情：轨道、单镜重做只收那一镜', async () => {
  const before = Number((await $('#bal').textContent()).replace(/,/g, ''));
  await $('#gGo').click(); await $('#payOk').click();
  await $('#gResult').waitFor({ timeout: 20000 });
  const jobs = (await (await page.request.get(base + '/api/jobs')).json()).jobs;
  const g = jobs[0].input;
  if (!g.shots?.length || g.shots[0].size !== '特写' || !g.shots[0].prompt.includes('鞋柜')) throw new Error('逐镜参数没传到后端');
  await shot('04_result');
  await $('#gResult .track .tr button').nth(1).click(); await $('.sheet .sf .btn.y').click();
  const label = await $('#shB .list').textContent();
  if (!/画面 · 1 镜/.test(label)) throw new Error('单镜重做的费用不对：' + label);
  await $('#payOk').click(); await page.waitForTimeout(1500);
  const j2 = (await (await page.request.get(base + '/api/jobs')).json()).jobs[0];
  if (j2.output?.shots?.filter(s => s.reused).length !== g.shots.length - 1) throw new Error('其余镜头没有沿用上一版');
  if (Number((await $('#bal').textContent()).replace(/,/g, '')) >= before) throw new Error('余额没变');
});
await run('形象与声音：建真人分身（带授权）→ 口播自动出镜', async () => {
  await page.goto(base + '/me'); await $('#meTabs button', { hasText: '形象与声音' }).click(); await $('[data-mk=clone]').click();
  if (!(await $('#avDemo').isDisabled())) throw new Error('没勾授权也能提交');
  await $('.sheet input[type=checkbox]').check(); await $('#avDemo').click();
  await page.waitForTimeout(400); await page.reload(); await $('#meClone2 .src', { hasText: '可用' }).waitFor();
  await shot('05_me');
  await $('#meClone2 .btn.y').click();
  await $('#gBoard .sbrow').first().waitFor();
  if (await $('#gBoard [aria-label=画面来源]').first().inputValue() !== 'avatar') throw new Error('真人口播首镜不是数字人');
  if (!/数字人/.test(await $('#v-gen .gbox .list').textContent())) throw new Error('费用里没有数字人');
});
await run('AI 运营：付费解锁 → AI 面诊 → 报告 → 栏目进排期', async () => {
  await page.goto(base + '/ops'); await $('#unlockBtn').waitFor();
  await shot('06a_unlock');
  await $('#unlockBtn').click(); await $('#unlockOk').click();
  const ans = ['原来在家装公司做了五年，后来自己开了工作室，第一单是朋友介绍的', '周末喜欢带孩子去钓鱼', '发了一些完工的照片，点赞很少'];
  for (const a of ans) { await $('#diagIn').fill(a); await $('#diagNext').click(); await page.waitForTimeout(250); }
  await $('#diagIn').fill('一个 90 平的老房，预算二十万，业主说终于不想出门了');
  await shot('06b_diag');
  await $('#diagReport').click();
  await $('#diagReportView').waitFor({ timeout: 15000 });
  await shot('06c_report');
  const kb = (await (await page.request.get(base + '/api/kb')).json()).items;
  if (kb.filter(i => i.source.startsWith('面诊')).length < 4) throw new Error('面诊回答没存进知识库');
  await $('#toPlan').click();
});
await run('AI 运营：托管只剩两档（不自动出样片）、待办、两周进度、导出表格', async () => {
  await $('#opsTodo').waitFor();
  if (await $('#opsAuto button', { hasText: '自动出样片' }).count()) throw new Error('自动出样片还在');
  await $('#opsAuto button', { hasText: '自动写文案' }).click(); await page.waitForTimeout(300);
  if (await $('#approveAll').count()) { await $('#approveAll').click(); await page.waitForTimeout(400); }
  await $('#strip .opsprog').first().waitFor();
  const dl = page.waitForEvent('download'); await $('#opsCsv').click(); await dl;
  await shot('06_ops');
});
await run('点数：兑换码不对会提示', async () => {
  closing = true; // 这里的 400 是预期的
  await $('#ptsBtn').click(); await $('#redeemIn').fill('NOPE1234'); await $('#redeemBtn').click();
  await page.getByText('兑换码不对').waitFor(); await page.waitForTimeout(200); await page.keyboard.press('Escape');
  closing = false;
  errors.splice(0, errors.length, ...errors.filter(e => !e.includes('/api/points/redeem')));
});
await run('知识库：三块、手动加一条', async () => {
  await page.goto(base + '/me'); await $('#meTabs button', { hasText: '知识库' }).click();
  await $('[data-kbadd=pro]').click(); await $('.kbform textarea').fill('鞋柜做到顶，留 15 公分放拖鞋');
  await $('[data-kbsave=pro]').click(); await $('#kbGrid .kbi', { hasText: '鞋柜做到顶' }).waitFor();
  await shot('05b_kb');
});
await run('作品：能打开作品详情；素材送去生成', async () => {
  await page.goto(base + '/lib'); await $('#works [data-open]').first().click(); await $('#gResult').waitFor();
  await page.goto(base + '/lib'); await $('#libTabs button', { hasText: '素材' }).click();
  const png = join(data, 'up.png');
  writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const chooser = page.waitForEvent('filechooser'); await $('#upBtn').click(); await (await chooser).setFiles(png);
  await $('[data-af=stay]').click();
  await $('[data-snd=gen]').click();
  await $('#gAtt img').first().waitFor();
  await shot('07_lib');
});
await run('视频 IP 新版：首页 → 四步出片（扣点）→ 加入发布队列 → 发布计划；诊断一键演示 → 选题进计划 → 发了 → 作品数据', async () => {
  await page.goto(base + '/'); await $('#mkDrop').waitFor();
  await $('[data-smp=s1]').click(); await $('#smpGo').click(); await $('#mkStep1').waitFor();
  if ((await $('#mkType').inputValue()) !== 'tour') throw new Error('做同款没带上类型');
  if (!(await $('#mkNext1').isDisabled())) throw new Error('什么都没放也能下一步');
  await $('#mkSamplesBtn').click(); await $('#mkStep1 .matgrid .mat').first().waitFor();
  await $('#mkAiWrite').waitFor();
  if (!/dazheip\.com\/$/.test(await $('#mkGoWrite').getAttribute('href'))) throw new Error('没文案的跳转不对');
  await $('#mkType').selectOption('auto'); await $('#mkSampleCopy').click();
  await $('#mkNext1').click(); await $('#mkStep2').waitFor();
  await $('#mkReco').waitFor();
  await $('#mkSwap [data-ty=talk]').click();
  if (!/真人口播/.test(await $('#mkReco').textContent())) throw new Error('换类没生效');
  await $('#mkAvSwap').click(); await $('[data-av=lin]').click();
  if (!/林设计师/.test(await $('#mkAvatar').textContent())) throw new Error('换数字人没生效');
  await shot('20_mk_step2');
  await $('#mkNext2').click(); await $('#mkShots li').first().waitFor();
  const before = Number((await $('#bal').textContent()).replace(/,/g, ''));
  await $('#mkSample').click(); await $('#mkCostSheet').waitFor(); await $('#mkPay').click();
  await $('#mkStep4').waitFor({ timeout: 10000 });
  await $('#mkFinal').waitFor({ timeout: 20000 });
  if (Number((await $('#bal').textContent()).replace(/,/g, '')) !== before - 25) throw new Error('样片没按 25 点扣');
  if (await $('#mkQueue').isEnabled()) throw new Error('只有样片也能进队列');
  await $('#mkFinal').click(); await $('#mkStage.final').waitFor();
  await page.waitForFunction(() => /5\/5/.test(document.querySelector('#mkPub')?.textContent ?? ''), null, { timeout: 20000 });
  if (Number((await $('#bal').textContent()).replace(/,/g, '')) !== before - 85) throw new Error('成片没按 60 点扣');
  if (!/5\/5/.test(await $('#mkPub').textContent())) throw new Error('发布清单没齐');
  if (await page.getByText('保存草稿').count()) throw new Error('还有保存草稿');
  await shot('21_mk_step4');
  await $('#mkQueue').click(); await $('#mkQueueOk').click();
  await $('#v-sched .ptr.hl').waitFor();
  await page.goto(base + '/diag'); await $('#dgUnlock').click(); await $('#payBody .qr').waitFor(); await $('#mockPay').click();
  await $('#dgChat').waitFor(); await $('#dgDemo').click();
  await $('#dgResult').waitFor({ timeout: 20000 });
  if (!/吃苦耐劳/.test(await $('#dgResult').textContent()) || await $('#dgResult .colname').first().inputValue() !== '法式大宅品鉴') throw new Error('盛哥演示的结果不对');
  await $('#dgNext').click();
  for (let i = 0; i < 4; i++) await $(`[data-ask="${i}"] button`).nth(2).click();
  await $('#dgTopics li').nth(14).waitFor();
  await $('#dgSave').click(); await $('#schDiagWait').waitFor();
  await $('#schConfirmAll').click();
  await $('#v-sched .seg button', { hasText: '全部' }).click();
  await $('[data-act=pub]').first().click();
  await page.goto(base + '/data'); await $('#dataTable .ptr').first().waitFor();
  if ((await $('#dataTable .ptr').count()) < 7) throw new Error('发了的没进作品数据');
});
await run('充值：余额进充值页 → 选套餐 → 扫码（模拟）→ 到账；订单和流水都有', async () => {
  await page.goto(base + '/'); await $('#ptsBtn').click(); await $('#v-pay [data-pkg]').first().waitFor();
  const before = Number((await $('#bal').textContent()).replace(/,/g, ''));
  await $('[data-pkg=p99]').click(); await $('#payGo').click(); await $('#payBody .qr svg').waitFor();
  await shot('22_pay_qr');
  await $('#mockPay').click(); await $('#payBody').waitFor({ state: 'detached' });
  await page.waitForFunction(b => Number(document.querySelector('#bal')?.textContent?.replace(/,/g, '')) === b + 1100, before);
  await $('#orders', { hasText: '已支付' }).waitFor(); await $('#ledger', { hasText: '充值' }).waitFor();
});
await run('账号：注册保留内容 → 退出 → 登录', async () => {
  await $('#loginBtn').click(); await $('#authForm .seg button', { hasText: '注册' }).click();
  await $('#auName').fill('林设计师'); await $('#auEmail').fill('lin@example.com'); await $('#auPw').fill('secret123'); await $('#auGo').click();
  await $('#whoBtn', { hasText: '林设计师 ·' }).waitFor();
  if (await $('#loginBtn').count()) throw new Error('注册后还显示登录按钮');
  const works = async () => (await (await page.request.get(base + '/api/jobs')).json()).jobs.length;
  const drafts = await works();
  if (!drafts) throw new Error('注册后作品丢了');
  await $('#whoBtn').click(); await $('#logoutBtn').click(); await $('#loginBtn').waitFor();
  await $('#loginBtn').click(); await $('#auEmail').fill('lin@example.com'); await $('#auPw').fill('secret123'); await $('#auGo').click();
  await $('#whoBtn', { hasText: '林设计师 ·' }).waitFor();
  if (await works() !== drafts) throw new Error('重新登录后作品数量不对');
});
await run('切换人设与主题', async () => {
  await $('#whoBtn').click(); await $('[data-pv=dev]').click(); await page.waitForTimeout(400);
  await page.goto(base + '/gen'); await $('[data-gs="1"]').click(); await $('#gTypes [data-ty]').first().waitFor();
  await $('#whoBtn').click(); await $('[data-th=cinema]').click(); await $('#shX').click();
  await shot('10_cinema');
});

await run('提意见 → 管理员后台：漏斗、反馈、邀请码、暂停生成', async () => {
  await $('#fbBtn').click(); await $('#fbTx').fill('生成按钮可以再显眼一点'); await $('#fbGo').click(); await page.waitForTimeout(300);
  const ctx2 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const a = await ctx2.newPage();
  a.on('pageerror', e => errors.push(`admin pageerror: ${e.message}`));
  // 后台不在前台显示；/admin 是后台登录页，普通账号登不进去
  await a.goto(base + '/admin');
  await a.locator('#admLogin').waitFor();
  await a.locator('#admEmail').fill('lin@example.com'); await a.locator('#admPw').fill('secret123'); await a.locator('#admGo').click();
  await a.locator('#admLogin .err', { hasText: '没有后台权限' }).waitFor();
  await a.goto(base);
  await a.locator('#loginBtn').click(); await a.locator('#authForm .seg button', { hasText: '注册' }).click();
  await a.locator('#auName').fill('管理员'); await a.locator('#auEmail').fill('boss@example.com'); await a.locator('#auPw').fill('secret123'); await a.locator('#auGo').click();
  await a.waitForTimeout(400);
  if (await a.locator('.tabs [data-go=admin]').count() || await a.getByText('后台', { exact: true }).count()) throw new Error('前台不该有后台入口');
  await a.goto(base + '/admin');
  // 后台是 dazheip 后台同款：明黄侧栏、管理权限、管理菜单；数据总览里有描边数据块、成片类型覆盖、漏斗
  await a.locator('#adm #admPerm', { hasText: '超级管理员' }).waitFor();
  await a.locator('#admTiles').waitFor();
  await a.locator('#funnel').waitFor();
  const funnel = await a.locator('#funnel').textContent();
  if (!/提交生成\s*\d/.test(funnel)) throw new Error('漏斗没数据：' + funnel);
  if (!(await a.locator('.adm-nav a', { hasText: '知识与情报' }).count())) throw new Error('dazheip 原有菜单不在');
  await a.screenshot({ path: join(shots, '11_admin.png'), fullPage: true });
  await a.locator('[data-adm=feedback]').click();
  await a.locator('#fbList', { hasText: '生成按钮可以再显眼一点' }).waitFor();
  await a.locator('[data-adm=codes]').click();
  await a.locator('#mkInv').click(); await a.locator('textarea[readonly]').first().waitFor();
  if (!(await a.locator('textarea[readonly]').first().inputValue()).includes('?invite=FD')) throw new Error('邀请链接不对');
  await a.locator('[data-adm=users]').click(); await a.locator('#userList', { hasText: 'lin@example.com' }).waitFor();
  await a.locator('[data-adm=overview]').click(); await a.locator('#pauseSw').uncheck(); await a.waitForTimeout(300);
  await page.goto(base + '/gen');
  await page.getByText('生成功能暂时关闭').waitFor();
  if (await page.locator('#gGo').count() && !(await page.locator('#gGo').isDisabled())) throw new Error('暂停后生成按钮还能点');
  await a.locator('#pauseSw').check();
  await ctx2.close();
});

await run('模块开关：管理员套用「只开一期」，学员看不到二三期；今天页先做面诊；面诊贴链接；知识库贴链接；切回全部打开', async () => {
  const ctx3 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const a = await ctx3.newPage();
  a.on('pageerror', e => errors.push(`mod pageerror: ${e.message}`));
  // 直接打开 /admin，用后台账号登录
  await a.goto(base + '/admin');
  await a.locator('#admEmail').fill('boss@example.com'); await a.locator('#admPw').fill('secret123'); await a.locator('#admGo').click();
  await a.locator('[data-adm=modules]').click();
  await a.locator('#modAdmin [data-preset=phase1]').click();
  await a.waitForTimeout(300);
  await a.locator('[data-mod=cover] [data-st=off][aria-pressed=true]').waitFor();
  await a.locator('[data-mod=extend] [data-st=soon]').click(); await a.waitForTimeout(300);
  await a.screenshot({ path: join(shots, '12_modules.png'), fullPage: true });
  // 学员（另一个浏览器，没登录）
  const ctx4 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const s = await ctx4.newPage();
  s.on('pageerror', e => errors.push(`student pageerror: ${e.message}`));
  await s.goto(base);
  await s.locator('#v-make #mkDrop').waitFor();
  await s.locator('#mkDiag').waitFor();
  await s.screenshot({ path: join(shots, '13_make_home.png'), fullPage: true });
  await s.goto(base + '/gen');
  await s.locator('#gTypes').waitFor();
  await s.locator('#gToStep2').click(); await s.locator('#gCtl').waitFor();
  await s.goto(base + '/me'); await s.locator('#kbGrid').waitFor();
  if (await s.locator('.tabs [data-go=talk]').count()) throw new Error('口播数字人不该再单独出现在菜单里');
  await s.locator('[data-kblink=pro]').click(); await s.locator('[data-kburl=pro]').fill('https://example.com/case/123'); await s.locator('[data-kburlgo=pro]').click();
  await s.locator('#kbGrid', { hasText: '打开链接' }).waitFor();
  await s.goto(base + '/ops/diag');
  await s.locator('#unlockBtn').click(); await s.locator('#unlockOk').click();
  await s.locator('#diagAttach').waitFor();
  await s.locator('#diagUrl').fill('https://v.douyin.com/abc123/'); await s.locator('#diagUrlGo').click();
  await s.locator('#diagAttList', { hasText: '抖音' }).waitFor();
  await s.screenshot({ path: join(shots, '14_diag_attach.png'), fullPage: true });
  // 管理员「按学员看」后台入口还在、导航和学员一致
  await a.locator('#admAsStudent').click(); await a.locator('.tabs [data-go=make]').click(); await a.locator('#v-make').waitFor();
  await a.locator('#stuChip button', { hasText: '回后台' }).click();
  await a.locator('#admBack').click(); await a.locator('#v-make').waitFor();
  if (await a.locator('#stuChip').count()) throw new Error('返回前台后还在按学员看');
  await a.goto(base + '/admin'); await a.locator('[data-adm=modules]').click();
  await a.locator('#modAdmin [data-preset=all]').click(); await a.waitForTimeout(300);
  await s.goto(base + '/talk'); await s.locator('#v-talk #talkStyles').waitFor();
  await ctx3.close(); await ctx4.close();
});

await run('后台：技能中心改参数存成新版本、试运行、恢复默认；改邀请奖励；上游接口能测试', async () => {
  const ctx5 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const a = await ctx5.newPage();
  a.on('pageerror', e => errors.push(`skills pageerror: ${e.message}`));
  await a.goto(base);
  await a.locator('#loginBtn').click(); await a.locator('#auEmail').fill('boss@example.com'); await a.locator('#auPw').fill('secret123'); await a.locator('#auGo').click();
  await a.waitForTimeout(300);
  await a.goto(base + '/admin/skills');
  await a.locator('#admSkillTbl [data-skill=publish-pack]').click();
  await a.locator('#admSkill[data-id=publish-pack]').waitFor();
  await a.locator('[data-tab=config]').click();
  const cfg = await a.locator('#skCfg').inputValue();
  if (!cfg.includes('"titleMax": 30')) throw new Error('参数里没有 titleMax');
  await a.locator('#skCfg').fill(cfg.replace('"titleMax": 30', '"titleMax": 28'));
  await a.locator('#skSave input').fill('标题短一点');
  await a.locator('#skSaveBtn').click();
  await a.locator('#admSkill .adm-chip', { hasText: '后台第 1 版' }).waitFor();
  const cat = await a.evaluate(() => fetch('/api/catalog').then(r => r.json()));
  if (cat.pack.titleMax !== 28) throw new Error('改了没生效：' + cat.pack.titleMax);
  await a.locator('[data-tab=test]').click(); await a.locator('#skRun').click(); await a.locator('#skOut').waitFor();
  await a.screenshot({ path: join(shots, '15_skill.png'), fullPage: true });
  await a.locator('[data-tab=versions]').click(); await a.locator('#skDefault').click();
  await a.locator('#admSkill .adm-chip', { hasText: '仓库默认' }).waitFor();
  await a.locator('[data-adm=referral]').click();
  await a.locator('#refInviter').fill('150');
  await a.locator('#refSave').click(); await a.waitForTimeout(400);
  const ref = await a.evaluate(() => fetch('/api/admin/referral').then(r => r.json()));
  if (ref.config.invite.inviterPoints !== 150) throw new Error('邀请奖励没存上');
  await a.locator('[data-adm=upstreams]').click();
  await a.locator('[data-up=up-llm] [data-uptest=up-llm]').click();
  await a.locator('[data-uptestout=up-llm]').waitFor();
  await a.screenshot({ path: join(shots, '16_upstreams.png') });
  await a.locator('[data-adm=audit]').click(); await a.locator('#admAuditTbl', { hasText: '保存技能' }).waitFor();
  await ctx5.close();
});

await run('邀请有礼：复制邀请链接 → 好友打开链接、顶部提示 → 注册 → 双方得点', async () => {
  const ctx6 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const a = await ctx6.newPage();
  a.on('pageerror', e => errors.push(`inviter pageerror: ${e.message}`));
  await a.goto(base);
  await a.locator('#loginBtn').click(); await a.locator('#auEmail').fill('boss@example.com'); await a.locator('#auPw').fill('secret123'); await a.locator('#auGo').click();
  await a.waitForTimeout(300);
  await a.locator('#inviteBtn').click();
  await a.locator('#inviteCard #inviteLink').waitFor();
  const link = await a.locator('#inviteLink').inputValue();
  if (!/\?ref=[A-Z0-9]{6,}$/.test(link)) throw new Error('邀请链接不对：' + link);
  const before = await a.evaluate(() => fetch('/api/billing').then(r => r.json()).then(j => j.balance));
  await a.locator('#invitePoster').click(); await a.locator('#posterSheet img').waitFor(); await a.keyboard.press('Escape');
  const ctx7 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const f = await ctx7.newPage();
  f.on('pageerror', e => errors.push(`invitee pageerror: ${e.message}`));
  await f.goto(link);
  await f.locator('#refBar', { hasText: '管理员' }).waitFor();
  await f.screenshot({ path: join(shots, '17_ref_banner.png') });
  await f.locator('#refReg').click();
  await f.locator('#auRef').waitFor();
  await f.locator('#auName').fill('小林'); await f.locator('#auEmail').fill('friend@example.com'); await f.locator('#auPw').fill('secret123'); await f.locator('#auGo').click();
  await f.waitForTimeout(500);
  const got = await f.evaluate(() => fetch('/api/ledger').then(r => r.json()).then(j => j.items.map(x => x.kind)));
  if (!got.includes('gift_invited')) throw new Error('好友没拿到受邀奖励：' + got.join(','));
  const after = await a.evaluate(() => fetch('/api/billing').then(r => r.json()).then(j => j.balance));
  if (after - before !== 150) throw new Error(`邀请人应该多 150 点，实际 ${after - before}`);
  await a.reload(); await a.locator('#inviteCard #inviteList', { hasText: '小林' }).waitFor();
  await ctx6.close(); await ctx7.close();
});

const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
m.on('pageerror', e => errors.push(`mobile pageerror: ${e.message}`));
await m.goto(base);
await run('手机宽度无横向滚动', async () => {
  for (const v of ['make', 'diag', 'mat', 'sched', 'data']) {
    await m.locator(`.tbar [data-go=${v}]`).click(); await m.waitForTimeout(400);
    const w = await m.evaluate(() => document.documentElement.scrollWidth);
    if (w > 392) throw new Error(`${v} 页宽 ${w}`);
    await m.screenshot({ path: join(shots, `m_${v}.png`) });
  }
});

closing = true; // 关浏览器时还在进行的请求会报 Failed to fetch，不算页面错误
await browser.close();
srv.kill();
console.log(`\n页面错误：${errors.length}`); errors.slice(0, 20).forEach(e => console.log('  ', e));
console.log(`截图：${shots}`);
if (!process.env.SHOTS) rmSync(data, { recursive: true, force: true });
process.exit(failed || errors.length ? 1 : 0);

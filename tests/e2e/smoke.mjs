// 端到端冒烟：启动构建后的服务（临时数据目录），用 Playwright 走一遍主链路，并截图。
// 用法：npm run build && npm run test:e2e   （SHOTS=目录 可指定截图位置）
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = 5300 + Math.floor(Math.random() * 500);
const data = mkdtempSync(join(tmpdir(), 'findai-e2e-'));
const shots = process.env.SHOTS ?? join(data, 'shots');
mkdirSync(shots, { recursive: true });
const srv = spawn(process.execPath, ['--no-warnings', 'dist/server.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: data, MOCK_DELAY_MS: '60', ADMIN_EMAILS: 'boss@example.com', DAILY_JOBS_PER_USER: '50' }, stdio: 'inherit' });
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

await page.goto(base);
const COPY = '你家玄关，是不是一进门就乱？\n这个项目，我们只解决了一件事。\n鞋、外套、快递，三样东西三个高度。\n凳面四十二公分，老人孩子都好坐。\n很多人装修只看效果图，没想过住进去以后每天怎么用。\n想看你家能怎么改，私信发户型图。';
await run('导航：4 个入口，选题文案和制作台已隐藏', async () => {
  const tabs = await $('.tabs [data-go]').allTextContents();
  for (const t of ['生成视频', 'AI 运营', '我的作品', '知识库与形象']) if (!tabs.includes(t)) throw new Error('缺少入口 ' + t);
  if (tabs.includes('制作台') || tabs.includes('选题文案')) throw new Error('隐藏的入口还在：' + tabs.join(','));
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
  await $('.tabs [data-go=me]').click(); await $('#meTabs button', { hasText: '形象与声音' }).click(); await $('[data-mk=clone]').click();
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
  await $('.tabs [data-go=ops]').click(); await $('#unlockBtn').waitFor();
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
  await $('.tabs [data-go=me]').click(); await $('#meTabs button', { hasText: '知识库' }).click();
  await $('[data-kbadd=pro]').click(); await $('.kbform textarea').fill('鞋柜做到顶，留 15 公分放拖鞋');
  await $('[data-kbsave=pro]').click(); await $('#kbGrid .kbi', { hasText: '鞋柜做到顶' }).waitFor();
  await shot('05b_kb');
});
await run('作品：能打开作品详情；素材送去生成', async () => {
  await $('.tabs [data-go=lib]').click(); await $('#works [data-open]').first().click(); await $('#gResult').waitFor();
  await $('.tabs [data-go=lib]').click(); await $('#libTabs button', { hasText: '素材' }).click();
  const png = join(data, 'up.png');
  writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const chooser = page.waitForEvent('filechooser'); await $('#upBtn').click(); await (await chooser).setFiles(png);
  await $('[data-af=stay]').click();
  await $('[data-snd=gen]').click();
  await $('#gAtt img').first().waitFor();
  await shot('07_lib');
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
  await $('.tabs [data-go=gen]').click(); await $('[data-gs="1"]').click(); await $('#gTypes [data-ty]').first().waitFor();
  await $('#whoBtn').click(); await $('[data-th=cinema]').click(); await $('#shX').click();
  await shot('10_cinema');
});

await run('提意见 → 管理员后台：漏斗、反馈、邀请码、暂停生成', async () => {
  await $('#fbBtn').click(); await $('#fbTx').fill('生成按钮可以再显眼一点'); await $('#fbGo').click(); await page.waitForTimeout(300);
  const ctx2 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const a = await ctx2.newPage();
  a.on('pageerror', e => errors.push(`admin pageerror: ${e.message}`));
  await a.goto(base);
  await a.locator('#loginBtn').click(); await a.locator('#authForm .seg button', { hasText: '注册' }).click();
  await a.locator('#auName').fill('管理员'); await a.locator('#auEmail').fill('boss@example.com'); await a.locator('#auPw').fill('secret123'); await a.locator('#auGo').click();
  await a.locator('.tabs [data-go=admin]').click();
  await a.locator('#funnel').waitFor();
  const funnel = await a.locator('#funnel').textContent();
  if (!/提交生成\s*\d/.test(funnel)) throw new Error('漏斗没数据：' + funnel);
  await a.screenshot({ path: join(shots, '11_admin.png'), fullPage: true });
  await a.locator('#v-admin .seg button', { hasText: '反馈' }).click();
  await a.locator('#fbList', { hasText: '生成按钮可以再显眼一点' }).waitFor();
  await a.locator('#v-admin .seg button', { hasText: '邀请码' }).click();
  await a.locator('#mkInv').click(); await a.locator('textarea[readonly]').waitFor();
  if (!(await a.locator('textarea[readonly]').inputValue()).includes('?invite=FD')) throw new Error('邀请链接不对');
  await a.locator('#v-admin .seg button', { hasText: '用户' }).click(); await a.locator('#userList', { hasText: 'lin@example.com' }).waitFor();
  await a.locator('#v-admin .seg button', { hasText: '概览' }).click(); await a.locator('#pauseSw').uncheck(); await a.waitForTimeout(300);
  await page.locator('.tabs [data-go=gen]').click(); await page.reload();
  await page.getByText('生成功能暂时关闭').waitFor();
  if (await page.locator('#gGo').count() && !(await page.locator('#gGo').isDisabled())) throw new Error('暂停后生成按钮还能点');
  await a.locator('#pauseSw').check();
  await ctx2.close();
});

const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
m.on('pageerror', e => errors.push(`mobile pageerror: ${e.message}`));
await m.goto(base);
await run('手机宽度无横向滚动', async () => {
  for (const v of ['gen', 'ops', 'lib', 'me']) {
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

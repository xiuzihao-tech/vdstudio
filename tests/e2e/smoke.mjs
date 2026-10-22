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
const srv = spawn(process.execPath, ['--no-warnings', 'dist/server.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: data, MOCK_DELAY_MS: '60' }, stdio: 'inherit' });
const base = `http://localhost:${PORT}`;
for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/session'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }

const errors = [];
let failed = 0;
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
async function run(name, fn) {
  try { await fn(); console.log('ok  ', name); }
  catch (e) { failed++; console.log('FAIL', name, '\n     ', String(e.message).split('\n').slice(0, 3).join(' | ')); await page.screenshot({ path: join(shots, `FAIL_${failed}.png`) }).catch(() => {}); await page.keyboard.press('Escape').catch(() => {}); }
}

const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('response', r => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.request().method()} ${r.url()}`); });
const $ = (s, o) => page.locator(s, o);
const shot = n => page.screenshot({ path: join(shots, `${n}.png`), fullPage: true });

await page.goto(base);
await run('首页：出 3 个选题 → 写文案', async () => {
  await $('#goBtn').click();
  await $('#topics .hc').nth(2).waitFor();
  await shot('01_home');
  await $('#topics [data-act=write]').first().click();
  await $('#cpTitle').waitFor();
});
await run('文案：违禁词替换、改写、改时长、存草稿', async () => {
  await shot('02_copy');
  await $('[data-rep]').first().click();
  await $('[data-cw=live]').click(); await page.waitForTimeout(300);
  await $('.cpset .seg').nth(1).locator('button', { hasText: '60 秒' }).click(); await page.waitForTimeout(400);
  await $('[data-bi2="0"]').fill('先说背景：测试改了一段正文。');
  await $('#cpSave').click(); await page.waitForTimeout(200);
});
await run('文案 → 简易生成 → 冲突修复 → 生成样片 → 转成片', async () => {
  await $('#toGen').click();
  await $('#gCopy').waitFor();
  if (!(await $('#gCopy').inputValue()).includes('测试改了一段正文')) throw new Error('文案没带过来');
  await $('[data-gk=model][data-v=s20f]').click();
  await $('.gbox .pill', { hasText: '4K' }).click({ force: true }); // 不支持，应提示（按钮带 aria-disabled）
  await $('[data-gk=voice][data-v=me]').click();
  await $('#gWarn [data-gf="voice:p1"]').waitFor();
  await $('#gWarn [data-gf="voice:p1"]').click();
  await $('[data-gk=model][data-v=s25]').click();
  await shot('03_gen');
  await $('#gGo').click(); await $('#payOk').click();
  await $('#goFinal').waitFor({ timeout: 8000 });
  await $('#goFinal').click(); await $('#payOk').click();
  await page.getByText('成片 · 1080p').waitFor({ timeout: 8000 });
  await shot('04_gen_done');
});
await run('生成 → 制作台：镜头、导入素材、换首帧、整条生成', async () => {
  await $('#gOut .btn', { hasText: '进制作台精修' }).click();
  await $('#srail [data-si]').first().waitFor();
  const n = await $('#srail [data-si]').count();
  await $('#wbAsset').click(); await $('#shB [data-pkk]').nth(0).click(); await $('#shB [data-pkk]').nth(1).click(); await $('#pkOk').click();
  await $('#wmAdd').click();
  if (await $('#srail [data-si]').count() !== n + 2) throw new Error('素材没加成镜头');
  await $('#wbLine').fill('新加的一镜台词');
  await shot('05_wb');
  await $('#wbGo').click(); await $('#payOk').click();
  await page.getByText('已生成').waitFor({ timeout: 8000 });
});
await run('IP：筛选、案例策划、对标复刻、素材创作、深挖、收藏', async () => {
  await $('.tabs [data-go=ip]').click();
  await $('[data-ff=dir] [data-v=知识科普]').click();
  await page.waitForTimeout(300);
  const n1 = await $('#hot .hc').count();
  await $('[data-ff=cat] [data-v=all]').click(); await page.waitForTimeout(300);
  if ((await $('#hot .hc').count()) <= n1) throw new Error('放宽品类后数量没变多');
  await $('[data-en=case]').click(); await $('#caseTx').fill('海景房主卧衣帽间'); await $('#caseGo').click(); await $('#caseOut .hc').nth(2).waitFor();
  await shot('06_ip_find');
  await $('#hot [data-act=fav]').first().click();
  await $('#hot [data-act=dig]').first().click(); await $('#shB [data-ang]').first().click();
  await $('#cpTitle').waitFor();
  await $('#ipTabs [data-v=find]').click();
  await $('[data-en=bench]').click(); await $('#benchGo').click(); await $('#benchUse').click(); await $('#cpTitle').waitFor();
  await $('#ipTabs [data-v=find]').click();
  await $('[data-en=mat]').click(); await $('[data-am]').first().click(); await $('#matGo').click(); await $('#cpTitle').waitFor();
});
await run('IP 工具：违禁词、声音克隆（无麦克风走演示样本）、视频提文案', async () => {
  await $('#ipTabs [data-v=tools]').click();
  await $('[data-tool=ban]').click(); await $('#tGo').click(); await $('#tFix').click(); await $('#shX').click();
  await $('[data-tool=clone]').click(); await $('#recB').click(); await page.waitForTimeout(2200); await $('#recOk').check(); await $('#recGo').click();
  await page.getByText('已克隆').waitFor({ timeout: 8000 });
  await $('[data-tool=v2c]').click(); await $('#tIn').fill('https://v.douyin.com/x'); await $('#tGo').click();
  await $('#shB .btn', { hasText: '送去写文案' }).click(); await $('#cpTitle').waitFor();
  for (const t of ['cover', 'class', 'mine']) { await $(`#ipTabs [data-v=${t}]`).click(); await page.waitForTimeout(200); }
  await shot('07_ip_mine');
});
await run('排期：通过、换一个、从选题库挑（跨页放回）、全部通过、备选池', async () => {
  await $('.tabs [data-go=plan]').click();
  await $('#pre .pc').first().waitFor();
  await shot('08_plan');
  const cand = () => $('#pre .pc.cand');
  const c0 = await cand().count();
  if (!c0) throw new Error('没有待审的预选题');
  await cand().first().locator('[data-pa2=ok]').click(); await page.waitForTimeout(300);
  if (await cand().count() !== c0 - 1) throw new Error('通过后数量不对');
  const before = await cand().first().locator('.t2').textContent();
  await cand().first().locator('[data-pa2=next]').click(); await page.waitForTimeout(300);
  if (await cand().first().locator('.t2').textContent() === before) throw new Error('换一个没换');
  await cand().first().locator('[data-pa2=lib]').click(); await $('#tpIp').click();
  await $('.banner').waitFor();
  const want = await $('#hot .hc h3').nth(3).textContent();
  await $('#hot [data-act=place]').nth(3).click();
  await $('#pre').waitFor();
  if (!(await $('#pre').textContent()).includes(want)) throw new Error('从选题库挑的选题没放进排期');
  await $('.tabs [data-go=ip]').click(); await $('#hot [data-act=sch]').nth(5).click(); await $('#ssBack').click();
  await $('.tabs [data-go=plan]').click(); await $('#backlog [data-bk]').first().waitFor();
  await $('#preAll').click(); await page.waitForTimeout(300);
  if (await cand().count()) throw new Error('全部通过后还有待审');
  await $('#wkd button').nth(0).click(); await page.waitForTimeout(300);
});
await run('素材：上传真实文件、多选、送去简易生成', async () => {
  await $('.tabs [data-go=lib]').click(); await $('#libTabs button', { hasText: '素材' }).click();
  const png = join(data, 'up.png');
  writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const chooser = page.waitForEvent('filechooser'); await $('#upBtn').click(); await (await chooser).setFiles(png);
  await $('[data-af=stay]').click();
  await $('#aSel').waitFor();
  await $('#assets [data-as]').nth(1).click();
  await shot('09_lib');
  await $('[data-snd=gen]').click();
  await $('#gAtt img').first().waitFor();
});
await run('切换人设与主题', async () => {
  await $('#whoBtn').click(); await $('[data-pv=dev]').click(); await page.waitForTimeout(400);
  await $('.tabs [data-go=ip]').click(); await $('#hot .hc').first().waitFor();
  await $('#whoBtn').click(); await $('[data-th=cinema]').click(); await $('#shX').click();
  await shot('10_cinema');
});

const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
m.on('pageerror', e => errors.push(`mobile pageerror: ${e.message}`));
await m.goto(base);
await run('手机宽度无横向滚动', async () => {
  for (const v of ['ip', 'gen', 'plan', 'lib']) {
    await m.locator(`.tbar [data-go=${v}]`).click(); await m.waitForTimeout(400);
    const w = await m.evaluate(() => document.documentElement.scrollWidth);
    if (w > 392) throw new Error(`${v} 页宽 ${w}`);
    await m.screenshot({ path: join(shots, `m_${v}.png`) });
  }
});

await browser.close();
srv.kill();
console.log(`\n页面错误：${errors.length}`); errors.slice(0, 20).forEach(e => console.log('  ', e));
console.log(`截图：${shots}`);
if (!process.env.SHOTS) rmSync(data, { recursive: true, force: true });
process.exit(failed || errors.length ? 1 : 0);

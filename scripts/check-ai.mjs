// 检测 AI 接口：读 .env → 拉两个站的模型列表 → 自动挑默认文案模型并实测 → （加 --video）实测一条最便宜的视频。
// 结果写到 ai-check.json（不进 git），并按需把 LLM_MODEL 写回 .env。
// 用法：node scripts/check-ai.mjs [--video] [--write]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
if (!existsSync('.env')) { console.error('没有 .env，先运行一次 npm run local'); process.exit(1); }
const envText = readFileSync('.env', 'utf8');
const env = Object.fromEntries(envText.split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()]; }));
const out = { at: new Date().toISOString(), llm: {}, video: {} };
const t = ms => new Promise(r => setTimeout(r, ms));
const j = async (url, key, init = {}) => {
  const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(init.timeout ?? 30000) });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, body };
};
const ids = b => (b?.data ?? []).map(m => m.id).sort();

// 中文写作好、性价比高的优先
const PREFER = [/^deepseek-v\d/i, /deepseek-chat/i, /^qwen3?-max/i, /^qwen/i, /gpt-5\.\d-terra/i, /^gpt-5/i, /claude-sonnet/i, /gemini/i];
const NOT_TEXT = /(seedance|wan\d|video|image|embedding|tts|whisper|dall|veo|kling|sora|minimax-h|rerank|audio|vision-only)/i;

if (env.LLM_BASE_URL && env.LLM_API_KEY) {
  const base = env.LLM_BASE_URL.replace(/\/$/, '');
  try {
    const m = await j(`${base}/models`, env.LLM_API_KEY);
    const text = ids(m.body).filter(x => !NOT_TEXT.test(x));
    out.llm = { base, modelsStatus: m.status, count: text.length, models: text };
    const pick = env.LLM_MODEL && text.includes(env.LLM_MODEL) ? env.LLM_MODEL : PREFER.map(re => text.find(x => re.test(x))).find(Boolean) ?? text[0];
    out.llm.picked = pick;
    if (pick) {
      const t0 = Date.now();
      const c = await j(`${base}/chat/completions`, env.LLM_API_KEY, { method: 'POST', timeout: 90000, body: JSON.stringify({ model: pick, max_tokens: 80, messages: [{ role: 'user', content: '用一句话给装修业主写个短视频开头，20 字以内。' }] }) });
      out.llm.test = { status: c.status, ms: Date.now() - t0, reply: c.body?.choices?.[0]?.message?.content ?? null, error: c.body?.error?.message ?? null };
      // 再试 JSON 模式（项目里写文案用）
      const c2 = await j(`${base}/chat/completions`, env.LLM_API_KEY, { method: 'POST', timeout: 90000, body: JSON.stringify({ model: pick, max_tokens: 80, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: '只输出 JSON：{"ok":true}' }] }) });
      out.llm.jsonMode = c2.status;
    }
  } catch (e) { out.llm.error = String(e.message ?? e); }
} else out.llm.error = '.env 里没有 LLM_BASE_URL / LLM_API_KEY';

if (env.VIDEO_BASE_URL && env.VIDEO_API_KEY) {
  const base = env.VIDEO_BASE_URL.replace(/\/$/, '');
  try {
    const m = await j(`${base}/models`, env.VIDEO_API_KEY);
    const all = ids(m.body);
    out.video = { base, modelsStatus: m.status, models: all.filter(x => /(seedance|wan|video|kling|veo|sora|hailuo|minimax|vidu|jimeng)/i.test(x)) };
    if (args.has('--video')) {
      const model = out.video.models.find(x => x === 'seedance-2.0-fast') ?? out.video.models.find(x => /seedance/.test(x));
      const t0 = Date.now();
      const c = await j(`${base}/video/generations`, env.VIDEO_API_KEY, { method: 'POST', body: JSON.stringify({ model, prompt: '清晨的玄关，暖光，一个人推门进来换鞋，镜头缓慢推进，真实自然光', duration: 4, width: 480, height: 854, metadata: { resolution: '480p', ratio: '9:16', aspect_ratio: '9:16', generate_audio: false, watermark: false } }) });
      const id = c.body?.task_id ?? c.body?.id ?? c.body?.data?.task_id;
      out.video.test = { model, createStatus: c.status, createBody: c.body, taskId: id ?? null };
      if (id) {
        for (let i = 0; i < 60; i++) {
          await t(10000);
          const q = await j(`${base}/video/generations/${id}`, env.VIDEO_API_KEY);
          const st = String(q.body?.status ?? q.body?.data?.status ?? '').toLowerCase();
          out.video.test.last = q.body; out.video.test.status = st; out.video.test.seconds = Math.round((Date.now() - t0) / 1000);
          process.stdout.write(`  视频任务 ${id}：${st || '?'}（${out.video.test.seconds}s）\n`);
          if (/(completed|succeed|success|finished|done|fail|error|expired|cancel)/.test(st)) break;
        }
      }
    }
  } catch (e) { out.video.error = String(e.message ?? e); }
} else out.video.error = '.env 里没有 VIDEO_BASE_URL / VIDEO_API_KEY';

writeFileSync('ai-check.json', JSON.stringify(out, null, 2));
if (args.has('--write') && out.llm.picked && out.llm.test?.status === 200) {
  const next = /^LLM_MODEL=.*$/m.test(envText) ? envText.replace(/^LLM_MODEL=.*$/m, `LLM_MODEL=${out.llm.picked}`) : `${envText}\nLLM_MODEL=${out.llm.picked}\n`;
  writeFileSync('.env', next);
}
console.log('\n文案：', out.llm.error ?? `${out.llm.count} 个文本模型，选用 ${out.llm.picked}，测试 ${out.llm.test?.status}：${out.llm.test?.reply ?? out.llm.test?.error}`);
console.log('视频：', out.video.error ?? `${out.video.models?.length ?? 0} 个视频模型${out.video.test ? `，测试 ${out.video.test.model} → ${out.video.test.status ?? out.video.test.createStatus}` : ''}`);
console.log('详细结果在 ai-check.json');

// 上游接口：大模型、视频、配音、支付的连接参数。后台填的存在 settings（upstream:<id>），密钥 AES-256-GCM 加密；
// 没填的字段用服务器环境变量。合起来变成一份「生效的环境变量」，交给 loadProviders / loadPay；后台一保存就重新接，不用重启。
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { DB } from './db.ts';
import type { Skills } from './skills/registry.ts';
import type { UpstreamStatus } from '../shared/skills.ts';
import { makeLlm } from './providers/llm.ts';
import { makeWechatPay } from './pay/wechat.ts';
import { makeAlipay } from './pay/alipay.ts';

type Row = Record<string, any>;
export interface UpstreamRecord { enabled: boolean; values: Record<string, string>; secrets: Record<string, string>; updatedAt?: string; by?: string }
export const VIDEO_PROVIDERS = ['auto', 'seedance', 'newapi', 'mock'] as const;

/** 密钥加密：v1:base64(iv|tag|密文)；离线演示版没有 AES 时退成 plain:base64 */
export function secretBox(key: string) {
  const k = createHash('sha256').update(key).digest();
  return {
    seal(plain: string): string {
      try {
        const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', k, iv);
        const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
        return `v1:${Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')}`;
      } catch { return `plain:${Buffer.from(plain, 'utf8').toString('base64')}`; }
    },
    open(box: string): string | null {
      try {
        if (box.startsWith('plain:')) return Buffer.from(box.slice(6), 'base64').toString('utf8');
        if (!box.startsWith('v1:')) return null;
        const b = Buffer.from(box.slice(3), 'base64'), d = createDecipheriv('aes-256-gcm', k, b.subarray(0, 12));
        d.setAuthTag(b.subarray(12, 28));
        return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
      } catch { return null; }
    },
  };
}
/** 打码：sk-a••••1234；PEM 只说填了几行 */
export const mask = (v: string) => /-----BEGIN/.test(v) ? `已填写（PEM，${v.trim().split(/\r?\n|\\n/).length} 行）` : v.length <= 8 ? '••••' : `${v.slice(0, 3)}••••${v.slice(-4)}`;

export function makeUpstreams(db: DB, skills: Skills, o: { env: NodeJS.ProcessEnv; secretKey: string }) {
  const box = secretBox(o.secretKey);
  const ups = () => skills.files().filter(f => f.category === 'upstream');
  const get = (k: string) => (db.prepare('SELECT v FROM settings WHERE k=?').get(k) as Row | undefined)?.v as string | undefined;
  const set = (k: string, v: string | null) => v === null ? db.prepare('DELETE FROM settings WHERE k=?').run(k) : db.prepare('INSERT INTO settings (k, v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v);
  const rec = (id: string): UpstreamRecord | null => { const v = get(`upstream:${id}`); if (!v) return null; try { return JSON.parse(v); } catch { return null; } };
  /** 字段现在的值：后台填的优先，其次环境变量 */
  const valueOf = (id: string, key: string): { value: string; source: 'admin' | 'env' | 'none'; broken?: boolean } => {
    const f = skills.file(id).fields.find(x => x.key === key)!;
    const r = rec(id);
    if (f.secret && r?.secrets[key]) { const v = box.open(r.secrets[key]); return v === null ? { value: '', source: 'admin', broken: true } : { value: v, source: 'admin' }; }
    if (!f.secret && r?.values[key]) return { value: r.values[key], source: 'admin' };
    const e = o.env[f.env];
    return e ? { value: e, source: 'env' } : { value: '', source: 'none' };
  };
  const enabled = (id: string) => rec(id)?.enabled !== false;

  const api = {
    /** 视频用哪家：auto（有网关用网关）/ seedance / newapi / mock */
    videoProvider: (): typeof VIDEO_PROVIDERS[number] => (get('video_provider') as typeof VIDEO_PROVIDERS[number]) || (o.env.VIDEO_PROVIDER as typeof VIDEO_PROVIDERS[number]) || 'auto',
    setVideoProvider(v: string) { if (!(VIDEO_PROVIDERS as readonly string[]).includes(v)) throw new Error('只能选 auto / seedance / newapi / mock'); set('video_provider', v === 'auto' ? null : v); },
    /** 生效的环境变量（服务器的 + 后台填的；后台停用的接口把它的变量清空） */
    env(): NodeJS.ProcessEnv {
      const out: NodeJS.ProcessEnv = { ...o.env };
      for (const f of ups()) {
        if (!enabled(f.id)) { for (const x of f.fields) out[x.env] = ''; continue; }
        for (const x of f.fields) { const v = valueOf(f.id, x.key); if (v.source === 'admin') out[x.env] = x.type === 'bool' ? (v.value === '1' || v.value === 'true' ? '1' : '0') : v.value; }
      }
      const vp = api.videoProvider();
      out.VIDEO_PROVIDER = vp === 'auto' ? '' : vp;
      return out;
    },
    status(id: string): UpstreamStatus {
      const f = skills.file(id), r = rec(id);
      const values: UpstreamStatus['values'] = {};
      for (const x of f.fields) {
        const v = valueOf(id, x.key);
        values[x.key] = { value: v.broken ? '（解不开：服务器的 SECRETS_KEY 变了，请重新填）' : x.secret && v.value ? mask(v.value) : v.value, source: v.source, secret: !!x.secret };
      }
      // 「接通」的判断：必填的几个字段都有值（密钥、地址、商户号等）
      const need = f.fields.filter(x => x.secret || /baseUrl|mchid|appid|appId/.test(x.key)).filter(x => !/VISION_(BASE_URL|API_KEY)/.test(x.env));
      const configured = need.length ? need.every(x => valueOf(id, x.key).value) : false;
      return { configured: configured && (r?.enabled ?? true), enabled: r?.enabled ?? true, values };
    },
    meta: (id: string) => { const r = rec(id); return { updatedAt: r?.updatedAt ?? null, by: r?.by ?? null }; },
    /** 保存：values 里 '' = 清掉（回到环境变量）；密钥不传 / 传 '' = 不改，传 null = 清掉 */
    save(id: string, patch: { enabled?: boolean; values?: Record<string, string | null> }, by: string) {
      const f = skills.file(id);
      if (f.category !== 'upstream') throw new Error('这不是上游接口');
      const r: UpstreamRecord = rec(id) ?? { enabled: true, values: {}, secrets: {} };
      if (patch.enabled !== undefined) r.enabled = patch.enabled;
      for (const [k, v] of Object.entries(patch.values ?? {})) {
        const x = f.fields.find(y => y.key === k);
        if (!x) throw new Error(`没有「${k}」这个字段`);
        if (v !== null && v.length > 20000) throw new Error(`「${x.label}」太长了`);
        if (x.secret) {
          if (v === null) delete r.secrets[k];
          else if (v.trim()) r.secrets[k] = box.seal(v.trim());
        } else if (v === null || !v.trim()) delete r.values[k];
        else {
          if (x.type === 'number' && !/^\d+$/.test(v.trim())) throw new Error(`「${x.label}」要填数字`);
          if (/baseUrl|gateway/i.test(k) && !/^https?:\/\//.test(v.trim())) throw new Error(`「${x.label}」要以 http:// 或 https:// 开头`);
          r.values[k] = v.trim();
        }
      }
      r.updatedAt = new Date().toISOString(); r.by = by;
      set(`upstream:${id}`, JSON.stringify(r));
    },
    /** 测试连接（用表单里还没保存的值也行：overrides） */
    async test(id: string, overrides: Record<string, string> = {}, f: typeof fetch = fetch): Promise<{ ok: boolean; ms: number; message: string }> {
      const file = skills.file(id), t0 = Date.now();
      const v = (k: string) => (overrides[k]?.trim() || valueOf(id, k).value || '').trim();
      const done = (ok: boolean, message: string) => { const ms = Date.now() - t0; skills.logCall(id, 'test', ok, ms, ok ? null : message); return { ok, ms, message }; };
      const timed = async (url: string, init: RequestInit = {}) => {
        const ac = new AbortController(), h = setTimeout(() => ac.abort(), 15_000);
        try { return await f(url, { ...init, signal: ac.signal }); } finally { clearTimeout(h); }
      };
      try {
        switch (file.id) {
          case 'up-llm': case 'up-vision': {
            const base = v('baseUrl') || (file.id === 'up-vision' ? valueOf('up-llm', 'baseUrl').value : ''), key = v('apiKey') || (file.id === 'up-vision' ? valueOf('up-llm', 'apiKey').value : ''), model = v('model');
            if (!base || !key || !model) return done(false, '接口地址、API Key、模型都要填');
            const llm = makeLlm({ baseUrl: base, apiKey: key, model, timeoutMs: 20_000, fetch: f });
            const r = await llm.complete('你是连接测试，只输出 JSON。', '回复 {"ok":true}', z.object({ ok: z.boolean() }), 0);
            return done(r.value.ok, r.value.ok ? `${model} 回复正常` : '模型回复了，但内容不对');
          }
          case 'up-seedance': {
            const key = v('apiKey'), base = (v('baseUrl') || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
            if (!key) return done(false, '先填 API Key');
            const res = await timed(`${base}/contents/generations/tasks?page_num=1&page_size=1`, { headers: { authorization: `Bearer ${key}` } });
            const j = await res.json().catch(() => ({})) as { error?: { message?: string } };
            return done(res.ok, res.ok ? '方舟接通了（列了一下任务，不花钱）' : `${res.status} ${j.error?.message ?? ''}`.trim());
          }
          case 'up-newapi': {
            const key = v('apiKey'), base = v('baseUrl').replace(/\/$/, '');
            if (!key || !base) return done(false, '接口地址和 API Key 都要填');
            const res = await timed(`${base}/models`, { headers: { authorization: `Bearer ${key}` } });
            const j = await res.json().catch(() => ({})) as { data?: unknown[]; error?: { message?: string } };
            return done(res.ok, res.ok ? `网关接通了，有 ${j.data?.length ?? 0} 个模型` : `${res.status} ${j.error?.message ?? ''}`.trim());
          }
          case 'up-tts': {
            const key = v('apiKey'), base = (v('baseUrl') || 'https://api.minimax.cn/v1').replace(/\/$/, '');
            if (!key) return done(false, '先填 API Key');
            const res = await timed(`${base}/get_voice`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ voice_type: 'system' }) });
            const j = await res.json().catch(() => ({})) as { base_resp?: { status_code?: number; status_msg?: string } };
            const ok = res.ok && (j.base_resp?.status_code ?? 0) === 0;
            return done(ok, ok ? '配音接通了（查了一下音色，不花钱）' : `${res.status} ${j.base_resp?.status_msg ?? ''}`.trim());
          }
          case 'up-wxpay': {
            const pk = v('privateKey').replace(/\\n/g, '\n'), pub = v('platformPublicKey').replace(/\\n/g, '\n');
            if (!v('mchid') || !v('appid') || !pk || !v('apiV3Key')) return done(false, '商户号、AppID、商户私钥、APIv3 密钥都要填');
            const p = makeWechatPay({ mchid: v('mchid'), appid: v('appid'), serialNo: v('serialNo'), privateKey: pk, apiV3Key: v('apiV3Key'), platformPublicKey: pub, platformKeyId: v('platformKeyId') || undefined, notifyUrl: '', fetch: f });
            const r = await p.ping!();
            return done(r.ok, r.message);
          }
          case 'up-alipay': {
            const pk = v('privateKey').replace(/\\n/g, '\n');
            if (!v('appId') || !pk) return done(false, '应用 ID 和应用私钥都要填');
            const p = makeAlipay({ appId: v('appId'), privateKey: pk, alipayPublicKey: v('publicKey').replace(/\\n/g, '\n'), gateway: v('gateway') || undefined, notifyUrl: '', fetch: f });
            const r = await p.ping!();
            return done(r.ok, r.message);
          }
          default: return done(false, '这个接口没有测试方法');
        }
      } catch (e) {
        const m = (e as Error).name === 'AbortError' ? '15 秒没有响应' : (e as Error).message || '连不上';
        return done(false, m);
      }
    },
  };
  return api;
}
export type Upstreams = ReturnType<typeof makeUpstreams>;

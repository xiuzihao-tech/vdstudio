// 配音（TTS）。真实实现：MiniMax 语音合成 t2a_v2（speech-2.8-hd）；没配密钥时用 Mock（按字数生成一段静音，跑通合成流程）。
// 接口文档：https://platform.minimax.cn/docs/api-reference/speech-t2a-http
import { voiceSecs } from '../../shared/video.ts';

export interface TtsResult { audio: Buffer; ext: 'mp3' | 'wav'; secs: number }
export interface TtsProvider {
  kind: 'minimax' | 'mock';
  /** voice：平台音色 p1 / p2，或复刻声音的 voice_id；emotion：页面上的「情绪」 */
  synth(text: string, o: { voice: string; speed?: number; emotion?: string }): Promise<TtsResult>;
}

/** 页面上的情绪 → MiniMax 的 emotion；「自动」不传，由模型按文字判断 */
const EMOTION: Record<string, string> = { 平静: 'calm', 开心: 'happy', 惊讶: 'surprised', 严肃: 'calm' };

export interface MinimaxCfg { baseUrl: string; apiKey: string; model?: string; voices?: Record<string, string>; timeoutMs?: number; fetch?: typeof fetch }

export function makeMinimaxTts(cfg: MinimaxCfg): TtsProvider {
  const f = cfg.fetch ?? fetch;
  const voices = { p1: 'male-qn-jingying', p2: 'female-chengshu', ...(cfg.voices ?? {}) };
  return {
    kind: 'minimax',
    async synth(text, o) {
      const voiceId = voices[o.voice as 'p1'] ?? o.voice;
      const res = await f(`${cfg.baseUrl.replace(/\/$/, '')}/t2a_v2`, {
        method: 'POST', signal: AbortSignal.timeout(cfg.timeoutMs ?? 30_000),
        headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: cfg.model || 'speech-2.8-hd', text, stream: false, output_format: 'hex',
          voice_setting: { voice_id: voiceId, speed: Math.min(2, Math.max(0.5, o.speed ?? 1)), vol: 1, pitch: 0, ...(o.emotion && EMOTION[o.emotion] ? { emotion: EMOTION[o.emotion] } : {}) },
          audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
        }),
      });
      const j = await res.json().catch(() => null) as { data?: { audio?: string }; extra_info?: { audio_length?: number }; base_resp?: { status_code?: number; status_msg?: string } } | null;
      if (!res.ok || !j || (j.base_resp?.status_code ?? 0) !== 0 || !j.data?.audio) {
        const msg = j?.base_resp?.status_msg || `HTTP ${res.status}`;
        throw new Error(`配音没生成成功：${msg}`);
      }
      const audio = Buffer.from(j.data.audio, 'hex');
      return { audio, ext: 'mp3', secs: (j.extra_info?.audio_length ?? 0) / 1000 || voiceSecs(text, o.speed) };
    },
  };
}

/** 一段静音 WAV（16kHz 单声道 16 位）：没接配音服务时占位，时长按字数估 */
export function silentWav(secs: number): Buffer {
  const rate = 16000, n = Math.max(1, Math.round(secs * rate)), data = n * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data, 40);
  return b;
}

export const mockTts: TtsProvider = {
  kind: 'mock',
  async synth(text, o) { const secs = Math.max(0.5, voiceSecs(text, o.speed)); return { audio: silentWav(secs), ext: 'wav', secs }; },
};

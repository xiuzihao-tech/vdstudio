// 技能（Skill）：每个功能一个包，能单独维护。
// - ai：靠提示词 + 大模型干活的（诊断深聊、出诊断、排选题、AI 建议、分镜、发布包装、文案写手），没接大模型或出错时按 config 里的规则兜底
// - rule：纯规则和数据（成片类型和价格、积分、邀请赠送、数字人形象）
// - upstream：上游接口（大模型、视频、配音、支付）的连接参数，密钥加密存
// 默认值来自仓库 skills/<id>/ 目录；后台改了存成新版本，可以随时回滚或恢复默认。

export type SkillCategory = 'ai' | 'rule' | 'upstream';
export const CATEGORY_NAME: Record<SkillCategory, string> = { ai: 'AI 技能', rule: '业务规则', upstream: '上游接口' };

/** 上游接口的表单字段 */
export interface UpstreamField {
  key: string; label: string;
  /** 对应的环境变量（后台没填时用它） */
  env: string;
  secret?: boolean; type?: 'text' | 'number' | 'bool' | 'textarea'; placeholder?: string; help?: string;
  /** 必填：这几项都有值才算「已接通」（有默认值的地址之类不用标） */
  required?: boolean;
}

/** 仓库里的技能包（编译进 bundle.gen.ts） */
export interface SkillFile {
  id: string; name: string; category: SkillCategory; version: string; order: number; summary: string;
  /** 用到的上游接口 id */
  uses: string[];
  /** SKILL.md 正文：给维护的人看的说明 */
  doc: string;
  prompts: Record<string, string>;
  config: Record<string, unknown>;
  examples: { name: string; input: Record<string, unknown> }[];
  fields: UpstreamField[];
  /** 后台参数表单里字段的中文名和说明（labels.json，可选） */
  labels?: Record<string, FieldLabel>;
}
export interface FieldLabel { n: string; help?: string; kind?: 'textarea' | 'color' | 'lines'; /** 只能从这几个里选 */ options?: string[] }

/** 后台能改、会存版本的部分 */
export interface SkillData { enabled: boolean; prompts: Record<string, string>; config: Record<string, unknown> }
export interface SkillVersion { version: number; note: string; author: string; createdAt: string }
export interface SkillStats { calls: number; fails: number; llm: number; avgMs: number; lastError: string | null; lastAt: string | null }

/** 后台列表 / 详情看到的样子 */
export interface SkillView extends Omit<SkillFile, 'config' | 'prompts'> {
  data: SkillData;
  /** 仓库里的默认值（「恢复默认」用） */
  defaults: SkillData;
  /** 0 = 用的仓库默认 */
  activeVersion: number;
  versions: SkillVersion[];
  stats: SkillStats;
  /** 上游接口：现在是不是接通了、值从哪来 */
  upstream?: UpstreamStatus;
}

export interface UpstreamStatus {
  configured: boolean; enabled: boolean;
  /** 每个字段：值（密钥只给打码后的）、来源 */
  values: Record<string, { value: string; source: 'admin' | 'env' | 'none'; secret: boolean }>;
}

/** 提示词里的 {{变量}}：换成值，没给的换成空并记下来 */
export function renderTemplate(t: string, vars: Record<string, unknown>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = t.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined || v === null) { missing.push(k); return ''; }
    return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v, null, 0);
  });
  return { text, missing: [...new Set(missing)] };
}
/** 模板里用到了哪些变量 */
export const templateVars = (t: string) => [...new Set([...t.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map(m => m[1]))];

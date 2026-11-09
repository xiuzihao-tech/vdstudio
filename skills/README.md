# 技能包（Skills）

每个功能一个文件夹，能单独维护。改完跑 `npm run skills`（`npm run build` / `npm test` 会自动跑），服务端从生成的 `src/server/skills/bundle.gen.ts` 读。

| 类别 | 技能 |
|---|---|
| AI 技能（提示词 + 规则兜底） | diag-agent 诊断深聊 · diag-report 标签与栏目 · diag-topics 排选题 · video-advise AI 建议 · storyboard 分镜 · publish-pack 发布包装 · copywriter 文案写手 |
| 业务规则 | video-types 成片类型与价格 · points 积分规则 · referral 邀请赠送 · avatars 数字人形象与声音 |
| 上游接口 | up-llm 文案大模型 · up-vision 看素材 · up-seedance 方舟 Seedance · up-newapi 土豆网关 · up-tts 配音 · up-wxpay 微信支付 · up-alipay 支付宝 |

## 一个技能包里有什么
- `SKILL.md`：开头 `---` 之间是元信息（`id` 要和文件夹同名，`category` 是 ai / rule / upstream），下面是给维护的人看的说明
- `prompt.md`（AI 技能）：用 `## 名字` 分段的提示词，`{{变量}}` 运行时替换
- `config.json`：参数和数据（题库、模板、价格、规则）
- `examples.json`：后台「试运行」默认填的输入
- `fields.json`（上游接口）：后台表单字段，`env` 是对应的环境变量

## 两种改法
1. **后台改**（运营日常用）：后台 → 技能中心 → 打开技能 → 改提示词 / 参数 → 保存成新版本，马上生效；可以试运行、看历史、回滚、恢复默认。上游接口的密钥加密存在数据库里。
2. **改仓库文件**（开发 / 大改）：改这里的文件 → `npm run skills` → 提交。后台「导出」能把线上调好的版本下载成 JSON，用 `node scripts/skill-import.mjs 导出的文件.json` 写回这个目录。

后台改过的版本优先于仓库默认；后台点「恢复默认」就回到仓库里的版本。


## labels.json（可选）
后台「参数」表单里字段的中文名、说明、下拉选项：`{ "字段名": { "n": "中文名", "help": "说明", "kind": "textarea | color | lines", "options": ["可选值"] } }`。不写就用通用词表（`src/web/pages/admin/ConfigForm.tsx` 的 `LABELS`）。

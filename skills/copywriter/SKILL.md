---
id: copywriter
name: 文案写手
category: ai
version: 1.0.0
order: 30
uses: up-llm
summary: 写口播稿、看素材写画外音、改写得更像真人；所有文案类调用共用的「人设说明」也在这里
---
# 文案写手

**在哪用**
- 一键生成视频第 1 步「让 AI 看素材写」（`footage`）
- 旧版「生成视频 / 写文案」页（`write_style`、`fine_note`）
- 「改得更像真人」（`humanize`）
- 所有文案类大模型调用的系统提示词（`system`）：人设、账号定位、语气、禁用词

**提示词变量**（`system`）：`{{industry}}` 行业、`{{persona}}` 人设名、`{{profile}}` 账号 / 定位 / 受众 / 语气 / 标签（已拼好的句子）、`{{goal}}` 转化目标、`{{pillars}}` 常讲栏目、`{{platforms}}` 发布平台。
`footage`：`{{count}}` 素材段数、`{{goal}}`。

没接大模型时这些功能用模拟结果（开发版），不走这里。

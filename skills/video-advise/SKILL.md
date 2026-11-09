---
id: video-advise
name: 出片 · AI 建议
category: ai
version: 1.0.0
order: 20
uses: up-llm
summary: 一键生成视频第 2 步：看用户给的素材和文案，推荐做哪一类片、怎么补缺的
---
# 出片 · AI 建议

**在哪用**：一键生成视频 → 第 1 步点「下一步 · 让 AI 看看」。用户在下拉里自己定了类型时不推荐，只说明。

**跑法**：接了大模型按 `prompt.md` 的 `advise` 选类型和说法（类型必须是「成片类型与价格」里启用的）；否则按规则：
- 只有文案 → `copyOnly`（默认真人口播：数字人照着念）；文案里命中 `copyOnlyAllow` 的关键词类型时用那一类
- 只有画面 → `mediaOnly`（默认空间漫游）
- 都有 → 按 `keywords` 从上往下匹配文案，匹配不上用 `both`（默认空间讲解）
- `needMedia` 里的类型素材少于 `thinMin` 份时提醒「素材偏少」

**msg**：各种情况跟用户说的话。`{media}` 会换成「3 张照片、1 段视频」，`{type}` 换成类型名。

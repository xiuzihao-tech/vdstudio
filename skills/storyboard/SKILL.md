---
id: storyboard
name: 出片 · 分镜
category: ai
version: 1.0.0
order: 21
uses: up-llm
summary: 一键生成视频第 3 步：把文案拆成镜头（镜头名、台词、拍摄建议），用户素材按顺序配上
---
# 出片 · 分镜

**在哪用**：第 2 步点「下一步 · 生成分镜」。

**跑法**：接了大模型按 `prompt.md` 的 `storyboard` 拆镜；否则按规则——有文案就一句一镜（太短的句子并到上一句），没文案用 `lines` 里这类片的默认旁白；镜头名和拍摄建议按 `scenes` 模板轮着套。
不管哪种，素材分配、数字人镜头、每镜时长都由代码统一算（按字数 ÷ `charsPerSec`，再缩放到目标时长）。

**config.json**
| 字段 | 说明 |
|---|---|
| `charsPerSec` | 每秒念几个字（默认 4.5），决定每镜时长 |
| `minShots` / `maxShots` | 镜头数上下限 |
| `scenes` | 按片型的镜头模板：`[镜头名, 画面示意 key, 拍摄建议]`。最后一个是 `person` 的表示收尾数字人出镜 |
| `lines` | 没文案时的默认旁白 |

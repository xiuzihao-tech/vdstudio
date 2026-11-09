---
id: video-types
name: 成片类型与价格
category: rule
version: 1.0.0
order: 40
summary: 8 类成片（名字、价格、默认时长、说明、需要的素材、组成示意）和首页「成品长这样」的样片
---
# 成片类型与价格

**在哪用**：一键生成视频的类型下拉、AI 建议、「换一类」、扣点；首页「成品长这样」；后台出片统计。改完前台马上用新价格（刷新页面）。

**types**（每类一项）
| 字段 | 说明 |
|---|---|
| `id` | 固定的英文 id，别改（tour 空间漫游、explain 空间讲解、talk 真人口播、before 改造前后、case 案例故事、product 产品种草、site 工地记录、vlog） |
| `n` | 显示名。注意：空间漫游对外不要叫「一条」 |
| `pts` | 成片价（点）。样片价 = 成片价 × 积分规则里的 `sampleRate` |
| `secs` | AI 推荐时长（秒）；用户改时长按秒折算价格 |
| `d` / `need` | 一句话说明、需要准备的素材 |
| `face` | 默认出镜：avatar 数字人 / voice 只配音 / none 只放音乐 |
| `parts` | 第 2 步的组成示意图：`[avatar|scene|pair|macro, 标签]` |
| `bgm` | 默认背景音乐 |
| `tag` | 角标（先上线、大哲式…） |
| `enabled` | false = 前台不出现（上线顺序：空间漫游先上，难的后上） |

**samples**：首页样片卡（`cat` 分类、`type` 点「做同款」带过去的类型、`scenes` 示意画面、`custom` 可定制、`soon` 样片制作中）。`sampleCats` 是分类标签的顺序。

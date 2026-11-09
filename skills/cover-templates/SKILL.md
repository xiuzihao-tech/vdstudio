---
id: cover-templates
name: 封面模板
category: rule
version: 1.0.0
order: 46
summary: 一键生成视频第 4 步的封面排法和颜色（大字压底 / 顶部标题 / 上图下字），可以加新模板、改品牌色
---
# 封面模板

每个模板：`id`（编号，别重复）、`n` 名字、`d` 适合什么时候用、`layout` 排法、`bg` 底色、`fg` 字色、`enabled` 开关。

| layout | 排法 |
| --- | --- |
| `band` | 画面铺满，底部一条色块压大字 |
| `top` | 大字压在画面上方，配渐变暗角（`bg` 是暗角颜色） |
| `split` | 上面画面、下面色块写字 |

颜色写 `#RRGGBB`。精修还是去 dazheip 的「制作封面图文」。

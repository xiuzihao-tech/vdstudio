# 接口文档

所有接口在 `/api` 下，JSON 进出（上传除外）。身份用 Cookie `fid` 识别，首次访问自动创建。错误统一返回 `{ "error": "给用户看的中文" }`，参数错误另带 `issues`。入参校验见 `src/shared/schemas.ts`。

## 会话与工作区
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/session | 当前工作区、人设、人设列表、模型列表、今天日期 |
| POST | /api/session/persona | `{persona}` 切换身份（没有则新建并写入种子数据） |
| PUT | /api/workspace/positioning | 保存 IP 定位 |
| PUT | /api/workspace/theme | `{theme: studio｜cinema｜glass｜poster}` |

## 选题
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/topics?cat&dir&type&heat&period | 组合筛选；返回 `{topics, scheduled}`，`scheduled` 是选题 → “10/24 待审 / 备选池” |
| GET | /api/topics/all | 全部选题 + 排期索引 |
| POST | /api/topics | 新建选题（深挖角度、对标复刻、工具结果等） |
| POST | /api/topics/:id/fav | `{fav}` |
| GET | /api/topics/:id/angles | 深挖：5 个角度 |
| POST | /api/topics/from-case | `{text, imageKeys}` 案例策划，生成 3 个并入库 |
| POST | /api/topics/benchmark | `{url, learn[]}` 对标拆解（不入库，前端确认后再 POST /api/topics） |
| POST | /api/topics/from-materials | `{assetIds, note}` 按素材出选题 |

## 文案
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/copy/generate | `{topicId, kind, len, tone, version}` → `{draft, check}`（不保存） |
| POST | /api/copy/rewrite | `{draft, how: live｜short｜long｜alt}` |
| POST | /api/copy/check | 时长、违禁词、活人感 |
| GET | /api/drafts · /api/drafts/:topicId | 草稿（一个选题一份） |
| PUT | /api/drafts | 保存草稿 |

## 工具
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/tools/banned | `{text}` → `{hits: [词, 建议][]}` |
| POST | /api/tools/humanize | `{text}` |
| POST | /api/tools/transcribe | `{kind: audio｜video, ref}` |
| POST | /api/voice/clone | 请求体是录音；必须带 `x-consent: yes` |

## 素材
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/assets | 列表 |
| POST | /api/assets | 请求体是文件；`content-type` 为 image/video/audio，`x-file-name`（URL 编码），`x-source` |
| DELETE | /api/assets/:id | 删除 |
| GET | /files/:ws/:file | 访问上传的文件 |

## 生成
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/gen/check | GenSettings → `{issues, shots, cost, finalCost}` |
| POST | /api/gen | `{settings, final, title}` → 201 Job；422 有阻断问题；402 余额不足 |
| GET | /api/jobs · /api/jobs/:id | 任务列表 / 单个（前端每 0.7 秒轮询） |

## 排期
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/plans | 每个账号：`plan` + 两周 `slots`（含状态、选题） |
| POST | /api/plans | `{account}` 加账号 |
| PATCH | /api/plans/:id | 发布日、时间、确认、预算、运行、栏目配比 |
| POST | /api/plans/:id/slots/:date | `{action: approve｜next｜unpin｜set｜skip｜add, topicId?}` |
| POST | /api/plans/:id/approve-all | 全部通过 |
| POST | /api/plans/:id/reroll | 待审的重新预选（已固定的不动） |
| POST | /api/plans/:id/backlog | `{topicId, remove?}` 备选池 |
| GET | /api/published | 已发布 |

## 封面
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/covers | 列表 |
| POST | /api/covers | `{title, style, generate}`；generate=true 扣 12 点 |

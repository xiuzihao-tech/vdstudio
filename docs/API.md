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

## 一键生成视频 / 诊断的 AI 技能（11/9）
提示词和规则都在后台「技能中心」；接了大模型且技能里 `useLlm=true` 就走模型，出错、格式不对按规则兜底。返回里的 `path` 是 `llm` 或 `rule`。
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/catalog | 成片类型和价格、样片、积分口径、数字人和声音、诊断和发布包装参数（session 里也带着 `catalog`） |
| POST | /api/studio/advise | `{mats, copy, pick}` → `{advice: {type, why, fit, fitText, chips}}` |
| POST | /api/studio/storyboard | `{mats, copy, type, face, target?}` → `{shots}` |
| POST | /api/studio/pack | `{type, lines, city?}` → `{title, caption, tags, pick, banned, tagMin, tagMax, titleMax}` |
| POST | /api/studio/diag/next | `{msgs, asked}` → `{msg}`；没解锁 402 |
| POST | /api/studio/diag/report | `{answers, name?}` → `{result}`；回答少于技能里的 `minAnswers` 返回 400 |
| POST | /api/studio/diag/topics | `{result, counts}` → `{topics, schedule: {weekdays, time}}` |

## 邀请有礼（11/9）
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/referral/click | `{code}` 分享链接被打开（前端同一会话只报一次） |
| GET | /api/referral/preview?code= | `{preview: {name, bonus}}`，注册页显示「谁邀请你、多送几点」 |
| GET | /api/referral | 我的邀请码、打开 / 注册 / 充值人数、得到的点数、规则、记录（没登录返回 `{needLogin: true}`） |
| POST | /api/referral/share | 分享奖励（每天第一次；奖励为 0 就不发） |
| POST | /api/auth/register | 多了 `ref`（邀请码）；返回多了 `gift`（这次注册一共送了几点） |

## 后台（11/9，dazheip 后台同款）
都要后台账号；按角色检查权限（`src/shared/admin.ts`），没权限 403。改东西的都记操作日志。
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | /api/admin/me | 任意后台账号 | 我的角色和权限、所有角色、dazheip 原有菜单的外链 |
| GET | /api/admin/dashboard?days= | overview | 数据块、成片类型覆盖、价格表、近 14 天、服务接入 |
| GET | /api/admin/skills · /:id | skills | 技能列表 / 详情（提示词、参数、默认值、版本、调用统计、最近调用） |
| PUT | /api/admin/skills/:id | skills | `{data: {enabled, prompts, config}, note}` 存成新版本并启用；格式不对 400 |
| POST | /api/admin/skills/:id/activate | skills | `{version}` 切到某一版；0 = 恢复仓库默认 |
| POST | /api/admin/skills/:id/enabled | skills | `{enabled}` 启用 / 停用（也存成一版） |
| POST | /api/admin/skills/:id/test | skills | `{input, data?, force?: 'llm'｜'rule'}` 试运行（能用没保存的草稿），不记调用、不扣点 |
| GET | /api/admin/skills/:id/versions/:v · /export | skills | 某一版的内容 / 导出 JSON（`scripts/skill-import.mjs` 能写回仓库） |
| GET | /api/admin/upstreams | upstreams | 7 个上游接口的状态、字段（密钥打码）、来源、调用统计；视频用哪家 |
| PUT | /api/admin/upstreams/:id | upstreams | `{enabled?, values?}`；密钥传空 = 不改，传 null = 清掉；保存后马上重新接上 |
| POST | /api/admin/upstreams/:id/test · /models | upstreams | 测试连接（可带没保存的值）/ 拉模型列表 |
| PUT | /api/admin/upstreams/video-provider | upstreams | `{provider: auto｜seedance｜newapi｜mock}` |
| GET / PUT | /api/admin/points | points | 按类型统计、流水搜索、积分规则 |
| PUT | /api/admin/points/types | points | 成片类型的价格、时长、启用 |
| POST | /api/admin/points/adjust | points | `{email, delta, reason}` 手动加 / 扣（扣到 0 为止） |
| GET / PUT | /api/admin/referral | referral | 邀请数据、排行、记录、规则 |
| POST | /api/admin/referral/:id/revoke | referral | `{note}` 收回这条邀请发出的全部点数 |
| GET | /api/admin/jobs | jobs | 全站出片任务 |
| POST | /api/admin/jobs/:id/refund | jobs | `{reason}` 人工退点（每条一次；失败的已自动退） |
| PUT | /api/admin/billing | points | 充值套餐和诊断价格（存进技能「积分规则」） |
| POST | /api/admin/billing/orders/:id/refund | orders + points | 标记退款：扣回点数，这笔订单带出的首充、返点一起收回 |
| GET / POST / DELETE | /api/admin/admins | admins | 后台账号（ADMIN_EMAILS 里的超级管理员不在这里） |
| GET | /api/admin/audit?q= | audit | 操作日志（最近 300 条） |

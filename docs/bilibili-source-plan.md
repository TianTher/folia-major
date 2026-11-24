# B 站音源（同步账号收藏夹、在线听）设计方案

状态：设计稿，未实现。目标宿主：Folia 0.7.29（Folium 2 音源模组体系）。

本文只做设计，不含实现。接口事实分两类：**实测**（2026-11-24 在本机直接请求 B 站接口得到的真实结果，附关键返回）与 **待验证**（取自公开资料或第三方实现，实现前必须复核）。所有实测只用公开接口，没有用任何账号 cookie。

---

## 0. 交付目标（先看这一节）

**能做到的**：在 Windows 桌面、网页版 / PWA、Android（同一 Web 构建）上，用你自己的 B 站账号登录，把账号里的收藏夹当成宿主的歌单用——和网易云、QQ 音乐现在的账号体验一致：

- 「设置 → 音源」里出现「哔哩哔哩」，扫码登录后账号出现在宿主账号区；
- 「歌单」页签里出现你账号的全部收藏夹（实测形态：几十个收藏夹、其中一个 两百多条），点开能翻页（每页 40 条）；
- 点任意一条就**只听声音**：宿主自己的播放器、进度、缓存、均衡器、频谱、automix、倍速全部正常；
- 收藏夹里已失效的视频自动跳过，不占位、不报错；
- 歌词优先用视频自带的 CC 字幕，没有就交给宿主的跨源匹配；
- 心形按钮把当前视频收藏进你指定的收藏夹（写回 B 站）。

**明确不做的**：

| 不做 | 原因 |
| --- | --- |
| 播放视频画面（`playback.surface`） | 需求明确只要声音 |
| 下载 / 转存 / 导出 | 合规与版权 |
| 番剧、影视、付费内容 | 取流拿不到，也不该做 |
| 观看历史、关注 UP 主、UP 主合集 | 风控最重、收益最低；合集放阶段 6 可选 |
| 自绘界面 | 宿主的账号 / 歌单 / 播放器已经够用，自绘是第三方那份实现的技术债 |

**验收一条**：桌面版里扫码 → 歌单页签出现收藏夹 → 点一首出声 → 拖进度 → 退出登录后入口消失，全流程不打开浏览器、不下载文件。

---

## 1. 结论

在 `sources/bilibili/` 新增一个**内置音源模组**，短 id `bilibili`。它把 B 站视频当作可在线收听的条目，并把账号的收藏夹变成宿主自己的歌单：

- **登录后**，收藏夹 / 收藏的合集 / 稍后再看经 `library@1` + `catalog@1` 变成 Omni 集合 —— 和网易云、QQ 音乐走同一条路，因此宿主原生的「歌单」页签、封面墙、集合页、方向键、无限滚动全部自动可用，不需要模组自绘任何界面。
- **播放**走 `playback.audio@1`，只取 DASH 音轨交给宿主自己的音频播放器：缓存、预取、均衡器、频谱、automix、倍速、歌词时钟全部可用。这正是"在线听"要的。
- **歌词**优先用视频自带的 CC 字幕；没有字幕时交给宿主的跨源匹配（`itemKinds.video.lyrics = 'match'`），用清洗过的标题去网易云 / QQ 找。
- **不做视频播放**：需求明确只要"听"，所以不实现 `playback.surface@1`，播放页按普通在线歌处理（封面 + 歌词）。条目仍然是 `kind: 'video'`（它确实是视频条目），只是永远走 `audio` 路由。

宿主侧改动只有几张登记表加文档，没有新的主进程块、没有新的 preload 通道 —— 这正是 Folium 2 音源模组体系的设计目标。

**已经有一个第三方实现做到了同样的用户可见效果**：[`qingxian997/folia-bilibili-source`](https://github.com/qingxian997/folia-bilibili-source)（MIT，0.9.2，针对 0.7.29 验证）。但它走 Folium 1 的实验接口，并靠运行时反射宿主的 Vite chunk 来改造宿主内部的 provider 对象（见 4.5 节）。所以本方案不是"重新发明"，而是把同一件事用 Folium 2 的正式接口做一遍：用户看到的东西一样（收藏夹进「歌单」、合集进「合集」），但不再依赖宿主内部结构。

---

## 2. 需求解读

需求已确认为 **A**：和网易云 / QQ 音乐那样，登录后账号的歌单（这里即收藏夹）出现在宿主的账号与「歌单」页签里，能浏览、能整柜听。

| 读法 | 含义 | 本方案 |
| --- | --- | --- |
| **A. 账号同步 + 在线听** | 登录 B 站账号，收藏夹 / 收藏的合集 / 稍后再看变成宿主的歌单与合集，播放时取音轨 | ✅ 主路径，**已确认** |
| B. 音画同步 | 在播放页内嵌 `<video>`，音频与画面一起放（`playback.surface@1`） | ❌ 明确不做（只要声音） |
| C. 进度跨设备同步 | 多设备间同步播放进度（`sync-server`） | ❌ 与本需求无关，不做 |

这个确认改变了一件事：**账号与曲库同步是 M1 的主体**，不是第二阶段；搜索与推荐往后放（第 10 节的阶段顺序已按此排）。

### 2.5 多端约束（PC + Android）：这一条推翻了"只做一个模组"

需求要求桌面和 Android 都能跑。宿主的两端运行方式不同：

| 端 | 跑什么 | 音源怎么进来 |
| --- | --- | --- |
| 桌面（Electron / PC） | 完整应用 + 模组运行时 | `sources/bilibili/` 音源模组，`client` + `main` |
| 网页版 / PWA | Vite 构建的网页，**没有模组运行时** | `src/services/onlineMusic/web/bilibili.ts` 注册 `sources/bilibili/core` |
| Android | 社区移植版与 Capacitor 自打包**都是网页版的壳**（`folia-ce/folia-sonnet`、`whycfawa/folia-android`、`chthollyphile/folia-sonnet`） | 同网页版 |

也就是说：**只写 `sources/bilibili/` 的模组，Android 上完全没有 B 站音源**。必须按 `sources/kugou/` 的形状写成 `core` + 两个宿主入口：

```text
sources/bilibili/core/          createSource(env)：全部能力与归一化，不认识网络细节
sources/bilibili/client/        桌面：env.call → folium.rpc → main
src/services/onlineMusic/web/bilibili.ts   网页/PWA/Android：env.web → HTTP → 自建后端
sources/bilibili/main/          桌面：net / seal / media
```

而网页与 Android 端**必须有一个后端**，原因有三条，前两条是本轮实测的：

1. **`api.bilibili.com` 直接拒绝跨域来源**：带 `Origin: https://example.com` + 同源 `Referer` 请求 `x/web-interface/view`，返回 **403**（不带这两个头是 200）。这不是缺 CORS 头，是 B 站主动拒绝非站内来源。
2. **登录态拿不到**：扫码成功后 `SESSDATA` / `bili_jct` 在 `passport.bilibili.com` 的 `Set-Cookie` 里，浏览器 JS 读不到跨域 `Set-Cookie`，也没法把它设到应用自己的域上。
3. **WBI 签名与 `Referer` / `User-Agent`** 需要一个能自由设头的执行环境，浏览器里没有。

好消息是**音频不需要走后端**：实测音频 CDN 返回 `Access-Control-Allow-Origin: *`（`HTTP/1.1 206` + `ACAO: *`），浏览器可以直接播放与缓存。所以后端只承担"API 代理 + 会话"，不承担音频流量。

这正是仓库里 QQ 音乐已经走过的路：`docs/qq-music-deployment.md` 里，桌面版内置后端、网页版必须把 `VITE_QQ_API_BASE` 指向自建的 Vercel / Cloudflare / Docker / Node 部署。B 站照同一套做法，变量叫 `VITE_BILIBILI_API_BASE`。

---

## 3. 可行性验证（实测记录）

### 3.1 视频详情：`x/web-interface/view`

```
GET https://api.bilibili.com/x/web-interface/view?bvid=BV1GJ411x7h7
→ code 0
  title    = 【官方 MV】Never Gonna Give You Up - Rick Astley
  aid      = 80433022
  bvid     = BV1GJ411x7h7
  duration = 213（秒）
  pages[0] = { cid: 137649199, part: 'Never Gonna Give You Up - Rick Astley' }
  pic      = http://i1.hdslb.com/bfs/archive/5242...jpg
```

**不需要 cookie，不需要 WBI。** `pages[]` 给出每个分 P 的 `cid`，这是取流的必要参数。

### 3.2 取流：`x/player/playurl`

```
GET https://api.bilibili.com/x/player/playurl?avid=80433022&cid=137649199&qn=127&fnver=0&fnval=4048&fourk=1
→ code 0
```

匿名可用。`data.dash.audio[]` 实测三档：

| id | bandwidth (bps) | codecs | mimeType | 说明 |
| --- | --- | --- | --- | --- |
| 30216 | 43,962 | mp4a.40.5 | audio/mp4 | HE-AAC 64K |
| 30232 | 102,931 | mp4a.40.2 | audio/mp4 | AAC 132K |
| 30280 | 203,786 | mp4a.40.2 | audio/mp4 | AAC 192K |

`data.dash.flac.audio`、`data.dash.dolby.audio` 匿名时**为空**（需要登录 + 大会员，**待验证**具体档位）。`data.accept_quality` 是视频清晰度的 qn 列表（`112,80,64,32,16`），与音轨档位是两套编号，不要混用。

音频地址形如：

```
https://xy111x6x227x7xy.mcdn.bilivideo.cn:8082/v1/resource/upgcxcode/99/91/137649199/137649199_da2-1-30232.m4s
  ?V=v3.1.2&...&deadline=1795538109&...&sign=bd8726&upsig=d05e...
```

要点：

- **文件是 fMP4**：实测前 64 字节为 `00 00 00 24 66 74 79 70 69 73 6f 35 ... dash`（`ftyp is5` + `dash`），Chromium 的 `<audio>` 能直接解。
- **支持 Range**：`Range: bytes=0-1023` → `206`，`Content-Type: application/octet-stream`。拖动进度、只取头部都可行。
- **实测三种请求头组合都返回 206**：带 `Referer+UA`、只带 `UA`、什么都不带。也就是说这批 `*.mcdn.bilivideo.cn` 节点**不校验防盗链**。但还有 `upos-sz-mirrorcos.bilivideo.com` 一类 upos 节点，公开资料说它们校验 Referer（**待验证**）。方案按"可能校验"设计（见 5.3）。
- **地址带过期**：`deadline` 是 Unix 秒，实测约等于签发后 2 小时。过期后旧地址失效，必须重新 playurl。

### 3.3 搜索：必须 WBI 签名

不带签名的 `x/web-interface/search/type` 返回**反爬 HTML 页**（`HTTP 200` 但 `Content-Type: text/html`，内容是 `static.hdslb.com/error/...`），不是 JSON。带 WBI 签名后：

```
GET .../x/web-interface/wbi/search/type?search_type=video&keyword=周杰伦&page=1&wts=...&w_rid=...
→ code 0, numResults=1000, numPages=50, result=20 条/页
```

返回字段（节选）：`bvid, aid, title, description, pic, author, mid, upic, duration, play, video_review, favorites, pubdate, senddate, tag, is_union_video, subtitle`。

注意：`duration` 是 **`"419:2"` 这样的字符串**（分:秒，秒不补零），不是毫秒；`title` 带 `<em class="keyword">` 高亮标签，要清洗；`pic` 是 `http://`，支持 `@640w` 一类后缀。

WBI 签名流程（本轮已实现并验证）：

1. `GET x/web-interface/nav` → `data.wbi_img.img_url` / `sub_url`。匿名时 `code = -101`（未登录），但 `wbi_img` **照常返回**。
2. 取两个文件名的去扩展名部分做 `imgKey` / `subKey`，按固定 64 项 `mixinKeyEncTab` 重排后取前 32 位得 `mixinKey`（本轮实测 `imgKey=7cd08494...`、`mixinKey=ea1db124af3c7062474693fa704f4ff8`；**随日期变，不能写死**）。
3. 参数加 `wts`（Unix 秒），按 key 排序，值过滤 `!'()*` 后 URL 编码，拼 `mixinKey` 求 MD5 得 `w_rid`。

### 3.4 风控压测

带 `buvid3` 与 WBI 签名、间隔 0.8 秒连打 5 次不同关键词搜索：**5 次全部 `code 0`、每次 20 条，没有 `-352` / `-412`**。这说明匿名搜索可行，但 0.8 秒只是起步值，不等于安全阈值。

### 3.5 字幕：`x/player/v2`

```
GET https://api.bilibili.com/x/player/v2?aid=80433022&cid=137649199
→ code 0，subtitle.subtitle = []（这条视频没有 CC 字幕）
```

有字幕时每项给 `lan`、`lan_doc`、`subtitle_url`（`i0.hdslb.com/...json`）、`ai_type`（0 人工 / 1 AI）。字幕 JSON 结构是 `{ body: [{ from, to, content }] }`（**待验证**字段名）。同接口还返回 `view_points`（视频章节，**待验证**），可用于把长合辑拆成曲目。

### 3.6 登录：`passport.bilibili.com` 的扫码

注意域名不是 `api.bilibili.com` —— 在 `api.bilibili.com` 上请求扫码接口返回 **404 HTML**。

```
GET https://passport.bilibili.com/x/passport-login/web/qrcode/generate
→ code 0，data.qrcode_key = 1f530ea1...，data.url = https://account.bilibili.com/h5/account-h5/auth/scan-web?...

GET https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=<key>
→ code 0，data.code = 86101，data.message = 未扫码
```

扫码成功后 `Set-Cookie` 里才有 `SESSDATA` / `bili_jct` / `DedeUserID`（**待验证**具体形态）。

### 3.7 反爬指纹：`x/frontend/finger/spi`

```
→ code 0，data.b_3 = 1C958C61-...infoc，data.b_4 = F7E1...
```

匿名可取，`b_3` 就是 `buvid3` 的值。没有它更容易吃 `-352` / `-412`，所以**第一次请求前先取指纹**。

### 3.8 收藏夹

- `x/v3/fav/folder/created/list-all?up_mid=<mid>`：自建收藏夹列表。匿名请求别人的 mid 返回 `code 0, count 0`（不泄露私有夹），带自己 cookie 才有内容。
- `x/v3/fav/resource/list?media_id=<id>&pn=&ps=&platform=web`：收藏夹里的视频。
- `x/v3/fav/resource/ids`：批量查收藏状态（红心用）。
- `x/v3/fav/resource/deal`：收藏 / 取消收藏（写操作，要 `bili_jct` 作 `csrf`）。
- `x/v3/fav/folder/collected/list`：收藏的别人的合集/收藏夹。

（这些端点的完整参数与返回字段见 5.6，规格来自社区维护的 `bilibili-API-collect`，本轮已核对；其中 `created/list-all` 匿名读别人的夹一律 `count 0`，已实测。）

---

## 4. 落点：为什么是音源模组

宿主已有的三样东西直接对应本需求：

1. **`sources/<id>/` 音源模组**：注册后自动出现在平台切换器、搜索命令、设置页、登录窗口；凭据加密、独立网络分区、媒体规则都由 `api` 提供。登录态由 `auth@1` 表达，宿主据此显示账号、判断"这个源能不能用账号"。
2. **`library@1` + `catalog@1`**：账号的歌单列表与集合内的歌，走的就是网易云 / QQ 同一套 Omni 路由。收藏夹一旦从这里交出，宿主的「歌单」页签、封面墙、集合页、无限滚动全部自动工作。
3. **`playback.audio@1` + `itemKinds` + `routeOf`**：宿主持有 `<audio>`，自动接管缓存、预取、均衡器、频谱、automix、播放上报频控、歌词时钟；`itemKinds` 声明视频这类条目的歌词/红心/上报特征。

反过来，如果不走音源模组而直接改宿主，会撞上 `AGENTS.md` 的模块边界与 `omniArchitecture.test.ts` 的平台名计数 —— 宿主里出现平台分支是明确禁止的。

**但这个落点只覆盖桌面。** 网页、PWA、Android 没有模组运行时，必须按 2.5 节的 `core` + `web/<id>.ts` 拆分，并且要一个后端（5.8）。所以"做一个音源模组"是 M1 的范围，不是整件事的范围。

---

## 4.5 现有实现评估：`qingxian997/folia-bilibili-source`

| 项 | 值 |
| --- | --- |
| 仓库 | <https://github.com/qingxian997/folia-bilibili-source> |
| 版本 / 许可 | 0.9.2（预览）/ MIT |
| 目标宿主 | `folia: ">=0.7.22 <0.8.0"`，README 写明「针对 Folia 0.7.29 验证」—— 与本仓库一致 |
| 规模 | `client.mjs` 2361 行、`index.cjs` 1519 行、`lib/` 20 个模块、35 个测试文件、约 248 个用例 |
| 用户可见效果 | 收藏夹进「歌单」页签、UP 主合集进「合集」页签、探索页用宿主原生翻页、搜索、心形写回收藏夹、CC 字幕歌词、跨平台歌词匹配、封面、长视频过滤、播放线路切换 |

**它确实做到了需求 A**，而且界面全是宿主画的。这对本方案是正面证据：`library.getUserPlaylists` + `catalog.getPlaylistTracks` 这条路能把收藏夹变成宿主自己的数据（墙、集合页、方向键、无限滚动都复用宿主实现）。

### 它是怎么做到的

`mod.json` 是 `"folium": 1` + `"experimental": ["omni.providers"]`。而 Folium 1 的 `FoliumOmniProviderDef` 只有四个成员（`search` / `getSong` / `getAudioUrl` / `getLyrics`，见 `src/mods/folium/contract.ts:2497`），**没有账号、没有曲库**。于是它做了一件宿主没有授权的事（`lib/hostlib.mjs`）：

1. 从页面里读入口 chunk，解析 `__vite__mapDeps` 拿到全部 chunk 文件名；
2. 按文件名启发式（`provider|omni|service|account|library|...`）逐个 `import()` 已加载的 chunk，用「行为探测」找出宿主的 `omni` 单例和 provider 访问器（`findOmni` 认 `readAccount` + `getUserPlaylists` + `getCollectionTracks`）；
3. 拿到宿主给本模组造的那个 provider 对象后**直接改它**：`capabilities.auth = true`、`provider.library = …`、`provider.catalog = …`、`capabilities.userAlbums = true`、`capabilities.mutations/likes = true`、`capabilities.recommendations/explore = true`…

`attachLibrary()` 的注释把它为什么必须这么干说得最清楚：宿主给模组音源的适配层把 `auth / userLibrary / playlists` 三个能力位写死成 `false`，所以「收藏」页签永远不可用、墙面一张卡都不画。

### 为什么不能直接拿它当本仓库的实现

| # | 原因 |
| --- | --- |
| 1 | **依赖宿主内部结构**：chunk 名、依赖表、`omni` 的方法集合、provider 对象可写。宿主换打包策略、冻结 provider、或把 `omni` 拆开，它就整块失效。作者自己在 README 里写「宿主每次更新都可能用不了或者大改」 |
| 2 | **绕过模组隔离**：`AGENTS.md` 与 D130 要求音源只能 import 自己目录、`@folia/folium`、`@folia/folium-source-kit`；靠 `import()` 宿主 chunk 拿内部单例正是这条规则要挡住的事 |
| 3 | **装不进 `sources/`**：`dev/sources/manifestCheck.mjs` 要求内置音源 `"folium": 2` 且用 `folium.sources.register`；`folium: 1` 的模组没有 `sources[]`，不是音源模组 |
| 4 | **能力位是"改"出来的，不是"实现"出来的**：宿主按适配层生成 `capabilities`，模组直接翻转布尔值，一旦宿主开始校验就全盘失效 |
| 5 | **作者自己的判断**：README 写明「正式的 1.0 要等 Folium 2（Folia 0.8.0）」，且不上架官方市场 |

### 它能给我们什么（价值很大）

1. **一份现成的行为规格**：收藏夹 → 「歌单」页签、合集 → 「合集」页签、心形写回、字幕优先/匹配次序、长视频过滤、播放线路切换 —— 这些产品决策已经过真实使用验证，可直接沿用。
2. **一张宿主门槛表**（它踩过的坑）：`canUseAlbums = userLibrary && !!userAlbums`、`canLikeSong` 需要 `likes` 与 `mutations` 同时为真、`canAddSongToPlaylist` 看 `playlistTrackMutations`、`canUseRadio = capabilities.recommendations`、`supportsExplore = capabilities.explore`、收藏夹 id 的三种前缀（纯数字 = 自建可写、`c-fav-` = 收藏的、`x-fav-` = 外部公开只读）。**在 Folium 2 里这些由 `capabilities` 声明自动成立**，但它说明了宿主 UI 的开关语义，做验收清单时直接可用。
3. **一份端点清单**（与 3.8 互补）：`/x/v3/fav/resource/ids`、`/x/v3/fav/resource/deal`、`/x/polymer/web-space/seasons_archives_list`、`/x/series/archives`、`/x/polymer/web-space/seasons_series_list`、`/x/web-interface/wbi/index/top/feed/rcmd`、`/x/web-interface/card`、`/x/player/wbi/v2`、`/x/player/wbi/playurl`。
4. **可直接借鉴的实现**（MIT，兼容本仓库的 AGPL，需在 `README.md` 注明来源）：`lib/bvid.cjs`（BV/av 互转）、`lib/cookie.cjs`、`lib/lrc.mjs`（字幕→LRC）、`lib/title.mjs`（标题洗成「歌手 - 歌名」）、`lib/exclude.mjs`（长视频/关键词过滤）、`lib/collected.mjs` / `collections.mjs`（收藏夹与合集的分页与归一化）、`lib/proxyStream.cjs`（CDN 403 时的本机中转，正好是 5.3 的降级路径）。
5. **一份反面教材**：哪些事不该由模组做（改宿主对象、反射 chunk、自建设置面板 908 行）—— 正是 Folium 2 用 `auth@1` / `library@1` / `capabilities` 把它标准化掉的原因。

### 结论：两条路

- **路 A（立刻可用）**：装那个第三方模组。今天就有需求 A 的效果，代价是宿主一升级就可能失效。
- **路 B（本方案）**：在 `sources/bilibili/` 用 `auth@1` + `library@1` + `catalog@1` 重新实现。用户可见效果一样，但不依赖宿主内部结构；工作量比"改那个仓库"大，比"从零摸索"小，因为端点和产品决策已经有了。

长期自用、跟着宿主版本走，选 B。只想先听上，选 A。

---

## 5. 详细设计

### 5.1 目录与清单

```text
sources/bilibili/
  mod.json
  package.json
  README.md                上游（B 站公开接口）、版本、改了什么、接口变了怎么跟
  locales/{zh-CN,en,in,vi}.json
  core/                    ← 三端共用（桌面 mod / 网页+PWA / Android），只 import @folia/folium 类型与 kit
    index.ts               createSource(env)：返回 FoliumSourceDef，按 env.web 有没有选 transport
    bilibiliProvider.ts    把各能力装配起来
    bilibiliAuth.ts        auth@1（扫码、登录态）
    bilibiliLibrary.ts     library@1（收藏夹、稍后再看）
    bilibiliCatalog.ts     catalog@1（夹内分页、合集、分 P）
    bilibiliSongs.ts       songs@1 + bvid→cid 解析与缓存
    bilibiliPlayback.ts    playback.audio@1（选轨、档位换算）
    bilibiliSearch.ts      search@1（M2）
    bilibiliLyrics.ts      lyrics@1（CC 字幕，M3）
    bilibiliNormalize.ts   原始 JSON → FoliumSourceSong / Collection
    bilibiliFailure.ts     HTTP/业务码 → folium.sources.error
    bilibiliTransport.ts   两套 transport：desktop（env.call → rpc）与 web（fetch → 后端）
  client/
    index.ts               activate(folium)：接 rpc，在第一个 await 之前 createSource + register
  main/
    index.ts               activate(api)：只做接线
    bilibiliHttp.cjs       桌面端统一请求：指纹、WBI、cookie、Referer、限速、重试
    bilibiliSession.cjs    凭据加密存取（api.seal + api.legacy.store）
    bilibiliMedia.cjs      media.serve 兜底代理（只在 5.3 的降级路径启用）

src/services/onlineMusic/web/bilibili.ts     网页/PWA/Android 注册：registerFoliumWebSource + core
```

与只做桌面相比，多出来的是 `core/` 的拆分和 `web/bilibili.ts`；这正是 `sources/kugou/` 现在的形状（`core/index.ts` 的 `createSource(env)` + `client/index.ts` + `main/index.ts` + `web/kugou.ts`）。

`mod.json`：

```json
{
  "folium": 2,
  "id": "bilibili",
  "name": "哔哩哔哩",
  "client": "client.mjs",
  "main": "index.cjs",
  "locales": "locales",
  "sources": [
    {
      "id": "bilibili",
      "name": { "zh-CN": "哔哩哔哩", "en": "Bilibili" },
      "requires": ["search@1", "songs@1", "playback.audio@1", "lyrics@1", "auth@1", "library@1", "catalog@1"]
    }
  ]
}
```

`package.json`：**没有第三方依赖**（纯 HTTP + Node 内置 `crypto` 做 MD5），不需要 `folia.dependencies`，产物里没有 `deps` 归档，也没有 worker。相比网易云/QQ/酷狗各自动辄几十 MB 的上游库归档，这是本方案最大的工程优势。

### 5.2 请求通道：桌面走 main，网页走后端

三件事让 client 直连不可行：

1. **cookie**：`SESSDATA` / `bili_jct` 必须在请求头里带，渲染进程不该拿到。
2. **`Referer` / `User-Agent`**：浏览器里改不了，B 站部分接口与 CDN 节点要这两个。
3. **CORS**：`api.bilibili.com` 对带自定义头的跨域请求不保证放行。

所以照 `sources/bodian/` 的形状：client 经 `folium.rpc` 调 main，main 用 `api.net.request` 发请求（自己的命名分区），返回 JSON 给 client，client 只做归一化。WBI 签名放 main（`crypto.createHash('md5')`），密钥缓存在内存，按小时刷新。

限速：搜索、详情、取流各一个令牌桶。起步值"搜索 1 次/秒、详情 5 次/秒、取流 3 次/秒"；命中 `-352` / `-412` 时指数退避，并交给宿主已有的冷却机制（`failure/onlineRequestCooldown.ts`）。

**网页 / PWA / Android 没有 main 入口**：`WebSourceEnv.call` 是恒 reject 的（`foliumWebSource.ts:113`）。所以 `core/bilibiliTransport.ts` 要出两套实现，由 `createSource(env)` 看 `env.web` 有没有来选：

```ts
// 桌面：env.call → folium.rpc → main/index.ts → api.net（带 cookie / Referer / WBI）
const desktop = { request: (op, params) => env.call('http', op, params) };

// 网页 / Android：直接打自建后端（5.8），后端负责 WBI、cookie、Referer
const web = { request: (op, params) => fetch(`${env.web.apiBase}/bili/${op}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
}).then(readJson) };
```

`core` 里不许出现 `api.net`、`crypto`、`api.seal` 这些只有桌面才有的东西；`crypto` 的 MD5 在桌面由 main 做，在网页由后端做。这也是 `sources/README.md` 的 D130 要求（core 只 import `@folia/folium` 类型和 kit）。

### 5.3 播放：`playback.audio@1`

**条目 → cid 的解析链**（决定多 P 视频能不能播对）：

```text
条目 id = bvid            （单 P，最常见）
        | bvid:p<n>       （多 P 的某一 P，只在 collection 里出现）

cid 从哪来（按代价从低到高）：
  1. 歌曲的 data 里带了 cid（收藏夹列表的 ugc.first_cid 存下来的，单 P 才有）
     → 直接用，**零请求**。这是最常见的情形。
  2. data 里没有（搜索结果、或 data 丢了）
     → GET view?bvid=<bvid>，取 pages[0].cid；结果按 bvid 缓存在 main 内存，
       TTL 5 分钟、最多 512 条
  3. id 含 :p<n>（多 P）
     → GET view?bvid=<bvid>，取 pages[n-1].cid

取流：
  → GET playurl?avid=<aid>&cid=<cid>&fnval=4048&fnver=0&fourk=1
  → 从 dash.audio[] 按目标档位挑一条 → 返回 { url, expiresAt }
```

为什么 id 不直接带 cid：搜索与收藏夹返回的都是 `bvid`，不带 cid；id 里塞 cid 会让每个搜索结果都先打一次 `view`，20 条就是 20 次请求，既慢又容易触发风控。`:p<n>` 只在用户明确展开多 P 时出现。

**档位映射**（`audioQualityLevels` 是 getter，登录态变了要 `handle.changed()`）：

| omni 档位 | B 站音轨 | 实测 / 说明 |
| --- | --- | --- |
| `standard` | 30216（HE-AAC 64K） | 匿名可用 |
| `high` | 30280（AAC 192K），没有就退 30232（132K） | 匿名可用 |
| `lossless` | `dash.flac.audio` | 需登录 + 大会员，**待验证** |
| `ultra` | `dash.dolby.audio` | 只有列出它的音源能用；只在登录且拿到 dolby 时列出 |

不给 `hires` 档：B 站没有对应语义，别硬套（第三方实现也得出同样结论）。

`getAudioSource` 返回：

```ts
{
  url: 'https://...mcdn.bilivideo.cn:8082/v1/resource/...30280.m4s?...',
  expiresAt: 1795538109000,   // 来自 URL 里的 deadline
  quality: 'high',            // 实际拿到的档位（可能要不到、退回低档）
}
```

**防盗链的两条路径**：

- 默认（M1）：`api.media.allow({ urls: [...], hosts: ['*.bilivideo.cn', '*.bilivideo.com', '*.hdslb.com'], followRedirects: true })`。每次 `getAudioSource` 拿到的地址用返回函数的 `add` 加进规则，`ttlMs` 按 `deadline` 算。
- 降级：某个 upos 节点确实校验 `Referer`、直连 403 时，main 里 `api.media.serve('audio', handler)`，按参数重新 playurl（必要时带 cookie），带 `Referer: https://www.bilibili.com` 与 `User-Agent` 转发，保留 `Range`，返回转发后的 `Response`（`modProtocol.cjs` 允许 handler 直接返回 web `Response`，206 与 `Content-Range` 能原样透出）。代价是音频流量经主进程转发，所以只在实测到 403 的节点上启用。

> 不采用"把 cookie 拼进 URL 交给 CDN"这类做法 —— 那会把凭据写进宿主的缓存与历史。

**长视频**：B 站常见"一整张精选集一个视频"（实测搜索第一条就是 419 分钟）。按一条 419 分钟的音轨处理，宿主会整首缓存（可能几百 MB）。M1 先如实给 `durationMs` 与 URL；"超长条目不缓存"需要宿主支持，列为开放问题（第 15 节）。

### 5.4 歌词：`lyrics@1`

1. **自己的 CC 字幕**：`x/player/v2?aid&cid` → `data.subtitle.subtitle[]`，按 `lan` 匹配界面语言（优先 `zh-CN`），下载 `subtitle_url` 的 JSON，转 `lrc`（`[mm:ss.xx]内容`，保留 `from` 的 10ms 精度）。返回 `FoliumSourceLyricsResult` = `{ main: { format: 'lrc', text } }`（字幕只有逐行，不填 `wordByWord`）。
2. **跨源匹配**：绝大多数音乐视频没有 CC 字幕。宿主在 `itemKinds.video.lyrics = 'match'` 时会走跨源匹配管线，本音源只需把"能被搜到的名字"交准：
   - `getSearchAlias(song)`：把标题清洗成能搜的样子 —— 去掉 `【4K修复】`、`（官方MV）`、`[Hi-Res]`、`_哔哩哔哩_bilibili` 一类前后缀，去掉 `｜` 之后的分 P 名，保留书名号内正题。
   - `getAlternateArtistName`：UP 主名常是"XX音乐站"，不当歌手名；优先取 `+` / `&` / `feat.` 分割出的部分。
   - 标题含"伴奏""instrumental""纯音乐"的按 `pureMusic` 处理，不换名再搜。

### 5.5 登录：`auth@1`

```text
startLogin()
  → main: GET passport/qrcode/generate → { qrcode_key, url }
createQr(key)
  → 把 url 编成二维码，返回 data URL
checkLogin(key)
  → main: GET passport/qrcode/poll?qrcode_key=… → data.code
     86101 未扫码 / 86090 已扫码未确认 → { state: 'waiting' }
     86038 失效 → { state: 'expired' }
     0 成功 → 从响应头 Set-Cookie 取 SESSDATA / bili_jct / DedeUserID
getLoginStatus()
  → main: GET api/nav（带 cookie）→ code 0 且 isLogin → { id: DedeUserID, nickname: uname, avatarUrl: face, vipType: vipStatus }
logout()
  → 清凭据
```

凭据处理：

- main 里 `api.seal` 加密后写 `api.legacy.store` 的 `bilibili_session` 键（受信表那一行要声明），渲染进程永远拿不到 `SESSDATA` / `bili_jct`。
- 写操作的 `csrf` 参数用 `bili_jct`，只在 main 里拼。
- 退出登录、登录失效时按宿主约定先丢内存再清盘。

`describeLoginFailure` 要认：二维码过期、`-352`（风控）、`-412`（拦截）、网络层没回答（交给 `transient`）。换成 `FoliumSourceLoginFailure` 的共用事实，不把 B 站话术硬写进宿主。

### 5.6 同步：`library@1` + `catalog@1`

这里的"同步"是**只读同步**：把账号里的列表拉成 Omni 集合，不写回 B 站（写入见 5.7）。

| B 站的东西 | Omni 形态 | 端点 | 状态 |
| --- | --- | --- | --- |
| 自建收藏夹 | `type: 'playlist'`，`isOwned: true` | `x/v3/fav/folder/created/list-all?up_mid=<mid>` | ✅ 参数与字段已确认 |
| 收藏夹里的视频 | 集合内的条目 | `x/v3/fav/resource/list?media_id=&pn=&ps=20&platform=web` | ✅ 参数与字段已确认 |
| 收藏的合集/别人的收藏夹 | `type: 'playlist'`，`isOwned: false` | `x/v3/fav/folder/collected/list` | ✅ 参数与字段已确认 |
| 批量补全内容信息 | — | `x/v3/fav/resource/infos?resources=<id>:2,...` | ✅ 已确认（省掉逐条 `view`） |
| 稍后再看 | `type: 'playlist'`，`id: 'toview'` | `x/v2/history/toview` | 端点存在，字段**待验证** |
| UP 主合集 / 系列 | `type: 'album'` | `x/polymer/web-space/seasons_archives_list`、`x/series/archives` | 阶段 6 |
| 观看历史 | 不接（属于应用自己的播放记录，宿主已有） | — | ❌ |

`getUserPlaylists` 按 B 站给的一页返回 `FoliumSourcePage<FoliumSourceCollection>`，集合 `id` 用 `fav:<media_id>` 这种带前缀的形式，避免与 bvid 撞。首屏只读列表（不预取内容），进集合页再按 `catalog.getPlaylistTracks(id, limit, offset)` 分页读。

**收藏夹列表的字段语义**（据 `bilibili-API-collect` 镜像，与原生返回一致）：

| 字段 | 用法 |
| --- | --- |
| `id` | 完整 media_id（`原始 id + 创建者 mid 尾号两位`），集合 id 用它（`fav:<id>`） |
| `fid` | 原始收藏夹 id，**不含** mid 尾号；只在少数老接口里用，**不要**拿它当 media_id |
| `attr` | 位标志：**bit0 = 私有**（0 公开 / 1 私有）；**bit1 = 是否为默认收藏夹**（0 默认 / 1 其他）。所以默认收藏夹是 `(attr & 2) === 0`，私有的判 `(attr & 1) === 1`。示例印证：默认收藏夹 `attr=0`，其他夹 `attr=22` |
| `media_count` | 夹内条目数，直接填 `FoliumSourceCollection.trackCount`，省一次请求 |
| `title` / `cover` | 封面字段存在但**常为空串**，所以"用第一条视频封面顶上"的回退仍然需要 |
| `ctime` / `mtime` | 填 `publishedAt` / `updatedAt` |
| `upper` | 创建者 `{ mid, name, face }`，填 `creator` |
| `state` | 收藏的合集专用：0 正常 / 1 已失效 → 已失效的不进列表 |

参数上还有三个能省事情的东西：`created/list-all` 支持 `type=2`（只要视频稿件）与 `rid`（查某个视频在哪些夹子里）；`collected/list` 的 `ps` 定义域是 1~70（比夹内内容的 20 大）；`collected/list` 必须带 `platform=web` 才会把"用户收藏的视频合集"包含进来。

**夹内内容（`resource/list`）的契约**，这一块是同步的核心。下表里标 **[实测]** 的是 2026-11-24 在真实登录态下抓包与试探得到的，与社区文档不一致的地方以实测为准：

| 项 | 值 |
| --- | --- |
| 参数 **[实测]** | `media_id`、`pn`、`ps=40`、`keyword=''`、`order=mtime`、`type=0`、`tid=0`、`platform=web`、`web_location=333.1387` |
| 页大小上限 **[实测]** | **`ps=40` 可用；`ps=50` / `ps=100` 返回 `-400`**。社区文档写的"1~20"是过时的，真实上限是 40 |
| 分页 **[实测]** | 只看 `data.has_more`。最后一页（两百多条的夹子，`pn=6`）返回 7 条 + `has_more=false`；越过末页（`pn=7` / `pn=99`）返回 **`code=0`、`medias:null`、`has_more:false`、`info` 缺失**（此时读到的 `media_count` 是 0，**不能**当成"空夹子"） |
| 计数不可靠 **[实测]** | 该夹 `media_count=209`，但六页实际返回 206 条 → 有 3 条不可见/已失效。**不要拿 `media_count` 算页数**，只用 `has_more` 递进 |
| 每条 | `id`(avid) / `bvid` / `title` / `cover` / `intro` / `page`(分P数) / `duration`(**秒**) / `upper{mid,name,face,jump_link}` / `cnt_info{collect,play,danmaku,…}` / `pubtime` / `fav_time` / `type` / `attr` / **`ugc.first_cid`** / `season` / `ogv` / `media_list_link` |
| 失效条目 | `attr`：0 正常、1 其他原因删除、9 UP 主自己删除 → **只留 `attr === 0`**，失效的不占位（实测该夹里三种都有） |
| 条目类型 **[实测]** | 见到 `type` 为 **2**（视频稿件）与 **24**（未知，跳过）；文档另列 12 音频、21 视频合集 |
| 附赠 | 响应带 `data.info`（整个夹子的元数据），进夹子后**不需要**再单独调 `folder/info` |
| 额外请求头 **[实测]** | 网页端还带 `x-bili-locale-json`、`x-bili-device-req-json`（`{"platform":"web","device":"pc","spmid":"333.1387","mobi_app":"web_cn"}`）；不带也能通，但带上更像正常客户端 |
| 错误 | `-400` 请求错误（含 `ps` 越界）、`-403` 访问权限不足（私有夹且未登录） |

**两个性能结论**：

1. `medias[]` 自带 `title` / `cover` / `duration` / `upper` / `bvid` / `attr`，**列表页一条额外请求都不用发**。
2. 更关键的 **[实测]**：每条带 `ugc.first_cid`。**单 P 视频（`page === 1`）直接拿它当 cid 就能取流**，连 `view` 都省了；只有多 P 视频才需要 `view`（或 `pagelist`）去取指定 P 的 cid。按 40 条一页算，这等于把"翻一页 41 次请求"压到 1 次。

**另一处实测修正**：`info.attr` 在**正常**收藏夹上实测是 `1`，所以社区文档里"`info.attr` 0 正常 / 1 失效"这句不能用来判断夹子是否有效——判断失效要看 `medias[].attr`，不是 `info.attr`。

**一个实测结论**：`created/list-all` 匿名读**别人的**自建收藏夹一律返回 `code 0, count 0`（试了 UID 2 和 546195），也就是说这个接口实际上只能读到**自己的**账号。对"同步自己的收藏夹"完全够用，也解释了为什么整条链路必须先登录——不存在"匿名也能看公开收藏夹列表"的捷径。

**登录态下的真实响应**（2026-11-24，一个 几十个收藏夹、其中某个 两百多条内容的账号）：

- `folder/created/list-all?up_mid=<mid>&web_location=333.1387` → `{ count: 86, list: [86 项], season }`，无分页。
- `folder/collected/list?pn=1&ps=50&up_mid=<mid>&platform=web&web_location=333.1387` → `{ count, list, has_more }`——**注意它也有 `has_more`**，文档没写。
- `folder/season/show` 也会被网页端调用（合集相关，阶段 6 再看）。

#### 契约已经有文档，但仍要抓一次包核对

这块的接口 B 站**没有官方文档**，现成的规格来自社区的 `bilibili-API-collect`（本轮读的是它的镜像 `janson20.github.io/bilibili-api-collect-mirror`，MIT）。上面那张表就是照它整理的。但社区文档同样会滞后于真实接口，所以实现第一步仍要抓一次真实请求，把结果固化成 fixture：

1. 浏览器登录 B 站，打开 `https://space.bilibili.com/<UID>/favlist`。
2. 开发者工具 → Network，勾上 **Preserve log**。
3. 点开一个收藏夹、往下滚动触发「加载更多」，再切到第二个收藏夹——这两步分别暴露「收藏夹列表」（`created/list-all`）与「夹内内容」（`resource/list`）两个请求。
4. 对着文档核对四件事：请求 URL 的**完整查询参数**、**必需的请求头**（`Cookie`、`Referer`、`User-Agent` 之外还有没有别的）、返回的 `data.info` / `data.medias[]` / `data.has_more` **是否与文档一致**、以及**翻到最后一页时** `has_more` 是否变 `false`（或者返回空数组）。
5. 把响应关键部分（脱敏掉 cookie）存到 `test/manual/bilibili-fixtures/`，单测与 `test/manual/fakeSourceNetwork/` 都用它。

这一步产出的是整个音源里**最容易失效的部分的基线**：B 站改了分页字段，单测会直接失败，而不是等用户发现某个收藏夹打不开。

> 社区文档、抓包教程都只能当**线索**，不能当契约：它们不随 B 站改动更新，参数与返回结构经常已经过时（本轮就实测到扫码接口的域名与常见写法不一致：`passport.bilibili.com` 可用，`api.bilibili.com` 返回 404）。结论一律以自己抓到的包为准。

> 顺带一个教训：`bilibiliapi.github.io` 那份文档把 `attr` 的两个位**写反了**（把"默认收藏夹"标在 bit0 上），照着写会把默认夹判错。`bilibili-API-collect` 的表格与示例（默认夹 `attr=0`、其他夹 `attr=22`）才对得上。这就是为什么要留 fixture 做回归。

**红心**：`mutations@1` 的 `likeSong` 映射到"收藏进指定收藏夹"（`x/v3/fav/resource/deal`，参数 `rid` = aid、`type` = 2、`add_media_ids`）。注意 B 站的"点赞"与"收藏"是两件事：这里只做收藏（更符合"收藏夹"语义），`areSongsLiked` 用 `x/v3/fav/resource/ids` 批量查。

### 5.7 可选能力

- **探索（`explore@1`，M6）**：首页推荐（`x/web-interface/wbi/index/top/feed/rcmd`）、排行榜。宽图条目用 `wideCoverUrl`，对应宿主探索页的 16:9 支持。
- **封面（`covers@1`）**：`hdslb.com` 支持 `@<宽>w_<高>h_1c.webp` 后缀，按宿主请求的尺寸拼。

---

### 5.8 网页 / Android 所需的后端

**为什么必须有**：2.5 节的三条实测/事实（`api.bilibili.com` 对跨域来源直接 403、跨域 `Set-Cookie` 拿不到、浏览器改不了 `Referer`/`UA`）。这不是"可以优化掉"的部分——没有后端，网页版和 Android 上的 B 站音源连登录都做不了。

**它要做的事**（尽量薄，只做浏览器做不到的）：

| 职责 | 说明 |
| --- | --- |
| 代理请求 | `POST /bili/:op`，按 op 映射到 `x/web-interface/view`、`x/player/playurl`、`x/v3/fav/...` 等；统一加 `Referer: https://www.bilibili.com`、`User-Agent`、`Origin` 取自站内 |
| WBI 签名 | 取 `wbi_img` 两个 key、按 `mixinKeyEncTab` 重排、MD5；密钥按小时缓存 |
| 指纹 | `x/frontend/finger/spi` 取 `b_3`/`b_4`，作为 `buvid3` cookie 随请求带 |
| 会话 | 扫码：`/bili/login/qr` 建会话 → `/bili/login/poll` 轮询；成功后把 `SESSDATA`/`bili_jct`/`DedeUserID` 存成服务端会话，前端只拿一个不透明 `session` 令牌 |
| 凭据保护 | 会话令牌同 `QQ_SESSION_SECRET` 的做法：加密存储或服务端内存 + 短 TTL；**不加 `VITE_` 前缀**（带前缀会被编进前端） |
| 限速 | 每会话令牌桶，避免一个用户把出口 IP 打到风控 |

**不该做的事**：不代理音频（CDN 允许 `ACAO: *`，直连即可）、不做搜索缓存（B 站结果与时事相关）、不存视频内容。

**部署形态**（照 `docs/qq-music-deployment.md` 的四条路）：

| 形态 | 扫码登录 | 说明 |
| --- | --- | --- |
| Docker / 裸 Node.js | ✅ 会话保存在服务端 | 自托管首选；PWA 与 Capacitor 打包的 APK 都指向它 |
| Vercel / Cloudflare | ✅（令牌加密） | 与 QQ 一样用加密令牌，跨请求不需常驻连接；B 站扫码本来就是短轮询，比 QQ 的 MQTT 好办 |
| 桌面版 | 不需要部署 | 桌面走 `main` 入口，能力等价 |

**工作量提示**：这是本方案里唯一"从零写服务端"的部分。可以把范围压到最小——只需 `login / favorites / playlistTracks / songDetail / playurl` 五个 op，就能满足"收藏夹同步 + 在线听"。搜索、歌词、红心都可以留到后端第二轮再加。

---

## 6. 数据流

```text
同步（M1 主体）
  登录 → omni.readAccount('bilibili', …)
    → auth.getLoginStatus（nav）
    → library.getUserPlaylists（分页）
    → OmniCollection 列表进账号缓存，宿主「歌单」页签自动出现卡片
  点开某个收藏夹 → catalog.getPlaylistTracks(fav:<media_id>, limit, offset)
    → 每页 20 条 → Normalize → FoliumSourceSong（itemKind: 'video'）

播放
  队列里的条目（itemKind: 'video'）
    → omni.getAudioSource(song, 'high')
    → playback.audio@1.getAudioSource
    → rpc → main：view(bvid) → cid（缓存）→ playurl(avid,cid,fnval=4048)
    → 选轨 → { url, expiresAt, quality }
    → api.media.allow 把这条 URL 加成可跨域读的地址
    → 宿主 <audio> 直接播；缓存、预取、均衡器、歌词时钟照常工作

搜索（M2）
  用户输入 → omni.searchSongs → search@1 → rpc → main：buvid3 → WBI → wbi/search/type
    → 归一化（duration "419:2" → 25142000ms、title 去 <em>、pic 补 https）
```

---

## 7. 宿主侧改动清单

只有登记表，没有逻辑分支。

| 文件 | 改什么 | 为什么 |
| --- | --- | --- |
| `electron/modSystem/builtinSources.cjs` | 加一行：`sources: ['bilibili']`、`storeKeys: ['bilibili_session']`、其余空 | 受信表：模组 id → 短 id、旧数据归属。`test/unit/sources/builtinSourcesHelper.test.ts` 与 `builtinManifests.test.ts` 会核对 |
| `src/services/onlineMusic/providerRegistry.ts` | `BUILT_IN_SOURCE_ORDER` 那一行加 `'bilibili'` 并定位置 | 决定它在切换器、登录窗口、搜索命令里的顺序；不写就排在现有十家后面 |
| `test/unit/onlineMusic/platformNameCount.ts` | `PLATFORM_NAMES` 加 `bilibili: /bilibili|哔哩/i` | D131 计数要知道这个平台 |
| `test/unit/onlineMusic/platformNamePlaces.ts` | 登记上面两处提到它的行数与原因 | 数字只降不升，用 `node test/unit/onlineMusic/platformNameCount.ts --lower` 收敛 |
| `dev/dedicatus/storageKeys.mjs` | 登记 `bilibili_session` 及 `online_provider_bilibili_*` 之外的键（如有） | D507 |
| `dev/dedicatus/credentialWriters.mjs` | 登记 main 里写凭据的那个函数 | D604 |
| `sources/bilibili/README.md` | 按 `UPSTREAMS.md` 的规矩写接口来源与变更应对 | 仓库惯例 |
| `src/services/onlineMusic/web/bilibili.ts`（新增） | 用 `registerFoliumWebSource` 注册 core，接 `VITE_BILIBILI_API_BASE` | 网页 / PWA / Android 的入口；照 `web/kugou.ts` |
| `docs/bilibili-service-deployment.md`（新增） | 照 `docs/qq-music-deployment.md` 写后端部署（Docker / Vercel / Cloudflare） | 用户自托管 PWA/APK 要读它 |
| `dev/sources/webSourcePlugin.mjs` | **不用改**：`virtual:folia-web-sources` 按 `FOLIA_BUNDLED_SOURCES` 自动引入 `web/<id>.ts` | 但要把 `bilibili` 加进默认打包清单，否则网页构建里没有它 |

不需要动：`electron/main.cjs`、`electron/preload.cjs`、`src/vite-env.d.ts`、任何组件、任何 store。缓存键用 `providerStorage.ts` 的 `online_provider_bilibili_...` 前缀就自动被"清除数据"覆盖。

两个容易忽略的点：

- **`src/utils/lyrics/lyricSources.ts` 不用改**。`BUILT_IN_ENTRIES` 只列宿主"按名字认识"的非平台来源（AMLL 等），平台的歌词来源自 Folium 2.0 起全部由音源模组在运行时经 `lyrics@1.crossSource` 注册。
- **语言与清单**：`builtinManifests.test.ts` 要求四种语言的名字齐全、`zh-TW.json` 不手写（构建生成）；`test/unit/i18n/providerName.test.ts` 按 `listBuiltinSourceDirs()` 自动发现新目录，少一份语言表就挂。

---

## 8. 失败与边界

| 情形 | 处理 |
| --- | --- |
| 搜索返回 HTML 反爬页 | 判 `Content-Type` 不是 JSON，抛 `network`；同时把 WBI 密钥标记为过期、重取一次再试 |
| `-352` 风控校验失败 | 抛 `unavailable`，`retryAfterMs` 给退避时间；不重试同一请求 |
| `-412` 请求被拦截 | 抛 `unavailable`；模组语言表提示"B 站暂时拒绝了这台机器的请求" |
| `-404` 视频不存在/已删 | `songs@1.getSong` 回 `null`（宿主按"没有这首"处理），不抛错 |
| `-101` 账号未登录（实测：`x/v2/history/toview` 匿名即回它） | 抛 `auth-required`；宿主据此把账号入口画成"未登录"，而不是"读失败" |
| `-400` 参数错误（实测：`up_mid=0` 这类） | 抛 `invalid-response`，记日志带请求参数（脱敏） |
| `-403` 仅大会员可看 | 抛 `subscription-required` |
| 地区限制（`-10403`） | 抛 `region-restricted` |
| 音轨全部缺失（直播回放、音频被删） | 抛 `not-playable` |
| URL 过期（`deadline` 已过） | 宿主重试时重新 playurl；`expiresAt` 已交给宿主，预取会避开临期地址 |
| 多 P 的 P 号越界 | 回退 P1，记一行日志 |
| 凭据读不出（系统加密不可用） | 按游客请求，不删存着的会话，`getLoginStatus` 回 `null` |

错误码到 `FoliumSourceErrorCode` 的映射集中在 `client/bilibiliFailure.ts` 一处。

---

## 9. 关键设计决策

**D1. 条目 id 用 `bvid`（多 P 用 `bvid:p<n>`），不把 cid 塞进 id。**
代价是播放前多一次 `view`（5 分钟缓存）。收益是搜索结果、收藏夹、历史里的同一条目 id 一致，不必为 20 条搜索结果打 20 次 `view`。

**D2. 主路径走 `playback.audio`，`surface` 只做可选。**
"在线听"的核心价值是缓存 + 后台 + 均衡器 + automix + 歌词，只有宿主自己的音频图能做。

**D3. 请求全部走 main。**
cookie 不外泄、Referer 可设、CORS 不存在、限速与重试集中一处。

**D4. 不引入第三方库。**
WBI 签名是 30 行 MD5，`playurl` / `view` 是普通 JSON。相比网易云/QQ/酷狗打几十 MB 上游库归档，构建产物是纯代码。

**D5. 歌词自己只出 CC 字幕，其余交给宿主跨源匹配。**
B 站没有歌词体系，自己维护映射既不准也不可持续。

**D6. 收藏夹同步只读，写入（收藏/取消）放 M4。**
只读同步风险为零（不发写请求、不碰 `bili_jct`）；写操作要过 CSRF、要处理风控，收益却小于"先能听"。所以 M1–M3 不需要 `bili_jct`，登录后只用来提高音质档位与读收藏夹。

**D7. 不自建设置面板。**
第三方实现用了 908 行自建设置面板（因为 Folium 1 没有能力位可声明）。Folium 2 里"这个源有哪些能力"由 `capabilities` 决定，界面由宿主按能力生成；只有真正需要用户选择的（默认收藏夹、是否显示长视频）才做成设置项，走 `recommendationPreferences` 之外的普通存储。

---

## 10. 分阶段计划

每个阶段都能独立交付、独立验证。**顺序按需求确认后的权重排：账号与收藏夹同步先做，搜索靠后。**

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| **M1** 桌面能同步、能听 | `core` 拆分、`client` + `main`、宿主登记、`auth@1`、`library@1`（收藏夹 + 稍后再看）、`catalog@1`、`songs@1`、`playback.audio@1`、`media.allow` | Windows 桌面：扫码登录后「歌单」页签出现收藏夹；点开能读到第二页；点一首能放、能拖进度；退出登录后入口消失 |
| **M2** 网页 / PWA 能用 | 后端（5.8 的五个 op）+ `web/bilibili.ts` + `VITE_BILIBILI_API_BASE` | 浏览器打开网页版：扫码登录、收藏夹出现、能放；后端关掉时音源显示"未配置"而不是崩 |
| **M3** Android 能用 | PWA 加到主屏；或用 Capacitor 打一版 APK 验证（`chthollyphile/folia-sonnet`） | 安卓机上：同样的登录与收藏夹；切后台再回来播放不断 |
| **M4** 能搜 | `search@1`（WBI，桌面走 main，网页走后端加一个 op）、多 P 展开、标题清洗 | 搜"周杰伦"能出结果并播放 |
| **M5** 能唱 | `lyrics@1`（CC 字幕）+ `getSearchAlias` + 跨源匹配；`covers@1` | 有字幕的视频出歌词；无字幕的音乐视频能匹配到网易云歌词且时间轴对得上 |
| **M6** 能写 | `mutations@1`（心形 → 收进指定收藏夹）、`areSongsLiked`、UP 主合集、`explore@1` | 点心形后 B 站网页端收藏夹里能看到；取消后消失 |

**顺序的理由**：M1 先把"能听"这条链在桌面上跑通（那里没有后端依赖，迭代最快）；M2 把同一份 `core` 换个 transport 就搬到网页——如果 M1 的 `core` 拆得干净，M2 主要是写后端，不是重写音源；M3 只是验证壳。搜索、歌词、写回都不影响"收藏夹同步 + 在线听"这条主需求，所以排在能跨端跑之后。

宿主侧的登记（受信表、顺序表、平台名表）在 M1 就要做完，否则桌面模组加载不起来。

---

## 11. 测试

| 层 | 做法 |
| --- | --- |
| 单测 | `test/unit/bilibili/`：`view`→cid 解析、`duration "419:2"`→毫秒、`<em>` 清洗、选轨（含只有 30232 的情形）、WBI 签名对固定输入出固定 `w_rid`、错误码映射、翻页游标 |
| 契约 | 借 `dev/folium/sample-source-full/` 的契约测试形状，把本音源的能力跑一遍（不联网，固定应答） |
| 假网络 | `test/manual/fakeSourceNetwork/` 给 `api.bilibili.com` / `passport.bilibili.com` 写路由表，验证管道（登录→收藏夹→播放→歌词）而不依赖真实接口 |
| 宿主注册 | 测试文件首行写 `// @builtin-sources`，由 `test/unit/helpers/builtinSources.ts` 注册 |
| 桌面实测 | `run-desktop` skill：真放一首、拖进度、切歌、断网重试、登录扫码、读收藏夹第二页、点心形 |
| 静态 | `npm run dedicatus`、`npm run typecheck`、`npm run lint`（先 `npm run lint:install`） |

真实接口的断言不进 CI（B 站会变、会风控），只在 `test/manual/` 留可手动跑的探针。

---

## 12. 风险

**技术风险**

1. **风控是最大不确定性**。搜索必须 WBI + `buvid3`；3.4 的压测（0.8 秒/次 × 5 次全成功）只说明短时可用，不等于安全阈值。读收藏夹、翻页、红心都是带 cookie 的请求，风控策略与匿名搜索不同，**M1 要在真实账号上先压一轮**。
2. **匿名音质只有 64K/132K/192K**。想听无损必须登录 + 大会员，且只对部分视频有 flac/dolby。
3. **CDN 节点行为不一致**（mcdn 实测不要 Referer，upos **待验证**）。降级代理路径要留好。
4. **接口没有承诺**。B 站改 `playurl` 参数或反爬策略是常态，`README.md` 要写清"上游变了怎么跟"，探针要能一键跑。
5. **超长条目**（几小时）的缓存会吃满磁盘，宿主没有"这条别缓存"的开关。
6. **收藏夹接口不返回封面**（第三方实现的已知限制）：只能拿夹子里第一条视频的封面顶上，会有对不准的情况。

**多端风险**

7. **后端是新增的运维负担**。桌面可以内置，网页与 Android 必须有人部署和续期（HTTPS、域名、密钥）。这是本方案相对"只做桌面模组"多出来的最大成本，也是 QQ 音乐已经承担过的同类成本。
8. **服务端出口 IP 的风控集中度更高**：多个用户共用一个后端出口时，B 站更容易把整个出口判成异常。设计上要给每个会话单独的限速与退避，并在文档里写清"自托管的后端只给自己用"。
9. **Android 只能通过 Web 壳**（PWA / Capacitor），所以 Android 上的一切都受 2.5 节与第 7 条约束；没有"Android 上有更省事的路"这种可能。社区移植版如果改动了网页版的构建参数，`FOLIA_BUNDLED_SOURCES` 里必须带上 `bilibili`，否则源不进包。

**合规与版权**

10. **收藏夹走的是未公开接口**：官方开放平台的六类能力里没有收藏夹（已用真浏览器确认），所以 `x/v3/fav/*` 属于网页自用的接口，随时可能变，也没有使用授权。README 与 `enableNotice` 要如实写：只做个人客户端播放，不下载、不转存、不再分发，接口随时可能失效；不能宣传成"官方支持"。
11. 视频内容是 UGC，版权归 UP 主；本地缓存属于个人使用，不改变这一点。
12. 仓库是 AGPL-3.0，新增模组沿用仓库许可；借鉴 MIT 的实现要在 `README.md` 注明来源。

---

## 13. 参考实现

- **`qingxian997/folia-bilibili-source`**（同生态第三方模组，MIT）：**第一参考**。它在 0.7.29 上真正跑通了"收藏夹进书库"，端点清单、产品决策、宿主门槛都可以沿用；但它靠反射宿主 chunk 实现，本方案不复制这一点（见 4.5）。可直接借鉴：`lib/bvid.cjs`、`lib/cookie.cjs`、`lib/lrc.mjs`、`lib/title.mjs`、`lib/exclude.mjs`、`lib/collected.mjs`、`lib/collections.mjs`、`lib/proxyStream.cjs`。
- **`bilibili-API-collect` 的镜像**（`https://janson20.github.io/bilibili-api-collect-mirror/`，社区维护，MIT）：**接口规格的第一来源**。收藏夹四个接口（`folder/info`、`folder/created/list-all`、`folder/collected/list`、`resource/list`）的参数、返回字段、错误码都在里面，本轮已照它把 5.6 的契约写定。它也会滞后，所以实现时仍要抓一次包核对。
- **`nemo2011/bilibili-api` 的文档**（<https://nemo2011.github.io/bilibili-api/#/>，第三方 Python 库）：按模块整理 web 接口的第二来源——收藏夹、搜索、播放地址、WBI 都在里面，比翻源码快。**但它是逆向整理、会滞后**：本轮实测就发现扫码接口在 `passport.bilibili.com`，而在 `api.bilibili.com` 上请求返回 404 HTML，所以文档只当线索，结论以真实请求为准。
- **哔哩哔哩开放平台**（<https://openhome.bilibili.com/doc>，官方）：**已用真浏览器渲染确认**其能力清单，六类能力是——账号授权、用户管理（获取用户**公开**信息）、视频管理（稿件发布/删除/查询）、数据开放（授权后的用户数据与稿件数据）、专栏管理、直播能力。**没有收藏夹 / 收藏夹内容的读取能力**。结论：收藏夹只能走未公开的 web 接口（`x/v3/fav/*`），这个音源不能宣传成"官方支持"，合规声明要按"非官方接口、个人使用"写。
- **yt-dlp 的 `bilibili` extractor**（Python）：WBI 签名、`playurl` 参数组合、多 P 处理、DASH 选轨的标准做法；它也记录了 B 站接口的历次变更，做"上游变了怎么跟"时最有用。
- **BBDown**（C#）：扫码登录、`fnval` 位与 Dolby/Hi-Res 档位处理，对"登录后能拿到什么"最有参考价值。
- **lux**（Go）：多站点 DASH 选轨的通用结构。
- **`sources/bodian/`**（本仓库）：最短的"client + main + bridge + mediaCors"音源，工程形状照它。
- **`dev/folium/sample-video-source/`**（本仓库）：`itemKinds`、`routeOf`、`playback.surface` 的官方示范，M5 照它的玩家实现。

---

## 14. 待验证清单（实现前必须做）

1. 登录后 `dash.flac.audio` / `dash.dolby.audio` 的真实字段与档位 id。
2. `upos-sz-mirrorcos.bilivideo.com` 一类节点是否强制 `Referer`。
3. ~~收藏夹、收藏的合集、稍后再看的分页上限与参数~~ **已实测确认**：`resource/list` 的 `ps` 真实上限是 **40**（50/100 回 `-400`；社区文档写的 1~20 过时），分页只看 `has_more`；`collected/list` 网页端用 `ps=50`、响应也有 `has_more`；`created/list-all` 无分页（一次给全，实测 几十个收藏夹）。**只剩「稍后再看」`x/v2/history/toview` 的字段未核对**。
4. `poll` 成功时凭据在 `Set-Cookie` 里的确切形态（是否分多条、`DedeUserID__ckMd5` 要不要存）。
5. 字幕 JSON 的字段名（`body[].from/to/content`）与下载是否要 `Referer`。
6. `x/player/v2` 的 `view_points`（章节）是否可用于拆曲目。
7. 带 cookie 的请求（读收藏夹、翻页）的风控阈值。
8. `x/v3/fav/resource/deal` 的收藏参数（`add_media_ids` / `del_media_ids` / `csrf`）。
9. ~~收藏夹的 `media_id` 与"默认收藏夹"如何识别~~ **已确认**：`media_id` 是列表里的 `id`（`fid` 是去掉 mid 尾号的原始 id，别混用）；`attr` 的 **bit0 = 私有**、**bit1 = 默认收藏夹**，所以默认夹判 `(attr & 2) === 0`、私有判 `(attr & 1) === 1`。`cover` 字段存在但常为空，回退仍需要。
10. ~~官方开放平台的能力清单里有没有收藏夹读取~~ **已确认没有**：开放平台六类能力（账号授权、用户公开信息、视频管理、数据开放、专栏、直播）都不含收藏夹。所以收藏夹是未公开接口，合规口径按"非官方接口、仅个人使用"写。
11. 网页端播放与缓存：`<audio>` 用 CDN 直链时是否需要设 `crossOrigin`；宿主的音频缓存走 `fetch`，实测 CDN 有 `ACAO: *`，但要确认实际下载路径不被 `Content-Type: application/octet-stream` 之类绊住。
12. Capacitor 打包的 APK 里，WebView 的存储（会话、缓存）在后台被回收时的行为——影响"切后台再回来播放"的验收。

---

## 15. 需要拍板的开放问题

1. ~~"同步"是否就是收藏夹 + 稍后再看？~~ **已确认**：收藏夹是底线，按需求做收藏夹 + 收藏的合集 + 稍后再看；观看历史不做，关注 UP 主放 M5。
2. **默认音质**：默认 `high`（192K，匿名可用）还是跟用户设置走？（`resolveAudioQuality` 会按 provider 列出的档位换算，不影响已存偏好。）
3. **超长视频要不要拆**：419 分钟的精选集当一条，还是用章节/多 P 拆成多条？拆了更像歌单，但依赖视频本身有章节信息。
4. **先走路 A 还是路 B**：先用第三方模组把功能用上、再按本方案重写；还是直接写。两者不冲突，可以并行。注意路 A 只有桌面（它是 Electron 模组），**Android 用不了**。
5. **是否进安装包**（`FOLIA_BUNDLED_SOURCES` 默认带上）：内置音源的代码会随安装包分发，考虑到 B 站的合规态度，也可以只作为第三方模组发布。若只作第三方模组，网页/Android 那条路（`web/bilibili.ts`）就要改成可配置的社区构建，比内置复杂。
6. **红心语义**：B 站的"点赞"与"收藏进收藏夹"是两件事。心形按钮接哪一个？（5.6 选收藏，因为更贴合"收藏夹"；但用户的直觉可能是点赞。）
7. **后端谁来托管**：自己一台 VPS（Docker）、Vercel/Cloudflare（serverless），还是只在你自己的机器上跑给手机局域网用？这决定 5.8 的实现形态与文档。
8. **Android 先走哪条**：先把 PWA 加到主屏验证（零额外工作），还是直接 Capacitor 打 APK（要处理 WebView 差异）？
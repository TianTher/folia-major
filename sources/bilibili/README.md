# bilibili（`bilibili`）

Folia 内置的 bilibili 音源模组（Folium 2）。“听歌”用的是视频自带的音轨，视频画面不参与播放。构建、布局和依赖的规矩见 `dev/sources/README.md`。

- **上游**：bilibili 网页版自己在用的那几个接口，没有官方 SDK，也没有第三方包代发请求：
  - `x/web-interface/nav`、`x/web-interface/view`：账号、视频信息（`pages[].cid`）；
  - `x/player/playurl`（`fnval=4048`）：音频地址（`dash.audio`，30216 / 30232 / 30280 三档）；
  - `x/player/v2`：字幕列表（`subtitle.subtitles[]`，`lan` 以 `ai-` 开头的是机器识别，不当歌词）；
  - `x/v3/fav/folder/created/list-all`、`x/v3/fav/resource/list`：收藏夹清单与内容（后者 `ps` 上限 40）；
  - `passport.bilibili.com/x/passport-login/web/qrcode/{generate,poll}`：扫码登录。
  这几个地址、参数和返回结构是 2026-11-24/25 实测记下来的，变更时按下面的“上游变了怎么跟”复核。
- **版本**：唯一的 npm 依赖是 `qrcode@1.5.4`（把登录二维码转成 data URL，`main/index.ts` 静态 import）。本目录的 `package.json` 和根目录 `package.json` 两处都钉死，升级时一起改。
- **桌面端怎么用**：`main/index.ts` 是主进程入口，所有请求都在这里发出（cookie 不出主进程，页面只看得到 opaque 句柄），经 `api.rpc.handle('request')` 交给 `client/`。登录会话存 `bilibili_session`（`api.seal` 加密），收藏夹封面缓存存 `bilibili_covers`；两把键在受信表 `electron/modSystem/builtinSources.cjs` 的 `bilibili` 一行里认领。
- **音频地址要过主进程**：upos 系 CDN 不带 `Referer` 会 403（2026-11-25 实测），`mcdn` 节点不会。所以 `x/player/playurl` 的答案里除 mcdn 之外的地址会在主进程登记一个 sha1 短 token，页面拿到的 `proxyPath` 指向 `api.media.serve('audio')` 的 `folia-mod://bilibili/_media/audio/<token>/…`，由主进程带上 `Referer` 再取，206 和 `Content-Range` 原样透传（拖进度条靠它）。
- **网页版怎么用**：`core/bilibiliApi.ts` 的 `createRequest` 看 `env.web.apiBase` 选 transport：有它就经部署好的后端（`VITE_BILIBILI_API_BASE`），没有就走主进程 rpc。网页入口（在 `web/` 下用同一个 `createSource` 注册的那一层）还没写：`api.bilibili.com` 带 `Origin` 会 403，跨域也读不到 `Set-Cookie`，所以网页版不能直连。
- **能力**：扫码登录、账号的收藏夹当歌单（分页按平台 40 条一页对齐，失效条目留空位、跳过它们继续往后取）、收藏夹封面（列表接口的 `cover` 是空的，真实封面在该收藏夹第一页的 `data.info.cover`）、视频音轨播放、CC 字幕当歌词、收藏夹筛选（登录窗里的勾选清单：只显示勾选的、只给勾选的取封面）。
- **歌词**：`lyrics: 'own'` —— 只用自己的 CC 字幕，**关掉了跨源匹配**，所以没有 CC 字幕的视频就是没有歌词。
- **上游变了怎么跟**：
  - 先跑 `npm run test:unit -- test/unit/bilibili`，它固定了收藏夹分页、规范化和标题清洗的形状（夹具在 `test/manual/bilibili-fixtures/`）；
  - 接口失效时用 curl 直接打上面列的地址复核参数（`fnval`、`ps`、是否需要 `wbi` 签名），改 `core/bilibiliApi.ts` 的操作表；
  - 音频改协议（例如新 CDN 不再 403）时，`needsProxy` 与 `main/index.ts` 里 token 的登记跟着改，别只改一边。
- **已知情况**：
  - 收藏夹列表接口不带封面、也不带“哪些条目失效”，两项都要靠 `resource/list` 的逐页答案（`data.info.cover`、每个 media 的 `attr`）；
  - 收藏夹的 `media_count` 会把失效条目算进去，所以歌单页签上的总数可能比能播的多几条；
  - 勾选的收藏夹 id 存在模组自己的设置项里（`settings:bilibili:bilibili-folders`），随视觉配置的导入导出一起走：导入别人的配置会带进对方的 `fav:*`，读不到就只是那几个收藏夹不显示。

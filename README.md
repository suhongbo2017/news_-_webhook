# 热点雷达 Hot Radar

把微博、百度、头条、抖音、知乎的热榜做跨平台聚合：**只有一个事件在多个平台同时上榜，才算全网热点**。每天 60 秒新闻作为定场内容放在侧栏。

数据源为 [60s-API](https://github.com/vikiboss/60s) 的公共实例 `https://news.ucac.edu.kg`（该实例允许跨域，浏览器可直连）。

## 为什么不是又一个热榜页

单平台热榜到处都是，缺的是「共识」这一层：同一件事在几个平台同时出现、各自排第几、在榜多久。本项目就做这一层。

- 聚类：标题归一化（去标点/全角、中文数字转阿拉伯数字）→ 字符 trigram 命中率，要求 **命中率 ≥ 0.5 且长度比 ≥ 0.55**。长度比闸门是必需的，否则「微博视界大会座位」会被并进「…微博视界大会同台领奖」。
- 只在**不同平台**之间连边。同平台两条热搜彼此无关，连边只会制造假合并。
- 热度：榜内 `log(1+hot)` min-max 归一化（无热度值的榜单退化为排名分）× 平台权重，再乘 `1 + 0.12 × (平台数 - 1)` 的共识加成，最后按当前最大值缩放成 0–100。
- 时间线：每次快照把当前簇与上一轮的故事做相似度匹配，保留 `firstSeen` / 峰值 / 曲线；断档超过 90 分钟视为重新上榜，重置起点。

实测：微博/百度/头条/抖音/知乎各取 50 条，能稳定聚出 9–12 个跨平台事件，误合并基本为零。

## 运行

```bash
npm install
npm run snapshot   # 抓一次上游，生成 public/data/latest.json
npm run dev        # http://localhost:5173
npm run build      # 产物在 dist/
```

页面上的「实时刷新」按钮在浏览器里直接请求上游并用同一套聚类逻辑重算，不需要后端；刷新时间线与历史则要靠定时快照。

## 目录

```
src/lib/radar.js        纯函数核心：归一化、相似度、聚类、热度、时间线（Node 与浏览器共用）
scripts/snapshot.mjs    定时任务：抓取 → 聚类 → 写 public/data/latest.json
src/lib/live.ts         浏览器端实时抓取
src/components/         共识榜 / 平台热榜 / 60 秒日报
public/data/latest.json 当前快照 + 近 48 小时故事时间线（由 Actions 提交）
.github/workflows/      每 30 分钟快照并部署 Pages
```

## 自动化

`.github/workflows/refresh.yml` 每 30 分钟执行一次：抓取 → 提交 `public/data/latest.json` → 构建 → 部署 GitHub Pages。

启用方式：仓库 Settings → Pages → Source 选 **GitHub Actions**；Settings → Actions → General → Workflow permissions 选 **Read and write**。

## Webhook 推送

部署后可以把「新出现的跨平台热点」推到群里。推送发生在 GitHub Actions 里（服务端），浏览器端永远不接触 webhook URL——那是凭据，且多数服务端 webhook 不允许跨域。

1. Settings → Secrets and variables → Actions → New repository secret：`WEBHOOK_URL`。
2. （可选）同页 Variables 配置下表里的调参项。
3. Actions → refresh → Run workflow 验证。

按域名自动选格式：`oapi.dingtalk.com` → 钉钉 markdown，`open.feishu.cn` / `larksuite.com` → 飞书 text，`qyapi.weixin.qq.com` → 企业微信 markdown，`discord.com` → Discord，`hooks.slack.com` → Slack，其余通用 JSON `{ text, markdown, clusters }`。

### 推送节奏（北京时间）

| 时间 | 行为 |
|---|---|
| 08:00 | 推 0 点至今的新事件（含昨晚 22:00 之后的积压） |
| 09:00–22:00 | 每小时推一次期间新出现的事件 |
| 22:00 之后 | 不推送，攒到次日 08:00 一起发 |

当天第一次推送会在末尾附上**当日 60 秒日报**（15 条摘要 + 一句 tip + 原文链接）。以 `digest.date === 今天` 为准：如果 08:00 时上游还没更新到当天，就顺延到下一次推送补上，当天只发一次；即使那段时间没有新热点，也会单独发一条日报。

不是靠精确 cron，而是「窗口 + 最小间隔」：快照仍每 30 分钟跑一次，推送闸门检查当前小时是否落在窗口内、距上次推送是否已过 `PUSH_MIN_GAP` 分钟。Actions 的定时任务经常延迟几分钟甚至丢跑，这样即使 08:00 那次跑到 08:12 也无影响，丢跑的那轮由下一次补上。

### 去重与排队

- 同一故事 id 不重复推；事件掉榜后重新上榜会拿到新 id，再用 **24 小时内标题相似度**兜住，不会二次推送。
- 去重状态在 `state/notified.json`，随快照一起提交，跨机器重启保留（id 记 7 天、标题记 48 小时）。
- 单条最多推 `WEBHOOK_MAX_ITEMS`（默认 8）条，超出的**留在队列**下一小时继续发，不会丢。
- 首次部署静默记账，不刷屏；想立刻推一次，手动触发时带 `WEBHOOK_BOOTSTRAP=1`。
- 发送失败只打日志、不记账，下一轮重试，不影响快照与部署。

| 变量 | 默认 | 说明 |
|---|---|---|
| `WEBHOOK_URL` | — | 机器人地址（Secret） |
| `WEBHOOK_MIN_HEAT` | 60 | 热度门槛，低于此值只上站不推送 |
| `WEBHOOK_MAX_ITEMS` | 10 | 单条消息最多几条事件 |
| `PUSH_TZ` | `Asia/Shanghai` | 计算「几点」用的时区 |
| `PUSH_START_HOUR` | 8 | 推送窗口起点 |
| `PUSH_END_HOUR` | 22 | 推送窗口终点 |
| `PUSH_MIN_GAP` | 55 | 两次推送的最小间隔（分钟） |

## 健壮性## 健壮性

- 任一榜单失败不会阻塞整体：该榜单沿用上一份快照并标记 `stale`，页面顶部会点出异常源。
- 60 秒日报失败时沿用上次内容。
- 上游公告过公共实例可能停服/限流。自建时把 `API_BASE`（定时任务）和 `VITE_API_BASE`（前端）指向自己的实例即可，无需改代码。

## 限制

- 只对中文标题做聚类；IT 之家、Hacker News 作为独立榜单展示，不参与共识计算。
- 上游只提供标题与链接，站内不聚合正文，所有条目一律跳转原始页面。
- 热度是相对值，不是绝对热度，跨平台比较仅有排序意义。

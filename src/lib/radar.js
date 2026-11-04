/**
 * 热点雷达 · 纯函数核心
 *
 * 同时被两处使用：Node 定时任务（scripts/snapshot.mjs）与浏览器端实时刷新。
 * 约束：不得引入 DOM / fetch / Node API，也不得依赖第三方包。
 */

/** 参与跨平台共识计算的热榜。weight 影响热度合成权重。 */
export const BOARDS = [
  { id: 'weibo', label: '微博', endpoint: '/v2/weibo', weight: 1 },
  { id: 'baidu', label: '百度', endpoint: '/v2/baidu/hot', weight: 1 },
  { id: 'toutiao', label: '头条', endpoint: '/v2/toutiao', weight: 0.95 },
  { id: 'douyin', label: '抖音', endpoint: '/v2/douyin', weight: 0.9 },
  { id: 'zhihu', label: '知乎', endpoint: '/v2/zhihu', weight: 0.85 },
];

/** 只做单榜展示、不参与聚类的信息流。 */
export const FEEDS = [
  { id: 'it-news', label: 'IT 之家', endpoint: '/v2/it-news', weight: 0.6 },
  { id: 'hacker-news', label: 'Hacker News', endpoint: '/v2/hacker-news/top', weight: 0.5 },
];

export const ALL_BOARDS = [...BOARDS, ...FEEDS];

/** 简介只做悬浮提示，截断可省掉近一半快照体积（快照每 30 分钟提交一次）。 */
const brief = (text) => (typeof text === 'string' ? text.slice(0, 120) : null);

/** 各端点的字段差异集中在这里，新增榜单只需补一个 mapper。 */
const MAPPERS = {
  weibo: (it) => ({ title: it.title, hot: parseHot(it.hot_value), url: it.link }),
  baidu: (it) => ({ title: it.title, hot: parseHot(it.score), url: it.url, desc: brief(it.desc) }),
  toutiao: (it) => ({ title: it.title, hot: parseHot(it.hot_value), url: it.link }),
  douyin: (it) => ({ title: it.title, hot: parseHot(it.hot_value), url: it.link }),
  zhihu: (it) => ({ title: it.title, hot: parseHot(it.hot_value_desc), url: it.link, desc: brief(it.detail) }),
  'it-news': (it) => ({ title: it.title, hot: null, url: it.link, desc: it.description }),
  'hacker-news': (it) => ({ title: it.title, hot: parseHot(it.score), url: it.link }),
};

/** "609 万热度" / "7809622" / 12345 → 数值 */
export function parseHot(value) {
  if (value === null || value === undefined || value === '') return null;
  const direct = Number(value);
  if (Number.isFinite(direct)) return direct;
  const m = String(value).trim().match(/^([\d.]+)\s*(亿|万|w|k)?/i);
  if (!m) return null;
  const base = Number.parseFloat(m[1]);
  if (!Number.isFinite(base)) return null;
  const unit = (m[2] || '').toLowerCase();
  if (unit === '亿') return base * 1e8;
  if (unit === '万' || unit === 'w') return base * 1e4;
  if (unit === 'k') return base * 1e3;
  return base;
}

const CN_DIGIT = { 两: '2', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9', 十: '10' };
const CN_UNITS = '名位人个辆架岁天年月次万亿元条起部场只家所台件';

/** 归一化：去标点/空白、统一全角、中文数字度量词转阿拉伯数字。 */
export function normalizeTitle(title) {
  if (!title) return '';
  let s = String(title)
    .replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[^\p{Script=Han}\p{L}\p{N}]/gu, '')
    .toLowerCase();
  s = s.replace(/([两二三四五六七八九十])(?=[名位人个辆架岁天年月次万亿元条起部场只家所台件])/g, (_, c) => CN_DIGIT[c]);
  return s;
}

function trigrams(s) {
  const set = new Set();
  for (let i = 0; i + 3 <= s.length; i++) set.add(s.slice(i, i + 3));
  return set;
}

/** 最长公共子序列占比：容忍「无锡队夺得苏超冠军」/「无锡队苏超夺冠」这类语序改写。 */
function lcsRatio(a, b) {
  if (a.length * b.length > 3600) return 0;
  const prev = new Uint16Array(b.length + 1);
  const cur = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev.set(cur);
    cur.fill(0);
  }
  return prev[b.length] / Math.min(a.length, b.length);
}

/**
 * 标题相似度，两条通路：
 * 1. 字 trigram 命中率 ≥ 0.5 —— 覆盖「同题不同措辞」；
 * 2. 字袋重合 ≥ 0.8 且 LCS 占比 ≥ 0.7 —— 覆盖「同词不同语序」。
 * 两条都要求长度比 ≥ 0.55：否则「微博视界大会座位」会被并进「…微博视界大会同台领奖」这类长标题。
 */
export function similarity(a, b) {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (x.length < 4 || y.length < 4) return x === y ? 1 : 0;
  const ratio = Math.min(x.length, y.length) / Math.max(x.length, y.length);
  if (ratio < 0.55) return 0;

  const A = trigrams(x);
  const B = trigrams(y);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  const triScore = shared / Math.min(A.size, B.size);
  if (triScore >= 0.5) return triScore;

  const bagA = new Set(x);
  const bagB = new Set(y);
  let common = 0;
  for (const c of bagA) if (bagB.has(c)) common++;
  const bagScore = common / Math.min(bagA.size, bagB.size);
  if (bagScore < 0.8) return triScore;
  return lcsRatio(x, y) >= 0.7 ? bagScore : triScore;
}

export const CLUSTER_THRESHOLD = 0.5;

/** 平台内归一化 0..1：有热度值用对数 min-max，无热度值退化为排名分。 */
function scoreItems(items) {
  const hots = items.map((it) => it.hot).filter((h) => typeof h === 'number' && h > 0);
  const useHot = hots.length >= Math.max(3, items.length * 0.6);
  const logs = useHot ? hots.map((h) => Math.log1p(h)) : [];
  const min = useHot ? Math.min(...logs) : 0;
  const max = useHot ? Math.max(...logs) : 0;
  const span = max - min || 1;
  const total = items.length;
  for (const it of items) {
    if (useHot && typeof it.hot === 'number' && it.hot > 0) {
      it.score = (Math.log1p(it.hot) - min) / span;
    } else {
      it.score = 1 - (it.rank - 1) / Math.max(1, total);
    }
  }
}

function unionFind(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  return {
    find,
    union(a, b) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    },
  };
}

/**
 * 跨平台聚类。只在不同平台之间连边：同平台内部的热搜彼此无关，
 * 连边会制造虚假合并。
 */
export function clusterStories(items) {
  const uf = unionFind(items.length);
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (items[i].source === items[j].source) continue;
      if (similarity(items[i].title, items[j].title) >= CLUSTER_THRESHOLD) uf.union(i, j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < items.length; i++) {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(items[i]);
  }
  const clusters = [];
  for (const members of groups.values()) {
    const platforms = new Set(members.map((m) => m.source));
    if (platforms.size < 2) continue;
    // 代表标题取该簇内得分最高者，避免摘要把标题越拼越长。
    const lead = members.reduce((a, b) => (b.score > a.score ? b : a));
    let raw = 0;
    for (const m of members) raw = Math.max(raw, m.score * m.boardWeight);
    raw *= 1 + 0.12 * (platforms.size - 1);
    clusters.push({
      title: lead.title,
      members: members.sort((a, b) => b.score - a.score),
      platforms: platforms.size,
      raw,
    });
  }
  const top = clusters.reduce((m, c) => Math.max(m, c.raw), 0) || 1;
  for (const c of clusters) c.heat = Math.round((c.raw / top) * 1000) / 10;
  return clusters.sort((a, b) => b.heat - a.heat);
}

/** FNV-1a → base36，用于生成同轮次内唯一的故事 id。 */
function hash36(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * 维护故事时间线：同一事件在连续快照间保持同一 id，
 * 用于「在榜时长 / 峰值 / 曲线」。
 */
export function mergeHistory(clusters, previousStories, now) {
  const stories = (previousStories || []).filter((s) => now - s.lastSeen < 7 * 864e5);
  const used = new Set();
  for (const cluster of clusters) {
    let best = null;
    let bestSim = 0;
    for (const s of stories) {
      if (used.has(s.id) || now - s.lastSeen > 6 * 3600e3) continue;
      const sim = similarity(cluster.title, s.title);
      if (sim >= CLUSTER_THRESHOLD && sim > bestSim) {
        bestSim = sim;
        best = s;
      }
    }
    if (best) {
      used.add(best.id);
      // 断档超过 90 分钟视为重新上榜，重置起始时间。
      if (now - best.lastSeen > 90 * 60e3) best.firstSeen = now;
      best.lastSeen = now;
      best.title = cluster.title;
      best.peak = Math.max(best.peak, cluster.heat);
      best.platforms = Math.max(best.platforms, cluster.platforms);
      best.series.push([now, cluster.heat, cluster.platforms]);
      if (best.series.length > 96) best.series = best.series.slice(-96);
      cluster.id = best.id;
    } else {
      const story = {
        id: `${now.toString(36)}-${hash36(normalizeTitle(cluster.title))}`,
        title: cluster.title,
        firstSeen: now,
        lastSeen: now,
        peak: cluster.heat,
        platforms: cluster.platforms,
        series: [[now, cluster.heat, cluster.platforms]],
      };
      stories.push(story);
      used.add(story.id);
      cluster.id = story.id;
    }
    cluster.stats = { firstSeen: best ? best.firstSeen : now, peak: best ? best.peak : cluster.heat };
  }
  return stories;
}

/**
 * 原始端点数据 → 可发布的快照。
 * @param {{
 *   digestRaw?: any,
 *   boards: Array<{ id: string, raw?: any[], error?: string }>,
 *   previous?: any,
 *   now?: number,
 * }} input
 */
export function buildSnapshot({ digestRaw, boards, previous, now = Date.now() }) {
  const prevBoards = new Map(((previous && previous.boards) || []).map((b) => [b.id, b]));
  const outBoards = [];
  const allItems = [];

  for (const config of ALL_BOARDS) {
    const isFeed = FEEDS.some((f) => f.id === config.id);
    const incoming = boards.find((b) => b.id === config.id) || {};
    const prev = prevBoards.get(config.id);
    const map = MAPPERS[config.id];
    let items = [];
    let error = incoming.error || null;
    let stale = false;

    if (Array.isArray(incoming.raw)) {
      items = incoming.raw
        .map((it, index) => {
          const mapped = map(it) || {};
          if (!mapped.title) return null;
          return {
            source: config.id,
            rank: index + 1,
            title: mapped.title,
            hot: mapped.hot ?? null,
            url: mapped.url || null,
            desc: mapped.desc || null,
          };
        })
        .filter(Boolean);
    }
    if (!items.length && prev && prev.items && prev.items.length) {
      items = prev.items;
      stale = true;
      error = error || '上游返回空，沿用上次快照';
    }
    scoreItems(items);
    for (const it of items) it.boardWeight = config.weight;
    outBoards.push({
      id: config.id,
      label: config.label,
      weight: config.weight,
      tier: isFeed ? 'feed' : 'hot',
      ok: !error && !stale,
      stale,
      error,
      count: items.length,
      items,
    });
    if (items.length && !FEEDS.some((f) => f.id === config.id)) allItems.push(...items);
  }

  const clusters = clusterStories(allItems);
  const stories = mergeHistory(clusters, previous && previous.stories, now)
    .filter((s) => now - s.lastSeen <= 48 * 3600e3)
    .map((s) => ({
      id: s.id,
      title: s.title,
      firstSeen: s.firstSeen,
      lastSeen: s.lastSeen,
      peak: s.peak,
      platforms: s.platforms,
      series: s.series.slice(-48).map(([t, heat]) => [t, heat]),
    }));
  const storyById = new Map(stories.map((s) => [s.id, s]));

  const digest = digestRaw
    ? {
        date: digestRaw.date,
        news: Array.isArray(digestRaw.news) ? digestRaw.news : [],
        tip: digestRaw.tip || null,
        cover: digestRaw.cover || digestRaw.image || null,
        link: digestRaw.link || null,
      }
    : previous && previous.digest
      ? { ...previous.digest, stale: true }
      : null;

  return {
    capturedAt: now,
    digest,
    boards: outBoards,
    clusters: clusters.map((c) => ({
      id: c.id,
      title: c.title,
      heat: c.heat,
      platforms: c.platforms,
      firstSeen: c.stats.firstSeen,
      peak: c.stats.peak,
      series: storyById.get(c.id)?.series || [],
      members: c.members.map((m) => ({
        source: m.source,
        rank: m.rank,
        hot: m.hot,
        title: m.title,
        url: m.url,
      })),
    })),
    stories,
  };
}

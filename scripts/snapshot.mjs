#!/usr/bin/env node
/**
 * 定时快照任务：抓取 60s-API → 归一化 → 跨平台聚类 → 写 data/latest.json
 *
 * 设计要点：
 * - 上游任一榜单失败不阻塞整体，失败榜单自动沿用上一份快照的数据（stale 标记）。
 * - 输出同时包含当前快照与近 48 小时的故事时间线，供前端画曲线、算在榜时长。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_BOARDS, buildSnapshot } from '../src/lib/radar.js';
import {
  buildMessage,
  localDate,
  detectProvider,
  pushGate,
  sendWebhook,
  toPayload,
  wasNotified,
} from './notify.mjs';

const BASE = process.env.API_BASE || 'https://news.ucac.edu.kg';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/latest.json');
/** 空字符串（Actions 里未配置的 vars）必须回落到默认值，不能变成 0。 */
const envNum = (value, fallback) => (value === undefined || value === '' ? fallback : Number(value));
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 hot-radar/1.0';

async function getJSON(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (body.code && body.code !== 200) throw new Error(body.message || `code ${body.code}`);
  return body.data;
}

async function readPrevious() {
  try {
    return JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    return null;
  }
}

const previous = await readPrevious();

const boards = await Promise.all(
  ALL_BOARDS.map(async ({ id, endpoint }) => {
    try {
      const data = await getJSON(endpoint);
      const raw = Array.isArray(data) ? data : Array.isArray(data?.list) ? data.list : [];
      if (!raw.length) return { id, error: '上游返回空数据' };
      return { id, raw };
    } catch (err) {
      return { id, error: err.message };
    }
  }),
);

let digestRaw = null;
let digestError = null;
try {
  digestRaw = await getJSON('/v2/60s');
} catch (err) {
  digestError = err.message;
}

const snapshot = buildSnapshot({ digestRaw, boards, previous, now: Date.now() });
if (digestError) snapshot.digestError = digestError;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(snapshot)}\n`);

// ---- webhook：8–22 点整点推送，只发本轮之前没发过的热点 ----
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const STATE = resolve(dirname(fileURLToPath(import.meta.url)), '../state/notified.json');
const now = snapshot.capturedAt;

if (WEBHOOK_URL) {
  const minHeat = envNum(process.env.WEBHOOK_MIN_HEAT, 60);
  const maxItems = envNum(process.env.WEBHOOK_MAX_ITEMS, 10);
  const gateOpts = {
    now,
    timeZone: process.env.PUSH_TZ || 'Asia/Shanghai',
    startHour: envNum(process.env.PUSH_START_HOUR, 8),
    endHour: envNum(process.env.PUSH_END_HOUR, 22),
    minGapMinutes: envNum(process.env.PUSH_MIN_GAP, 55),
  };
  const bootstrap = process.env.WEBHOOK_BOOTSTRAP === '1';

  let stored = null;
  try {
    stored = JSON.parse(await readFile(STATE, 'utf8'));
  } catch {
    stored = null;
  }
  const state = { ids: {}, titles: [], lastPushAt: 0, ...(stored ?? {}) };
  for (const [id, ts] of Object.entries(state.ids)) if (now - ts > 7 * 864e5) delete state.ids[id];
  state.titles = state.titles.filter((t) => now - t.ts < 48 * 3600e3);

  const fresh = snapshot.clusters
    .filter((c) => c.heat >= minHeat && !wasNotified(c, state, now))
    .sort((a, b) => b.heat - a.heat);

  const today = localDate(now, gateOpts.timeZone);
  const digestPending = Boolean(
    snapshot.digest?.news?.length &&
      snapshot.digest.date === today &&
      state.digestSentFor !== today,
  );

  const mark = (clusters) => {
    for (const c of clusters) {
      state.ids[c.id] = now;
      state.titles.push({ t: c.title, ts: now });
    }
  };

  if (!stored && !bootstrap) {
    // 首次部署静默记账，否则会把当时整屏热点一次性刷进群。
    mark(fresh);
    state.lastPushAt = now;
    console.log(`  · webhook: 首次运行，${fresh.length} 个既有热点不推送`);
  } else {
    const gate = pushGate({ lastPushAt: state.lastPushAt, ...gateOpts });
    const picked = fresh.slice(0, maxItems);
    if (!gate.ok) {
      if (fresh.length) console.log(`  · webhook: ${gate.reason}；${fresh.length} 个新热点排队等待`);
    } else if (!picked.length && !digestPending) {
      console.log('  · webhook: 无新增热点，今日日报也已推送');
    } else {
      const message = buildMessage({
        clusters: picked,
        digest: digestPending ? snapshot.digest : null,
        labels: Object.fromEntries(snapshot.boards.map((b) => [b.id, b.label])),
        capturedAt: now,
        extraCount: fresh.length - picked.length,
        since: state.lastPushAt || null,
        timeZone: gateOpts.timeZone,
      });
      if (await sendWebhook(WEBHOOK_URL, toPayload(detectProvider(WEBHOOK_URL), message))) {
        mark(picked);
        if (digestPending) state.digestSentFor = today;
        state.lastPushAt = now;
        const what = [
          picked.length ? `${picked.length} 个新热点` : null,
          digestPending ? '今日 60 秒' : null,
        ]
          .filter(Boolean)
          .join(' + ');
        console.log(`  ✓ webhook: 推送 ${what}（排队 ${fresh.length - picked.length}）`);
      }
    }
  }

  await mkdir(dirname(STATE), { recursive: true });
  await writeFile(STATE, `${JSON.stringify(state, null, 2)}\n`);
}

const bad = snapshot.boards.filter((b) => !b.ok);
console.log(
  `[${new Date(snapshot.capturedAt).toISOString()}] 共识事件 ${snapshot.clusters.length} 个 · ` +
    `榜单 ${snapshot.boards.length} 个（异常 ${bad.length}）· 时间线 ${snapshot.stories.length} 条 · ` +
    `${(JSON.stringify(snapshot).length / 1024).toFixed(0)}KB`,
);
for (const b of bad) console.log(`  ! ${b.label}: ${b.error}${b.stale ? '（沿用旧快照）' : ''}`);
if (digestError) console.log(`  ! 60 秒日报: ${digestError}`);

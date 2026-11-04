/**
 * Webhook 推送：把「新出现的跨平台热点」发到钉钉/飞书/企业微信/Discord/Slack/任意 HTTP 端点。
 *
 * 只在服务端（GitHub Actions / 本地脚本）运行：webhook URL 是凭据，
 * 一旦进浏览器就会被任何人读走，且多数服务端 webhook 不允许跨域。
 */
import { CLUSTER_THRESHOLD, similarity } from '../src/lib/radar.js';

/** 按域名识别目标平台，识别不了就当通用 JSON 端点。 */
export function detectProvider(url) {
  const host = new URL(url).hostname;
  if (host.endsWith('dingtalk.com')) return 'dingtalk';
  if (host.endsWith('feishu.cn') || host.endsWith('larksuite.com')) return 'feishu';
  if (host.endsWith('weixin.qq.com')) return 'wecom';
  if (host.endsWith('discord.com') || host.endsWith('discordapp.com')) return 'discord';
  if (host.endsWith('slack.com')) return 'slack';
  return 'generic';
}

const PROVIDER_LABEL = {
  dingtalk: '钉钉',
  feishu: '飞书',
  wecom: '企业微信',
  discord: 'Discord',
  slack: 'Slack',
  generic: '通用',
};

/** 平台角标：微博#1 · 抖音#2 */
function memberLine(cluster, labels) {
  return cluster.members
    .map((m) => `${labels[m.source] ?? m.source} #${m.rank}`)
    .join(' · ');
}

/**
 * 组装消息。clusters 可以为空（只有日报），digest 可以为空（只有热点）。
 * 同一份内容出两个版本：markdown 给钉钉/企业微信，纯文本给其余平台。
 */
export function buildMessage({
  clusters = [],
  digest = null,
  labels = {},
  capturedAt,
  extraCount = 0,
  since = null,
  timeZone = 'Asia/Shanghai',
}) {
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const stamp = since
    ? `覆盖 ${fmt.format(since)} → ${fmt.format(capturedAt)}`
    : `快照 ${fmt.format(capturedAt)}`;

  const parts = [];
  if (clusters.length) {
    parts.push(`🔥 全网共识 · ${clusters.length} 个新热点`);
    for (const [i, c] of clusters.entries()) {
      const lead = c.members[0];
      const mdTitle = lead?.url ? `[${c.title}](${lead.url})` : c.title;
      parts.push(
        `md:${i + 1}. **${mdTitle}**\n   ${c.platforms} 平台 · 热度 ${c.heat.toFixed(1)} · ${memberLine(c, labels)}`,
        `raw:${i + 1}. ${c.title}\n   ${c.platforms} 平台 · 热度 ${c.heat.toFixed(1)}\n   ${memberLine(c, labels)}\n   ${lead?.url ?? ''}`,
      );
    }
    if (extraCount > 0) {
      parts.push(`另有 ${extraCount} 个新热点超出单条上限，下一轮继续推送。`);
    }
  }

  if (digest && digest.news?.length) {
    parts.push(`📰 今日 60 秒 · ${digest.date}`);
    digest.news.forEach((line, i) => parts.push(`${i + 1}. ${line}`));
    if (digest.tip) parts.push(`💬 ${digest.tip}`);
    if (digest.link) parts.push(`原文 ${digest.link}`);
  }

  const mdLines = [];
  const rawLines = [];
  for (const part of parts) {
    if (part.startsWith('md:')) mdLines.push(part.slice(3));
    else if (part.startsWith('raw:')) rawLines.push(part.slice(4));
    else {
      mdLines.push(part);
      rawLines.push(part);
    }
  }

  const title = clusters.length
    ? `🔥 全网共识 · ${clusters.length} 个新热点`
    : `📰 今日 60 秒 · ${digest?.date ?? ''}`;

  return {
    title,
    markdown: `${mdLines.join('\n\n')}\n\n— ${stamp}`,
    plain: `${rawLines.join('\n\n')}\n\n— ${stamp}`,
    clusters: clusters.map((c) => ({
      title: c.title,
      heat: c.heat,
      platforms: c.platforms,
      url: c.members[0]?.url ?? null,
      members: c.members.map((m) => ({ source: m.source, rank: m.rank })),
    })),
  };
}

export function toPayload(provider, message) {
  switch (provider) {
    case 'dingtalk':
      return { msgtype: 'markdown', markdown: { title: message.title, text: message.markdown } };
    case 'wecom':
      return { msgtype: 'markdown', markdown: { content: message.markdown } };
    case 'feishu':
      return { msg_type: 'text', content: { text: message.plain } };
    case 'discord':
      return { content: message.plain.slice(0, 1900) };
    case 'slack':
      return { text: message.plain };
    default:
      return {
        title: message.title,
        text: message.plain,
        markdown: message.markdown,
        clusters: message.clusters,
      };
  }
}

/** 返回 true 表示已送达；失败只记日志，绝不影响快照任务本身。 */
export async function sendWebhook(url, payload) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) {
      console.log(`  ! webhook HTTP ${res.status}: ${text.slice(0, 200)}`);
      return false;
    }
    // 钉钉/飞书失败时仍返回 200，错误码在响应体里。
    if (/"errcode"\s*:\s*[1-9]/.test(text) || /"code"\s*:\s*[1-9]\d*/.test(text)) {
      console.log(`  ! webhook 被拒绝: ${text.slice(0, 200)}`);
      return false;
    }
    console.log(`  ✓ webhook 已送达 ${PROVIDER_LABEL[detectProvider(url)] ?? ''}`.trim());
    return true;
  } catch (err) {
    console.log(`  ! webhook 发送失败: ${err.message}`);
    return false;
  }
}

/** 目标时区的小时（0–23），与 runner 的本地时区无关。 */
export function localHour(ts, timeZone = 'Asia/Shanghai') {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(ts),
  );
}

/** 目标时区的日期 YYYY-MM-DD，用于判断「今天的日报发过没有」。 */
export function localDate(ts, timeZone = 'Asia/Shanghai') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ts);
}

/**
 * 推送节奏闸门：只在 [startHour, endHour] 内推，且两次推送间隔不少于 minGapMinutes。
 * 用「窗口 + 最小间隔」而不是精确到分钟的 cron —— Actions 的定时任务本身会延迟甚至丢跑。
 */
export function pushGate({ now, lastPushAt, timeZone, startHour, endHour, minGapMinutes }) {
  const hour = localHour(now, timeZone);
  if (hour < startHour || hour > endHour) {
    return { ok: false, reason: `当前 ${hour} 点，不在 ${startHour}–${endHour} 点推送窗口` };
  }
  if (lastPushAt && now - lastPushAt < minGapMinutes * 60_000) {
    return { ok: false, reason: `距上次推送不足 ${minGapMinutes} 分钟` };
  }
  return { ok: true, reason: `${hour} 点窗口` };
}

/**
 * 是否已经推送过：先比故事 id（跨快照稳定），再用标题相似度兜住
 * 「事件掉榜后重新上榜拿到新 id」的重复。
 */
export function wasNotified(cluster, state, now, dedupeWindowMs = 24 * 3600e3) {
  if (cluster.id in state.ids) return true;
  for (const entry of state.titles) {
    if (now - entry.ts > dedupeWindowMs) continue;
    if (similarity(cluster.title, entry.t) >= CLUSTER_THRESHOLD) return true;
  }
  return false;
}

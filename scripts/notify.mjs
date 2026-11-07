/**
 * Webhook 推送：把「新出现的跨平台热点」发到钉钉/飞书/企业微信/Discord/Slack/任意 HTTP 端点。
 *
 * 只在服务端（GitHub Actions / 本地脚本）运行：webhook URL 是凭据，
 * 一旦进浏览器就会被任何人读走，且多数服务端 webhook 不允许跨域。
 *
 * 消息先抽象成「段落」，再按目标平台渲染：链接一律用标题当锚文本，不暴露 URL。
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

/** 摘要截断：120 字够判断要不要点，又不至于让单条消息爆掉。 */
function trimSummary(text, cap) {
  if (!cap || !text) return null;
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

/**
 * 把内容拆成段落，供任何平台渲染。clusters 可以为空（只有日报），
 * digest 可以为空（只有热点）。
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
  const footer = `— ${since ? `覆盖 ${fmt.format(since)} → ${fmt.format(capturedAt)}` : `快照 ${fmt.format(capturedAt)}`}`;

  const sections = ({ summaryCap = 0, withClusters = true, withDigest = true }) => {
    const out = [];
    if (withClusters && clusters.length) {
      out.push({ kind: 'text', text: `🔥 全网共识 · ${clusters.length} 个新热点` });
      for (const [i, c] of clusters.entries()) {
        out.push({
          kind: 'cluster',
          index: i + 1,
          title: c.title,
          url: c.members[0]?.url ?? null,
          summary: trimSummary(c.summary, summaryCap),
          heat: c.heat,
          platforms: c.platforms,
          members: memberLine(c, labels),
        });
      }
      if (extraCount > 0) {
        out.push({ kind: 'text', text: `另有 ${extraCount} 个新热点超出单条上限，下一轮继续推送。` });
      }
    }

    if (withDigest && digest?.news?.length) {
      out.push({ kind: 'text', text: `📰 今日 60 秒 · ${digest.date}` });
      digest.news.forEach((line, i) => out.push({ kind: 'text', text: `${i + 1}. ${line}` }));
      if (digest.tip) out.push({ kind: 'text', text: `💬 ${digest.tip}` });
      if (digest.link) out.push({ kind: 'link', text: '阅读原文', url: digest.link });
    }
    return out;
  };

  return {
    title: clusters.length
      ? `🔥 全网共识 · ${clusters.length} 个新热点`
      : `📰 今日 60 秒 · ${digest?.date ?? ''}`,
    footer,
    tiers: {
      full: sections({ summaryCap: 120 }),
      lean: sections({ summaryCap: 0 }),
      clustersOnly: sections({ summaryCap: 120, withDigest: false }),
      digestOnly: sections({ summaryCap: 0, withClusters: false }),
    },
    clusters: clusters.map((c) => ({
      title: c.title,
      summary: c.summary ?? null,
      heat: c.heat,
      platforms: c.platforms,
      url: c.members[0]?.url ?? null,
      members: c.members.map((m) => ({ source: m.source, rank: m.rank })),
    })),
  };
}

/**
 * 故障/恢复告警，和内容推送走同一条 webhook，但不受推送窗口与去重状态影响。
 * 返回结构与 buildMessage 一致，可直接交给 toPayloads。
 */
export function buildAlertMessage({
  kind,
  bases = [],
  capturedAt,
  timeZone = 'Asia/Shanghai',
  siteUrl = null,
  lastGood = null,
}) {
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const down = kind === 'down';
  const sections = down
    ? [
        { kind: 'text', text: '⚠️ 数据源不可用' },
        { kind: 'text', text: `所有实例都失败了：${bases.join('、') || '未配置'}` },
        {
          kind: 'text',
          text: '站点继续显示最后一次成功的快照；热点推送暂停，恢复后自动补发。每天最多告警一次。',
        },
        ...(siteUrl ? [{ kind: 'link', text: '打开站点', url: siteUrl }] : []),
      ]
    : [
        { kind: 'text', text: '✅ 数据源已恢复' },
        {
          kind: 'text',
          text: lastGood
            ? `中断期间站点展示的是 ${fmt.format(lastGood)} 的快照，现已重新抓取。`
            : '已重新抓取数据。',
        },
        ...(siteUrl ? [{ kind: 'link', text: '打开站点', url: siteUrl }] : []),
      ];

  return {
    title: down ? '⚠️ 数据源不可用' : '✅ 数据源已恢复',
    footer: `— ${fmt.format(capturedAt)}`,
    tiers: { full: sections, lean: sections, clustersOnly: sections, digestOnly: sections },
    clusters: [],
  };
}

/** 各平台单条消息的硬上限；超出就换档或拆条，别让网关直接拒收。 */
const LIMITS = {
  dingtalk: { bytes: 18_000 },
  wecom: { bytes: 4_000 },
  feishu: { bytes: 30_000 },
  discord: { chars: 1_900 },
  slack: { chars: 39_000 },
};

const encoder = new TextEncoder();

const fits = (text, { chars, bytes }) =>
  (!chars || text.length <= chars) && (!bytes || encoder.encode(text).length <= bytes);

/** 实在放不下时二分出最长前缀，退到最近的换行处，并标明被截断。 */
function fit(text, limit) {
  if (fits(text, limit)) return text;

  const note = '\n\n…（已截断，完整内容见站点）';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(text.slice(0, mid) + note, limit)) lo = mid;
    else hi = mid - 1;
  }
  let head = text.slice(0, lo);
  const nl = head.lastIndexOf('\n');
  if (nl > lo * 0.6) head = head.slice(0, nl);
  return head.trimEnd() + note;
}

/** Slack 用 <url|title>，其余支持 markdown 的平台用 [title](url)。 */
function linkSyntax(provider) {
  return provider === 'slack'
    ? (text, url) => `<${url}|${text}>`
    : (text, url) => `[${text}](${url})`;
}

/** 纯文本渲染，同时用于长度测量。 */
function renderText(provider, message, sections) {
  const link = linkSyntax(provider);
  const blocks = sections.map((s) => {
    if (s.kind === 'cluster') {
      const head = `${s.index}. ${s.url ? link(s.title, s.url) : s.title}`;
      const lines = [head];
      if (s.summary) lines.push(`   ${s.summary}`);
      lines.push(`   ${s.platforms} 平台 · 热度 ${s.heat.toFixed(1)} · ${s.members}`);
      return lines.join('\n');
    }
    if (s.kind === 'link') return s.url ? link(s.text, s.url) : s.text;
    return s.text;
  });
  return `${blocks.join('\n\n')}\n\n${message.footer}`;
}

/** 飞书富文本卡片：标题本身是超链接，不出现裸 URL。 */
function feishuPost(message, sections) {
  const content = [];
  for (const s of sections) {
    if (s.kind === 'cluster') {
      content.push(
        s.url
          ? [
              { tag: 'text', text: `${s.index}. ` },
              { tag: 'a', text: s.title, href: s.url },
            ]
          : [{ tag: 'text', text: `${s.index}. ${s.title}` }],
      );
      if (s.summary) content.push([{ tag: 'text', text: `   ${s.summary}` }]);
      content.push([
        { tag: 'text', text: `   ${s.platforms} 平台 · 热度 ${s.heat.toFixed(1)} · ${s.members}` },
      ]);
    } else if (s.kind === 'link' && s.url) {
      content.push([{ tag: 'a', text: s.text, href: s.url }]);
    } else {
      content.push([{ tag: 'text', text: s.text }]);
    }
  }
  return {
    msg_type: 'post',
    content: {
      post: {
        zh_cn: { title: message.title, content },
      },
    },
  };
}

function asPayload(provider, message, sections) {
  switch (provider) {
    case 'dingtalk':
      return {
        msgtype: 'markdown',
        markdown: { title: message.title, text: renderText(provider, message, sections) },
      };
    case 'wecom':
      return {
        msgtype: 'markdown',
        markdown: { content: renderText(provider, message, sections) },
      };
    case 'feishu':
      return feishuPost(message, sections);
    case 'discord':
      return { content: renderText(provider, message, sections) };
    case 'slack':
      return { text: renderText(provider, message, sections) };
    default:
      return {
        title: message.title,
        text: renderText(provider, message, sections),
        markdown: renderText('dingtalk', message, sections),
        clusters: message.clusters,
      };
  }
}

/**
 * 按平台上限选档位。放得下就一条；放不下先去掉摘要；还放不下就拆成
 * 「热点」「日报」两条，保证 8 点那批的日报不会被截掉。
 */
export function toPayloads(provider, message) {
  const limit = LIMITS[provider];
  const tiers = [message.tiers.full, message.tiers.lean, message.tiers.clustersOnly].filter(
    (t) => t.length,
  );

  if (!limit) return [asPayload(provider, message, tiers[0])];

  for (const tier of tiers) {
    if (fits(renderText(provider, message, tier), limit)) {
      return [asPayload(provider, message, tier)];
    }
  }

  const parts = [message.tiers.clustersOnly, message.tiers.digestOnly].filter((t) => t.length);
  if (parts.length <= 1) {
    const only = parts[0] ?? message.tiers.lean;
    return [asPayload(provider, message, only)];
  }

  // 拆条时把每条压到上限内：飞书用结构化卡片，不做文本截断。
  return parts.map((tier) => {
    if (provider === 'feishu') return asPayload(provider, message, tier);
    const text = fit(renderText(provider, message, tier), limit);
    if (provider === 'dingtalk') {
      return { msgtype: 'markdown', markdown: { title: message.title, text } };
    }
    if (provider === 'wecom') return { msgtype: 'markdown', markdown: { content: text } };
    if (provider === 'discord') return { content: text };
    return { text };
  });
}

/** 返回 true 表示全部送达；失败只记日志，绝不影响快照任务本身。 */
export async function sendWebhook(url, payloads) {
  for (const payload of [].concat(payloads)) {
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
    } catch (err) {
      console.log(`  ! webhook 发送失败: ${err.message}`);
      return false;
    }
  }
  return true;
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

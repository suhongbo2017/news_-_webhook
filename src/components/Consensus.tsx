import { useEffect, useRef, useState } from 'react';
import type { Cluster } from '../types';
import { elapsed } from '../lib/format';

type Props = {
  clusters: Cluster[];
  labels: Record<string, string>;
};

function Sparkline({ points }: { points: [number, number][] }) {
  if (points.length < 2) return null;
  const width = 84;
  const height = 22;
  const heats = points.map((p) => p[1]);
  const min = Math.min(...heats);
  const max = Math.max(...heats);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - 2 - ((p[1] - min) / span) * (height - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** 摘要默认两行，确实溢出才给展开按钮（用实际测量而不是字数猜）。 */
function Summary({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (el) setOverflow(el.scrollHeight > el.clientHeight + 1);
  }, [text]);

  return (
    <>
      <p ref={ref} className={expanded ? 'story-summary expanded' : 'story-summary'}>
        {text}
      </p>
      {(overflow || expanded) && (
        <button
          type="button"
          className="story-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '收起' : '展开摘要'}
        </button>
      )}
    </>
  );
}

function StoryRow({ cluster, index, labels }: { cluster: Cluster; index: number; labels: Record<string, string> }) {
  const lead = cluster.members[0];
  return (
    <li className="story">
      <div className="story-rank">{String(index + 1).padStart(2, '0')}</div>
      <div className="story-body">
        <h3 className="story-title">
          {lead?.url ? (
            <a href={lead.url} target="_blank" rel="noreferrer noopener">
              {cluster.title}
            </a>
          ) : (
            cluster.title
          )}
        </h3>
        {cluster.summary && <Summary text={cluster.summary} />}
        <div className="story-chips">
          {cluster.members.map((m) => (
            <a
              className="chip"
              key={`${m.source}-${m.rank}`}
              href={m.url ?? undefined}
              target="_blank"
              rel="noreferrer noopener"
              title={m.title}
              data-source={m.source}
            >
              {labels[m.source] ?? m.source}
              <b>#{m.rank}</b>
            </a>
          ))}
        </div>
      </div>
      <div className="story-heat">
        <div className="heat-top">
          <span className="heat-num">{cluster.heat.toFixed(1)}</span>
          <Sparkline points={cluster.series} />
        </div>
        <div className="heat-bar">
          <i style={{ width: `${cluster.heat}%` }} />
        </div>
        <div className="heat-meta">
          <span>{cluster.platforms} 平台联榜</span>
          <span>在榜 {elapsed(cluster.firstSeen)}</span>
        </div>
      </div>
    </li>
  );
}

export function Consensus({ clusters, labels }: Props) {
  if (!clusters.length) {
    return <p className="empty">当前没有跨平台共同在榜的事件——各平台热搜此刻彼此独立。</p>;
  }
  return (
    <ol className="stories">
      {clusters.map((cluster, i) => (
        <StoryRow key={cluster.id} cluster={cluster} index={i} labels={labels} />
      ))}
    </ol>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Consensus } from './components/Consensus';
import { DigestCard } from './components/DigestCard';
import { Boards } from './components/Boards';
import { fetchLive } from './lib/live';
import { ago, clock } from './lib/format';
import type { Snapshot } from './types';

const SNAPSHOT_URL = `${import.meta.env.BASE_URL}data/latest.json`;

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(SNAPSHOT_URL, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`快照缺失（HTTP ${res.status}）`);
        return res.json() as Promise<Snapshot>;
      })
      .then((data) => {
        if (cancelled) return;
        setSnapshot(data);
        setTab(data.boards.find((b) => b.tier === 'hot')?.id ?? data.boards[0]?.id ?? '');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const next = await fetchLive(snapshot);
      setSnapshot(next);
      setLive(true);
      if (!next.boards.some((b) => b.id === tab && b.count)) setTab(next.boards[0]?.id ?? '');
    } catch (err) {
      setError(`实时抓取失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRefreshing(false);
    }
  }, [snapshot, tab]);

  const labels = useMemo(
    () => Object.fromEntries((snapshot?.boards ?? []).map((b) => [b.id, b.label])),
    [snapshot],
  );

  const consensus = useMemo(() => {
    const map = new Map<string, number>();
    for (const cluster of snapshot?.clusters ?? []) {
      for (const member of cluster.members) {
        map.set(`${member.source}|${member.title}`, cluster.platforms);
      }
    }
    return map;
  }, [snapshot]);

  const hotBoards = snapshot?.boards.filter((b) => b.tier === 'hot') ?? [];
  const broken = snapshot?.boards.filter((b) => !b.ok) ?? [];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="pulse" aria-hidden="true" />
          <h1>热点雷达</h1>
          <span className="brand-sub">跨平台共识</span>
        </div>
        <div className="topbar-meta">
          {snapshot && (
            <span className="stamp" title={new Date(snapshot.capturedAt).toLocaleString()}>
              {live ? '实时' : '快照'} {clock(snapshot.capturedAt)} · {ago(snapshot.capturedAt)}
            </span>
          )}
          <button type="button" className="refresh" onClick={refresh} disabled={refreshing || loading}>
            {refreshing ? '抓取中…' : '实时刷新'}
          </button>
        </div>
      </header>

      {error && <p className="banner error">{error}</p>}
      {loading && <p className="banner">正在载入快照…</p>}

      {snapshot && (
        <>
          <p className="lede">
            <b>{snapshot.clusters.length}</b> 个事件正在 <b>{hotBoards.length}</b> 个平台的热榜上同时出现；
            <span className="muted">由 {hotBoards.map((b) => b.label).join(' / ')} 聚合，每 30 分钟快照一次。</span>
            {broken.length > 0 && <span className="warn"> 异常榜单：{broken.map((b) => b.label).join('、')}</span>}
          </p>

          <div className="layout">
            <section className="consensus" aria-labelledby="consensus-title">
              <header className="section-head">
                <h2 id="consensus-title">全网共识</h2>
                <span className="hint">同一事件在多个平台同时在榜才算热点</span>
              </header>
              <Consensus clusters={snapshot.clusters} labels={labels} />
            </section>

            {snapshot.digest && <DigestCard digest={snapshot.digest} />}
          </div>

          <Boards boards={snapshot.boards} active={tab} onChange={setTab} consensus={consensus} />
        </>
      )}

      <footer className="foot">
        数据来自 <a href="https://github.com/vikiboss/60s" target="_blank" rel="noreferrer noopener">60s-API</a>
        公共实例 · 热度为各平台榜内归一化后的合成值，仅代表相对位置
      </footer>
    </div>
  );
}

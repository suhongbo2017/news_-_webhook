import type { Board } from '../types';
import { hotText } from '../lib/format';

type Props = {
  boards: Board[];
  active: string;
  onChange: (id: string) => void;
  /** `source|title` → 该事件同时在榜的平台数 */
  consensus: Map<string, number>;
};

export function Boards({ boards, active, onChange, consensus }: Props) {
  const board = boards.find((b) => b.id === active) ?? boards[0];
  if (!board) return null;

  return (
    <section className="boards" aria-labelledby="boards-title">
      <header className="boards-head">
        <h2 id="boards-title">平台热榜</h2>
        <nav className="tabs" role="tablist" aria-label="榜单切换">
          {boards.map((b) => (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={b.id === board.id}
              className={b.id === board.id ? 'tab active' : 'tab'}
              onClick={() => onChange(b.id)}
            >
              {b.label}
              <span>{b.count}</span>
              {!b.ok && <i className="tab-warn" title={b.error ?? '数据异常'} />}
            </button>
          ))}
        </nav>
      </header>

      {board.stale && (
        <p className="board-note">该榜单本次抓取失败，显示上次快照：{board.error}</p>
      )}

      <ol className="board-list">
        {board.items.map((item) => {
          const platforms = consensus.get(`${item.source}|${item.title}`) ?? 0;
          return (
            <li key={`${item.source}-${item.rank}`} className="board-row">
              <span className="board-rank">{String(item.rank).padStart(2, '0')}</span>
              <a
                className="board-title"
                href={item.url ?? undefined}
                target="_blank"
                rel="noreferrer noopener"
                title={item.desc ?? item.title}
              >
                {item.title}
              </a>
              {platforms > 1 && <span className="board-badge">{platforms} 平台</span>}
              <span className="board-hot">{hotText(item.hot)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

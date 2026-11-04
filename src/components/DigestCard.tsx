import type { Digest } from '../types';

export function DigestCard({ digest }: { digest: Digest }) {
  return (
    <section className="digest" aria-labelledby="digest-title">
      <header className="digest-head">
        <h2 id="digest-title">今日 60 秒</h2>
        <time>{digest.date}</time>
      </header>
      <ol className="digest-list">
        {digest.news.map((line, i) => (
          <li key={i}>
            <span>{line}</span>
          </li>
        ))}
      </ol>
      {digest.tip && <p className="digest-tip">{digest.tip}</p>}
      <footer className="digest-foot">
        {digest.stale && <span className="warn">上游未更新，显示上次内容</span>}
        {digest.link && (
          <a href={digest.link} target="_blank" rel="noreferrer noopener">
            阅读原文 ↗
          </a>
        )}
      </footer>
    </section>
  );
}

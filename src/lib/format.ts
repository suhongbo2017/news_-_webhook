/** 展示层格式化工具。 */

const pad = (n: number) => String(n).padStart(2, '0');

/** 17:05 */
export function clock(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 10-31 */
export function shortDate(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 2小时10分 / 35分钟 */
export function elapsed(from: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - from) / 60000));
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

/** 7809622 → 781万 */
export function hotText(hot: number | null): string {
  if (hot === null || !Number.isFinite(hot)) return '—';
  if (hot >= 1e8) return `${(hot / 1e8).toFixed(hot >= 1e9 ? 0 : 1)}亿`;
  if (hot >= 1e4) return `${Math.round(hot / 1e4)}万`;
  return String(Math.round(hot));
}

/** 相对时间：3 分钟前 */
export function ago(ts: number, now = Date.now()): string {
  const min = Math.round((now - ts) / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${shortDate(ts)} ${clock(ts)}`;
}

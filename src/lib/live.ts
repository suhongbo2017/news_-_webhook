/**
 * 浏览器端实时抓取：直接打上游（该 API 允许跨域），
 * 用与定时任务完全相同的聚类逻辑重算，保留已有时间线。
 */
import { ALL_BOARDS, buildSnapshot } from './radar.js';
import type { Snapshot } from '../types';

export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) || 'https://news.ucac.edu.kg';

const UA_HEADERS = { accept: 'application/json' };

async function getJSON<T = unknown>(path: string): Promise<T> {
  const res = await fetch(API_BASE + path, {
    headers: UA_HEADERS,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { code?: number; message?: string; data?: T };
  if (body.code && body.code !== 200) throw new Error(body.message || `code ${body.code}`);
  return body.data as T;
}

export async function fetchLive(previous: Snapshot | null): Promise<Snapshot> {
  const boards = await Promise.all(
    ALL_BOARDS.map(async ({ id, endpoint }: { id: string; endpoint: string }) => {
      try {
        const data = await getJSON<unknown[] | { list?: unknown[] }>(endpoint);
        const raw = Array.isArray(data) ? data : Array.isArray(data?.list) ? data.list : [];
        return raw.length ? { id, raw } : { id, error: '上游返回空数据' };
      } catch (err) {
        return { id, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  let digestRaw: unknown = null;
  try {
    digestRaw = await getJSON('/v2/60s');
  } catch {
    digestRaw = null;
  }

  return buildSnapshot({
    digestRaw,
    boards,
    previous: previous ?? undefined,
    now: Date.now(),
  }) as Snapshot;
}

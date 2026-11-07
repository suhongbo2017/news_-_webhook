export type BoardItem = {
  source: string;
  rank: number;
  title: string;
  hot: number | null;
  url: string | null;
  desc?: string | null;
  score?: number;
};

export type Board = {
  id: string;
  label: string;
  weight: number;
  tier: 'hot' | 'feed';
  ok: boolean;
  stale: boolean;
  error: string | null;
  count: number;
  items: BoardItem[];
};

export type ClusterMember = {
  source: string;
  rank: number;
  hot: number | null;
  title: string;
  url: string | null;
};

export type Cluster = {
  id: string;
  title: string;
  summary: string | null;
  heat: number;
  platforms: number;
  firstSeen: number;
  peak: number;
  series: [number, number][];
  members: ClusterMember[];
};

export type Digest = {
  date: string;
  news: string[];
  tip: string | null;
  cover: string | null;
  link: string | null;
  stale?: boolean;
};

export type Snapshot = {
  capturedAt: number;
  apiBase?: string | null;
  digest: Digest | null;
  digestError?: string;
  boards: Board[];
  clusters: Cluster[];
  stories: unknown[];
};

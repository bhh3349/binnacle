import type {
  DuResponse,
  FsListResponse,
  FsReadResponse,
  FsRoots,
  FsSearchResponse,
  HistoryResponse,
  LogsResponse,
  Meta,
  ServicesResponse,
  Snapshot,
} from './types';

const TOKEN_KEY = 'sc-token';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setToken(t: string): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 忽略存储失败 */
  }
}

let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(fn: () => void): void {
  unauthorizedHandler = fn;
}

function headers(extra?: Record<string, string>): HeadersInit {
  const h: Record<string, string> = { ...(extra ?? {}) };
  const tok = getToken();
  if (tok) h['X-Token'] = tok;
  return h;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: headers(init.headers as Record<string, string> | undefined),
  });
  if (res.status === 401) {
    unauthorizedHandler?.();
    throw new ApiError(401, '未认证，请重新登录');
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const msg =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return body as T;
}

function q(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const api = {
  login: (token: string) =>
    request<{ ok: boolean }>('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }),

  health: () => request<{ ok: boolean; time: number }>('/api/health'),

  meta: () => request<Meta>('/api/meta'),

  snapshot: () => request<Snapshot>('/api/snapshot'),

  history: (from: number, to: number, step: number) =>
    request<HistoryResponse>(`/api/history${q({ from, to, step })}`),

  /* ---- fs ---- */
  fsRoots: () => request<FsRoots>('/api/fs/roots'),

  fsList: (path: string, opts: { sort?: string; order?: string; hidden?: 0 | 1 } = {}) =>
    request<FsListResponse>(`/api/fs/list${q({ path, ...opts })}`),

  fsRead: (path: string) => request<FsReadResponse>(`/api/fs/read${q({ path })}`),

  fsWrite: (path: string, content: string) =>
    request<{ ok: boolean }>(`/api/fs/write${q({ path })}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }),

  fsMkdir: (path: string) =>
    request<{ ok: boolean }>('/api/fs/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }),

  fsRename: (from: string, to: string) =>
    request<{ ok: boolean }>('/api/fs/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    }),

  fsDelete: (paths: string[]) =>
    request<{ ok: boolean; errors: string[] | null }>('/api/fs/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
    }),

  fsCopy: (from: string, to: string) =>
    request<{ ok: boolean }>('/api/fs/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    }),

  fsChmod: (path: string, mode: string) =>
    request<{ ok: boolean }>('/api/fs/chmod', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, mode }),
    }),

  fsSearch: (kw: string, path: string, limit = 200) =>
    request<FsSearchResponse>(`/api/fs/search${q({ q: kw, path, limit })}`),

  fsDu: (path: string, depth = 1) => request<DuResponse>(`/api/fs/du${q({ path, depth })}`),

  fsUpload: async (path: string, file: File, onProgress?: (pct: number) => void) => {
    // 小文件一次 PUT 语义：整文件上传。大文件（>16MB）分块续传。
    const CHUNK = 8 * 1024 * 1024;
    if (file.size <= CHUNK) {
      const res = await fetch(`/api/fs/upload${q({ path })}`, {
        method: 'POST',
        credentials: 'include',
        headers: headers({ 'Content-Type': 'application/octet-stream' }),
        body: file,
      });
      if (!res.ok) throw new ApiError(res.status, await res.text());
      onProgress?.(100);
      return (await res.json()) as { ok: boolean; path: string; size: number };
    }
    let offset = 0;
    while (offset < file.size) {
      const end = Math.min(offset + CHUNK, file.size);
      const blob = file.slice(offset, end);
      const final = end >= file.size ? 1 : 0;
      const res = await fetch(`/api/fs/upload${q({ path })}`, {
        method: 'POST',
        credentials: 'include',
        headers: headers({
          'Content-Type': 'application/octet-stream',
          'Content-Range': `bytes ${offset}-${end - 1}/${file.size}`,
          'X-Upload-Final': String(final),
        }),
        body: blob,
      });
      if (!res.ok) throw new ApiError(res.status, await res.text());
      offset = end;
      onProgress?.(Math.round((offset / file.size) * 100));
    }
    return { ok: true, path, size: file.size };
  },

  downloadUrl: (path: string) => {
    const tok = getToken();
    return `/api/fs/download${q({ path, token: tok || undefined })}`;
  },

  thumbUrl: (path: string, w = 256) => {
    const tok = getToken();
    return `/api/fs/thumb${q({ path, w, token: tok || undefined })}`;
  },

  /* ---- services ---- */
  services: () => request<ServicesResponse>('/api/services'),

  serviceAction: (name: string, action: 'start' | 'stop' | 'restart' | 'reload') =>
    request<{ ok: boolean; pending?: boolean; output?: string }>(
      `/api/services/${encodeURIComponent(name)}/${action}`,
      { method: 'POST' },
    ),

  logs: (unit: string, lines = 200) =>
    request<LogsResponse>(`/api/logs/${encodeURIComponent(unit)}${q({ lines })}`),
};

/** WS 地址：带上 token，因为 WS 握手不走 fetch 的 header。 */
export function wsUrl(path: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const tok = getToken();
  const sep = path.includes('?') ? '&' : '?';
  return `${proto}//${location.host}${path}${tok ? `${sep}token=${encodeURIComponent(tok)}` : ''}`;
}

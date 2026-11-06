import type {
  DuResponse,
  FsListResponse,
  FsReadResponse,
  FsRoots,
  FsSearchResponse,
  FsStatResponse,
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

export interface UploadProgress {
  loaded: number;
  total: number;
  /** 0..100 */
  percent: number;
  /** 字节/秒 */
  speed: number;
}

/** 分块阈值：小于此值走单请求 */
const UPLOAD_CHUNK = 8 * 1024 * 1024;

function xhrUpload(
  url: string,
  body: Blob | File,
  headers: Record<string, string>,
  opts: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal; baseLoaded?: number; total?: number },
): Promise<{ ok: boolean; path: string; size: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.withCredentials = true;
    const tok = getToken();
    if (tok) xhr.setRequestHeader('X-Token', tok);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);

    const started = performance.now();
    const base = opts.baseLoaded ?? 0;
    const total = opts.total ?? body.size;

    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const loaded = base + ev.loaded;
      const secs = Math.max((performance.now() - started) / 1000, 0.001);
      opts.onProgress?.({
        loaded,
        total,
        percent: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
        speed: ev.loaded / secs,
      });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as { ok: boolean; path: string; size: number });
        } catch {
          resolve({ ok: true, path: '', size: total });
        }
      } else {
        let msg = `HTTP ${xhr.status}`;
        try {
          const j = JSON.parse(xhr.responseText) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* 保持默认 */
        }
        reject(new ApiError(xhr.status, msg));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, '网络错误'));
    xhr.onabort = () => reject(new DOMException('上传已取消', 'AbortError'));

    if (opts.signal) {
      if (opts.signal.aborted) {
        xhr.abort();
        return;
      }
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(body);
  });
}

async function uploadFile(
  path: string,
  file: File,
  opts: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal; chunkSize?: number },
): Promise<{ ok: boolean; path: string; size: number }> {
  const chunkSize = opts.chunkSize ?? UPLOAD_CHUNK;
  const url = `/api/fs/upload${q({ path })}`;

  if (file.size <= chunkSize) {
    return xhrUpload(url, file, { 'Content-Type': 'application/octet-stream' }, opts);
  }

  let offset = 0;
  let last: { ok: boolean; path: string; size: number } = { ok: true, path, size: 0 };
  while (offset < file.size) {
    if (opts.signal?.aborted) throw new DOMException('上传已取消', 'AbortError');
    const end = Math.min(offset + chunkSize, file.size);
    const blob = file.slice(offset, end);
    const final = end >= file.size ? 1 : 0;
    last = await xhrUpload(
      url,
      blob,
      {
        'Content-Type': 'application/octet-stream',
        'Content-Range': `bytes ${offset}-${end - 1}/${file.size}`,
        'X-Upload-Final': String(final),
      },
      { ...opts, baseLoaded: offset, total: file.size },
    );
    offset = end;
    opts.onProgress?.({
      loaded: offset,
      total: file.size,
      percent: Math.min(100, Math.round((offset / file.size) * 100)),
      speed: 0,
    });
  }
  return last;
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

  /**
   * 上传文件。小文件一次 POST，大文件按 CHUNK 分块续传。
   * 通过 XHR 上报真实进度（fetch 拿不到上传进度），支持 AbortSignal 取消。
   */
  fsUpload: (
    path: string,
    file: File,
    opts: {
      onProgress?: (p: UploadProgress) => void;
      signal?: AbortSignal;
      chunkSize?: number;
    } = {},
  ) => uploadFile(path, file, opts),

  /**
   * 打包为 zip。
   * · dest 有值 → 写盘，返回 { ok, path, size }
   * · dest 为空 → 后端流式返回 zip，这里转成 Blob 触发浏览器下载
   */
  fsArchive: async (paths: string[], dest = ''): Promise<{ ok: boolean; path?: string; size?: number }> => {
    const res = await fetch('/api/fs/archive', {
      method: 'POST',
      credentials: 'include',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ paths, dest, download: dest === '' }),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* 保持默认 */
      }
      throw new ApiError(res.status, msg);
    }
    const ct = res.headers.get('Content-Type') ?? '';
    if (ct.includes('application/json')) {
      return (await res.json()) as { ok: boolean; path?: string; size?: number };
    }
    // 流式 zip → 触发下载
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const cd = res.headers.get('Content-Disposition') ?? '';
    const m = /filename="?([^";]+)"?/.exec(cd);
    a.href = url;
    a.download = m?.[1] ?? 'archive.zip';
    a.click();
    URL.revokeObjectURL(url);
    return { ok: true, size: blob.size };
  },

  /** 解压 zip / tar / tar.gz / tgz。destDir 为空则后端自动解到同名目录。 */
  fsExtract: (path: string, destDir = '') =>
    request<{ ok: boolean; dest?: string; extracted?: number }>('/api/fs/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, destDir }),
    }),

  /** 单文件完整属性。 */
  fsStat: (path: string) => request<FsStatResponse>(`/api/fs/stat${q({ path })}`),

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

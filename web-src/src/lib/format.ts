export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function fmtBytes(n: number, digits = 1): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : digits)} ${units[i]}`;
}

export function fmtBps(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B/s';
  return `${fmtBytes(n)}/s`;
}

/**
 * 图表 Y 轴用的紧凑字节格式化。
 * 保证不同刻度输出不同文本（旧实现把 800k/800k/800k 都格式化成同一个串），
 * 且字符数尽量稳定，避免轴宽跳动。
 */
export function fmtBytesAxis(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  const units = ['B', 'K', 'M', 'G', 'T'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  // 数值 <10 保留 1 位，>=10 取整 —— 刻度之间必定可区分
  const s = v >= 10 || i === 0 ? Math.round(v).toString() : v.toFixed(1);
  return `${s}${units[i]}`;
}

/** 图表 Y 轴用的紧凑百分比 */
export function fmtPctAxis(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${Math.round(n)}%`;
}

export function fmtPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

export function fmtNum(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtUptime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分`;
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

export function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', { hour12: false });
}

export function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分 ${s % 60} 秒前`;
  const h = Math.floor(m / 60);
  return `${h} 小时 ${m % 60} 分前`;
}

/** 逐线程利用率 → 颜色档位（0..4） */
export function loadLevel(pct: number): number {
  if (pct < 5) return 0;
  if (pct < 25) return 1;
  if (pct < 55) return 2;
  if (pct < 85) return 3;
  return 4;
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** 相对路径拼接 */
export function joinPath(dir: string, name: string): string {
  if (dir === '/' || dir === '') return `/${name}`;
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

export function parentOf(path: string): string {
  if (path === '/' || path === '') return '/';
  const p = path.replace(/\/+$/, '');
  const i = p.lastIndexOf('/');
  if (i <= 0) return '/';
  return p.slice(0, i);
}

export function baseName(path: string): string {
  if (path === '/') return '/';
  const p = path.replace(/\/+$/, '');
  return p.slice(p.lastIndexOf('/') + 1);
}

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
export function isImage(name: string): boolean {
  const i = name.lastIndexOf('.');
  if (i < 0) return false;
  return IMAGE_EXT.has(name.slice(i + 1).toLowerCase());
}

const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env',
  'log', 'go', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'css', 'scss', 'html', 'htm', 'xml', 'svg',
  'sh', 'bash', 'zsh', 'fish', 'py', 'rb', 'rs', 'c', 'h', 'cc', 'cpp', 'hpp', 'java', 'kt', 'sql',
  'service', 'rules', 'lua', 'php', 'vue', 'svelte', 'lock', 'gitignore', 'dockerfile', 'makefile',
  'nginx', 'properties', 'csv', 'tsv', 'diff', 'patch',
]);
const TEXT_NAMES = new Set(['dockerfile', 'makefile', 'license', 'readme', 'changelog']);

export function isTextFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (TEXT_NAMES.has(lower)) return true;
  const i = lower.lastIndexOf('.');
  if (i < 0) return false;
  return TEXT_EXT.has(lower.slice(i + 1));
}

import { useCallback, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { FsEntry } from '../lib/types';
import { baseName, joinPath, parentOf } from '../lib/format';

/* ══════════════════════════════════════════════════════════════════════════
   多选：锚点 + 范围 + 切换
   ══════════════════════════════════════════════════════════════════════════ */

export interface Selection {
  selected: Set<string>;
  anchor: string | null;
}

export function useSelection(rows: FsEntry[]) {
  const [sel, setSel] = useState<Selection>({ selected: new Set(), anchor: null });

  const clear = useCallback(() => setSel({ selected: new Set(), anchor: null }), []);

  /** 单击：普通=单选并设锚点；ctrl/meta=切换；shift=从锚点范围选 */
  const click = useCallback(
    (path: string, mods: { shift?: boolean; toggle?: boolean }) => {
      setSel((prev) => {
        if (mods.shift && prev.anchor) {
          const a = rows.findIndex((r) => r.path === prev.anchor);
          const b = rows.findIndex((r) => r.path === path);
          if (a >= 0 && b >= 0) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            const next = new Set(prev.selected);
            for (let i = lo; i <= hi; i++) {
              const r = rows[i];
              if (r) next.add(r.path);
            }
            return { selected: next, anchor: prev.anchor };
          }
        }
        if (mods.toggle) {
          const next = new Set(prev.selected);
          if (next.has(path)) next.delete(path);
          else next.add(path);
          return { selected: next, anchor: path };
        }
        return { selected: new Set([path]), anchor: path };
      });
    },
    [rows],
  );

  const toggle = useCallback((path: string) => {
    setSel((prev) => {
      const next = new Set(prev.selected);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { selected: next, anchor: path };
    });
  }, []);

  const selectAll = useCallback(() => {
    setSel({ selected: new Set(rows.map((r) => r.path)), anchor: rows[0]?.path ?? null });
  }, [rows]);

  const setMany = useCallback((paths: string[]) => {
    setSel({ selected: new Set(paths), anchor: paths[0] ?? null });
  }, []);

  const paths = useMemo(() => Array.from(sel.selected), [sel.selected]);

  return {
    selected: sel.selected,
    anchor: sel.anchor,
    paths,
    count: sel.selected.size,
    click,
    toggle,
    selectAll,
    clear,
    setMany,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   剪贴板：copy / cut + paste
   ══════════════════════════════════════════════════════════════════════════ */

export type ClipMode = 'copy' | 'cut';

export interface Clip {
  mode: ClipMode;
  paths: string[];
}

export function useClipboard() {
  const [clip, setClip] = useState<Clip | null>(null);

  const copy = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    setClip({ mode: 'copy', paths });
  }, []);

  const cut = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    setClip({ mode: 'cut', paths });
  }, []);

  const clear = useCallback(() => setClip(null), []);

  /**
   * 粘贴到目标目录。
   * copy → /api/fs/copy；cut → /api/fs/rename（同盘移动是原子 rename）。
   * 目标已存在同名项时自动加 ` copy` / ` copy 2` 后缀（copy 模式）。
   */
  const paste = useCallback(
    async (destDir: string, existing: Set<string>): Promise<{ ok: number; failed: string[] }> => {
      if (!clip) return { ok: 0, failed: [] };
      const failed: string[] = [];
      let ok = 0;
      for (const src of clip.paths) {
        const name = baseName(src);
        let target = joinPath(destDir, name);

        // 移动到自己所在的目录 = 无操作
        if (parentOf(src) === destDir) {
          if (clip.mode === 'cut') {
            ok++;
            continue;
          }
        }

        if (clip.mode === 'copy' && existing.has(name)) {
          const dot = name.lastIndexOf('.');
          const stem = dot > 0 ? name.slice(0, dot) : name;
          const ext = dot > 0 ? name.slice(dot) : '';
          let n = 1;
          let candidate = `${stem} copy${ext}`;
          while (existing.has(candidate)) {
            n++;
            candidate = `${stem} copy ${n}${ext}`;
          }
          target = joinPath(destDir, candidate);
        }

        try {
          if (clip.mode === 'copy') await api.fsCopy(src, target);
          else await api.fsRename(src, target);
          ok++;
        } catch (e) {
          failed.push(`${name}: ${e instanceof Error ? e.message : '失败'}`);
        }
      }
      if (clip.mode === 'cut') setClip(null);
      return { ok, failed };
    },
    [clip],
  );

  return { clip, copy, cut, clear, paste };
}

/* ══════════════════════════════════════════════════════════════════════════
   键盘导航
   ══════════════════════════════════════════════════════════════════════════ */

export function useKeyboardNav(opts: {
  rows: FsEntry[];
  focusIndex: number;
  setFocusIndex: (i: number) => void;
  onOpen: (e: FsEntry) => void;
  onDelete: () => void;
  onRename: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onUp: () => void;
  onSelectAll: () => void;
  onClearSel: () => void;
  enabled: boolean;
}) {
  const o = useRef(opts);
  o.current = opts;

  const handler = useCallback((e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (document.querySelector('[role="dialog"], [role="menu"]')) return;
    const c = o.current;
    if (!c.enabled) return;

    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      c.onSelectAll();
      return;
    }
    if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      c.onCopy();
      return;
    }
    if (mod && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      c.onCut();
      return;
    }
    if (mod && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      c.onPaste();
      return;
    }
    if (mod) return;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = Math.min(c.rows.length - 1, c.focusIndex + 1);
        c.setFocusIndex(next);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        c.setFocusIndex(Math.max(0, c.focusIndex - 1));
        break;
      }
      case 'Enter': {
        const row = c.rows[c.focusIndex];
        if (row) {
          e.preventDefault();
          c.onOpen(row);
        }
        break;
      }
      case 'F2': {
        e.preventDefault();
        c.onRename();
        break;
      }
      case 'Delete': {
        e.preventDefault();
        c.onDelete();
        break;
      }
      case 'Backspace': {
        e.preventDefault();
        c.onUp();
        break;
      }
      case 'Escape': {
        c.onClearSel();
        break;
      }
      default:
        break;
    }
  }, []);

  return handler;
}

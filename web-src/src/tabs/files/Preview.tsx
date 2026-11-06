import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { FsEntry } from '../../lib/types';
import { baseName, fmtBytes } from '../../lib/format';

import { Download, X, ZoomIn, ZoomOut, RotateCw } from 'lucide-react';

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | null;

const IMG = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'svg']);
const VID = new Set(['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v', 'ogv']);
const AUD = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus']);
const PDF = new Set(['pdf']);

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

export function previewKind(name: string): PreviewKind {
  const x = extOf(name);
  if (IMG.has(x)) return 'image';
  if (VID.has(x)) return 'video';
  if (AUD.has(x)) return 'audio';
  if (PDF.has(x)) return 'pdf';
  return null;
}

export function Preview({
  entry,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: {
  entry: FsEntry;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  const kind = previewKind(entry.name);
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  const [err, setErr] = useState(false);

  useEffect(() => {
    setZoom(1);
    setRot(0);
    setErr(false);
  }, [entry.path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasPrev) onPrev();
      else if (e.key === 'ArrowRight' && hasNext) onNext();
      else if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(6, z * 1.25));
      else if (e.key === '-') setZoom((z) => Math.max(0.1, z / 1.25));
      else if (e.key === '0') setZoom(1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  const src = api.downloadUrl(entry.path);
  // 图片优先用缩略图接口（大尺寸），失败回落到原图
  const thumb = api.thumbUrl(entry.path, 1800);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/90" role="dialog" aria-modal="true">
      {/* 顶部条 */}
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-2">
        <span className="num min-w-0 truncate text-[12px] text-white/90">{entry.name}</span>
        <span className="num shrink-0 text-[10.5px] text-white/45">{fmtBytes(entry.size)}</span>
        <span className="kicker shrink-0 text-white/35">{kind}</span>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {kind === 'image' && (
            <>
              <button
                onClick={() => setZoom((z) => Math.max(0.1, z / 1.25))}
                className="px-1.5 py-1 text-white/60 hover:text-white"
                title="缩小 (-)"
              >
                <ZoomOut size={14} />
              </button>
              <span className="num w-10 text-center text-[10.5px] text-white/50">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom((z) => Math.min(6, z * 1.25))}
                className="px-1.5 py-1 text-white/60 hover:text-white"
                title="放大 (+)"
              >
                <ZoomIn size={14} />
              </button>
              <button
                onClick={() => setRot((r) => (r + 90) % 360)}
                className="px-1.5 py-1 text-white/60 hover:text-white"
                title="旋转"
              >
                <RotateCw size={14} />
              </button>
              <span className="mx-1 h-3.5 w-px bg-white/15" />
            </>
          )}
          <a
            href={src}
            download={baseName(entry.path)}
            className="px-1.5 py-1 text-white/60 hover:text-white"
            title="下载"
          >
            <Download size={14} />
          </a>
          <button
            onClick={onClose}
            className="px-1.5 py-1 text-white/60 hover:text-white"
            title="关闭 (Esc)"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* 内容 */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        {hasPrev && (
          <button
            onClick={onPrev}
            className="absolute top-1/2 left-2 z-10 -translate-y-1/2 px-2 py-3 text-2xl text-white/40 transition-colors hover:text-white"
            title="上一个 (←)"
          >
            ‹
          </button>
        )}
        {hasNext && (
          <button
            onClick={onNext}
            className="absolute top-1/2 right-2 z-10 -translate-y-1/2 px-2 py-3 text-2xl text-white/40 transition-colors hover:text-white"
            title="下一个 (→)"
          >
            ›
          </button>
        )}

        {kind === 'image' && !err && (
          <img
            src={thumb}
            alt={entry.name}
            onError={() => setErr(true)}
            className="max-h-full max-w-full object-contain transition-transform duration-150"
            style={{ transform: `scale(${zoom}) rotate(${rot}deg)` }}
            draggable={false}
          />
        )}
        {kind === 'image' && err && (
          <img
            src={src}
            alt={entry.name}
            className="max-h-full max-w-full object-contain"
            style={{ transform: `scale(${zoom}) rotate(${rot}deg)` }}
            draggable={false}
          />
        )}

        {kind === 'video' && (
          <video
            src={src}
            controls
            autoPlay
            className="max-h-full max-w-full"
            onError={() => setErr(true)}
          />
        )}

        {kind === 'audio' && (
          <div className="w-full max-w-md border border-white/15 bg-white/5 p-6">
            <div className="mb-3 text-center text-[12px] text-white/70">{entry.name}</div>
            <audio src={src} controls autoPlay className="w-full" />
          </div>
        )}

        {kind === 'pdf' && (
          <iframe
            src={src}
            title={entry.name}
            className="h-full w-full border-0 bg-white"
          />
        )}

        {!kind && (
          <div className="text-center text-white/60">
            <div className="text-[13px]">该类型不支持预览</div>
            <a
              href={src}
              download={baseName(entry.path)}
              className="mt-3 inline-block border border-white/25 px-3 py-1.5 text-[11.5px] text-white/80 hover:border-white/60"
            >
              下载文件
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

/** 供外部判断某条目是否可预览 */
export function canPreview(e: FsEntry): boolean {
  return !e.isDir && previewKind(e.name) !== null;
}


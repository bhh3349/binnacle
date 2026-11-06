import { create } from 'zustand';
import { api, getToken, onUnauthorized, wsUrl } from '../lib/api';
import type { HistoryResponse, Snapshot } from '../lib/types';

export type ConnState = 'idle' | 'connecting' | 'online' | 'offline';

export interface TelemetryState {
  /** 900 点环形缓冲 = 15 分钟 @1s */
  points: Snapshot[];
  latest: Snapshot | null;
  conn: ConnState;
  /** 最后一次成功收到数据的时间戳（ms） */
  lastDataAt: number;
  /** 连续失败次数，用于「重连中」文案 */
  retries: number;
  authed: boolean;
  meta: { sampleMs: number; root: string } | null;

  /* 历史模式 */
  historyMode: boolean;
  historyLoading: boolean;
  historyError: string | null;
  history: HistoryResponse | null;

  connect: () => void;
  disconnect: () => void;
  setAuthed: (v: boolean) => void;
  loadMeta: () => Promise<void>;
  setHistoryMode: (on: boolean, from?: number, to?: number, step?: number) => Promise<void>;
}

const MAX_POINTS = 900;

let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;
let reconnectDelay = 500;
let stopped = true;
let pingTimer: number | null = null;

function clearReconnect() {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

export const useTelemetry = create<TelemetryState>((set, get) => ({
  points: [],
  latest: null,
  conn: 'idle',
  lastDataAt: 0,
  retries: 0,
  authed: !!getToken(),
  meta: null,

  historyMode: false,
  historyLoading: false,
  historyError: null,
  history: null,

  setAuthed: (v) => set({ authed: v }),

  loadMeta: async () => {
    try {
      const m = await api.meta();
      set({ meta: { sampleMs: m.sampleMs || 1000, root: m.root || '/' } });
    } catch {
      set({ meta: { sampleMs: 1000, root: '/' } });
    }
  },

  connect: () => {
    if (!getToken()) {
      set({ conn: 'offline' });
      return;
    }
    stopped = false;
    clearReconnect();
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    set({ conn: get().latest ? 'offline' : 'connecting' });

    let sock: WebSocket;
    try {
      sock = new WebSocket(wsUrl('/ws'));
    } catch {
      set({ conn: 'offline' });
      return;
    }
    ws = sock;

    sock.onopen = () => {
      reconnectDelay = 500;
      set({ conn: 'online', retries: 0 });
      if (pingTimer !== null) window.clearInterval(pingTimer);
      pingTimer = window.setInterval(() => {
        if (sock.readyState === WebSocket.OPEN) {
          try {
            sock.send(JSON.stringify({ type: 'ping' }));
          } catch {
            /* 忽略 */
          }
        }
      }, 20000);
    };

    sock.onmessage = (ev: MessageEvent<string>) => {
      if (typeof ev.data !== 'string') return;
      let snap: Snapshot;
      try {
        snap = JSON.parse(ev.data) as Snapshot;
      } catch {
        return;
      }
      if (!snap || typeof snap.t !== 'number' || !snap.host) return;
      const prev = get().points;
      const next = prev.length >= MAX_POINTS ? prev.slice(prev.length - MAX_POINTS + 1) : prev.slice();
      next.push(snap);
      set({
        points: next,
        latest: snap,
        lastDataAt: Date.now(),
        conn: 'online',
        retries: 0,
      });
    };

    sock.onclose = () => {
      if (pingTimer !== null) {
        window.clearInterval(pingTimer);
        pingTimer = null;
      }
      if (ws === sock) ws = null;
      if (stopped) return;
      // 关键：不清空 points / latest，界面保留最后数据
      set((s) => ({ conn: 'offline', retries: s.retries + 1 }));
      clearReconnect();
      reconnectTimer = window.setTimeout(
        () => {
          if (!stopped) get().connect();
        },
        Math.min(reconnectDelay, 8000),
      );
      reconnectDelay = Math.min(reconnectDelay * 1.7, 8000);
    };

    sock.onerror = () => {
      // onclose 会紧随其后处理重连
      set({ conn: 'offline' });
    };
  },

  disconnect: () => {
    stopped = true;
    clearReconnect();
    if (pingTimer !== null) {
      window.clearInterval(pingTimer);
      pingTimer = null;
    }
    if (ws) {
      const s = ws;
      ws = null;
      try {
        s.close();
      } catch {
        /* 忽略 */
      }
    }
    set({ conn: 'idle' });
  },

  setHistoryMode: async (on, from, to, step = 60) => {
    if (!on) {
      set({ historyMode: false });
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const f = from ?? now - 3600;
    const t = to ?? now;
    set({ historyMode: true, historyLoading: true, historyError: null });
    try {
      const res = await api.history(f, t, step);
      set({ history: res, historyLoading: false });
    } catch (e) {
      set({
        historyLoading: false,
        historyError: e instanceof Error ? e.message : '历史数据加载失败',
        history: null,
      });
    }
  },
}));

/** 启动一次全局 WS 监听，并把 401 引导到登录页 */
export function bootstrapTelemetry() {
  onUnauthorized(() => {
    useTelemetry.getState().disconnect();
    useTelemetry.getState().setAuthed(false);
  });
  void useTelemetry.getState().loadMeta();
  useTelemetry.getState().connect();
}

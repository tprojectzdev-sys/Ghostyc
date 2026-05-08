import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react";

interface WsEnvelope {
  v: number;
  type: string;
  id: string;
  request_id?: string | null;
  correlation_id?: string | null;
  ts: string;
  data: unknown;
}

type WsListener = (env: WsEnvelope) => void;

interface WsState {
  connected: boolean;
  sessionId: string | null;
  addListener: (type: string, fn: WsListener) => () => void;
}

const WsContext = createContext<WsState>({
  connected: false,
  sessionId: null,
  addListener: () => () => {},
});

export function useWs() {
  return useContext(WsContext);
}

export function useWsEvent(type: string, handler: WsListener) {
  const { addListener } = useWs();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return addListener(type, (env) => handlerRef.current(env));
  }, [addListener, type]);
}

const PROTOCOL_VERSION = "1.0.0-draft";
const CLIENT_VERSION = "0.1.0";

export function WsProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Map<string, Set<WsListener>>>(new Map());
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dispatch = useCallback((env: WsEnvelope) => {
    const set = listenersRef.current.get(env.type);
    if (set) {
      for (const fn of set) fn(env);
    }
    const all = listenersRef.current.get("*");
    if (all) {
      for (const fn of all) fn(env);
    }
  }, []);

  const addListener = useCallback((type: string, fn: WsListener) => {
    if (!listenersRef.current.has(type)) {
      listenersRef.current.set(type, new Set());
    }
    listenersRef.current.get(type)!.add(fn);
    return () => {
      listenersRef.current.get(type)?.delete(fn);
    };
  }, []);

  const connect = useCallback(() => {
    const token = localStorage.getItem("ghostyc_token");
    if (!token) return;

    const base = import.meta.env.VITE_RELAY_URL || "";
    const wsBase = base
      ? base.replace(/^http/, "ws")
      : `ws://${window.location.host}`;
    const ws = new WebSocket(`${wsBase}/ws/client`);
    wsRef.current = ws;

    ws.onopen = () => {
      const hello: WsEnvelope = {
        v: 1,
        type: "hello",
        id: crypto.randomUUID(),
        request_id: null,
        correlation_id: null,
        ts: new Date().toISOString(),
        data: {
          role: "client",
          device_id: "dashboard",
          token,
          version: CLIENT_VERSION,
          protocol_version: PROTOCOL_VERSION,
        },
      };
      ws.send(JSON.stringify(hello));
    };

    ws.onmessage = (ev) => {
      try {
        const env = JSON.parse(ev.data) as WsEnvelope;
        if (env.type === "welcome") {
          const data = env.data as { session_id?: string };
          setSessionId(data.session_id ?? null);
          setConnected(true);
          reconnectAttempt.current = 0;
        } else if (env.type === "error") {
          console.error("[ws] server error:", env.data);
        }
        dispatch(env);
      } catch {
        // malformed frame
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setSessionId(null);
      wsRef.current = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [dispatch]);

  const scheduleReconnect = useCallback(() => {
    const token = localStorage.getItem("ghostyc_token");
    if (!token) return;

    const attempt = reconnectAttempt.current;
    reconnectAttempt.current = attempt + 1;

    let delay: number;
    if (attempt < 10) {
      delay = Math.min(1000 * Math.pow(2, attempt), 30000);
    } else {
      delay = 300000;
    }
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    delay = Math.max(500, delay + jitter);

    reconnectTimer.current = setTimeout(() => {
      connect();
    }, delay);
  }, [connect]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  return (
    <WsContext.Provider value={{ connected, sessionId, addListener }}>
      {children}
    </WsContext.Provider>
  );
}

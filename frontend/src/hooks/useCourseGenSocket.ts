/**
 * WebSocket hook with Hyperknow-style heartbeat, auto-reconnect and
 * a reducer-based event stream.
 */
import { useEffect, useRef, useReducer, useCallback, useState } from "react";
import {
  courseGenReducer,
  emptyCourseGenState,
  type ClientCommand,
  type CourseGenState,
  type ServerEvent,
} from "../lib/protocol";

export type ConnState = "idle" | "connecting" | "open" | "closed" | "error";

export function useCourseGenSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const stateRef = useRef<CourseGenState>(emptyCourseGenState());

  const [gen, dispatch] = useReducer(
    (s: CourseGenState, e: ServerEvent) => {
      const next = courseGenReducer(s, e);
      stateRef.current = next;
      return next;
    },
    null,
    emptyCourseGenState,
  );
  const [conn, setConn] = useState<ConnState>("idle");

  const startHeartbeat = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, 25_000);
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const connect = useCallback((): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        resolve(wsRef.current);
        return;
      }
      setConn("connecting");
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/api/v1/course-generation/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConn("open");
        reconnectAttemptRef.current = 0;
        startHeartbeat();
        resolve(ws);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as ServerEvent;
          if (msg.type === "pong") return;
          dispatch(msg);
        } catch {
          /* ignore malformed */
        }
      };
      ws.onclose = () => {
        setConn("closed");
        stopHeartbeat();
        // exponential backoff reconnect (Hyperknow: min(3e4, 1e3*2^attempt))
        const attempt = reconnectAttemptRef.current++;
        if (attempt < 5) {
          setTimeout(() => connect().catch(() => {}), Math.min(30_000, 1000 * 2 ** attempt));
        }
      };
      ws.onerror = () => setConn("error");
    });
  }, [startHeartbeat, stopHeartbeat]);

  const send = useCallback((cmd: ClientCommand) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(cmd));
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const startGeneration = useCallback(
    async (query: string, opts?: { provider?: string; model?: string; thinking_level?: string }) => {
      await connect();
      send({ type: "start_course_generation", query, ...opts });
    },
    [connect, send],
  );

  const submitAnswers = useCallback(
    (answers: { prior_knowledge: string[]; lens: string; mastery: string; scale: string }) => {
      send({ type: "course_generation_answers", answers });
    },
    [send],
  );

  const confirmBlueprint = useCallback(
    (confirmed: boolean, feedback?: string) => {
      send({ type: "blueprint_confirm", confirmed, feedback });
    },
    [send],
  );

  const stop = useCallback(() => {
    send({ type: "stop_course_generation" });
    wsRef.current?.close();
  }, [send]);

  useEffect(() => {
    return () => {
      stopHeartbeat();
      wsRef.current?.close();
    };
  }, [stopHeartbeat]);

  return { gen, conn, startGeneration, submitAnswers, confirmBlueprint, stop };
}

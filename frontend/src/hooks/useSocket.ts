/**
 * useSocket.ts — Typed React hook for Socket.io real-time events.
 *
 * Creates and reuses a **module-level** Socket.io client singleton (`sharedSocket`),
 * so all components that call `useSocket` share the same WebSocket connection
 * rather than each opening their own.
 *
 * The handler is stored in a ref (`handlerRef`) so the effect only registers the
 * listener once per `event` type, even if the handler callback is recreated on
 * every render (e.g., an inline arrow function). This prevents memory leaks from
 * accumulating duplicate listeners.
 *
 * Supported events (see EventMap):
 *   `asset:created` — a new asset was created
 *   `asset:updated` — an asset was modified
 *   `asset:deleted` — an asset was removed (payload: `{ _id: string }`)
 *
 * @param event — The Socket.io event name to listen for.
 * @param handler — Callback invoked with the event payload.
 */
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.REACT_APP_API_URL?.replace('/api', '') ?? 'http://localhost:4000';

let sharedSocket: Socket | null = null;

function getSocket(): Socket {
  if (!sharedSocket) {
    sharedSocket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
  }
  return sharedSocket;
}

type EventMap = {
  'asset:created': (asset: any) => void;
  'asset:updated': (asset: any) => void;
  'asset:deleted': (data: { _id: string }) => void;
};

export function useSocket<K extends keyof EventMap>(
  event: K,
  handler: EventMap[K]
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const socket = getSocket();
    const wrapped = (...args: any[]) => (handlerRef.current as any)(...args);
    socket.on(event as string, wrapped);
    return () => { socket.off(event as string, wrapped); };
  }, [event]);
}

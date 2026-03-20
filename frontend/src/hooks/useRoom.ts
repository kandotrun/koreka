import { useState, useEffect, useRef, useCallback } from 'react';
import type { ServerMessage, ClientMessage, PlayerInfo, Card, RoomPhase } from '../../../src/types';

interface RoomState {
  connected: boolean;
  playerId: string | null;
  phase: RoomPhase;
  hostId: string;
  players: PlayerInfo[];
  cards: Card[];
  round: number;
  pending: string[];
  survivors: Card[];
  result: { card: Card; votes: Record<string, string> } | null;
}

export function useRoom(code: string | undefined) {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<RoomState>({
    connected: false,
    playerId: null,
    phase: 'waiting',
    hostId: '',
    players: [],
    cards: [],
    round: 0,
    pending: [],
    survivors: [],
    result: null,
  });

  // 接続時に自動joinするための名前を保持
  const autoJoinNameRef = useRef<string | null>(null);

  const connect = useCallback((autoJoinName?: string) => {
    if (!code || wsRef.current) return;
    if (autoJoinName) autoJoinNameRef.current = autoJoinName;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/rooms/${code}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setState(s => ({ ...s, connected: true }));
      // 接続完了時に自動joinする（race condition防止）
      if (autoJoinNameRef.current) {
        ws.send(JSON.stringify({ type: 'join', name: autoJoinNameRef.current }));
        autoJoinNameRef.current = null;
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      setState(s => ({ ...s, connected: false }));
    };

    ws.onmessage = (event) => {
      const msg: ServerMessage = JSON.parse(event.data);

      switch (msg.type) {
        case 'welcome':
          setState(s => ({
            ...s,
            playerId: msg.playerId,
            phase: msg.roomState.phase,
            hostId: msg.roomState.hostId,
            players: msg.roomState.players,
            round: msg.roomState.round,
          }));
          break;
        case 'players':
          setState(s => ({ ...s, players: msg.players }));
          break;
        case 'deal':
          setState(s => ({ ...s, phase: 'selecting', cards: msg.cards, round: msg.round, pending: [] }));
          break;
        case 'pass':
          setState(s => ({ ...s, phase: 'selecting', cards: msg.cards, round: msg.round, pending: [] }));
          break;
        case 'waiting':
          setState(s => ({ ...s, pending: msg.pending }));
          break;
        case 'round_complete':
          setState(s => ({ ...s, round: msg.round }));
          break;
        case 'final_vote':
          setState(s => ({ ...s, phase: 'voting', survivors: msg.cards, pending: [] }));
          break;
        case 'result':
          setState(s => ({
            ...s,
            phase: 'result',
            result: { card: msg.card, votes: msg.votes },
          }));
          break;
        case 'error':
          console.error('Room error:', msg.message);
          break;
      }
    };
  }, [code]);

  const sendMessage = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const join = useCallback((name: string) => sendMessage({ type: 'join', name }), [sendMessage]);
  const ready = useCallback(() => sendMessage({ type: 'ready' }), [sendMessage]);
  const start = useCallback(() => sendMessage({ type: 'start' }), [sendMessage]);
  const select = useCallback((cardIds: string[]) => sendMessage({ type: 'select', cardIds }), [sendMessage]);
  const vote = useCallback((cardId: string) => sendMessage({ type: 'vote', cardId }), [sendMessage]);

  useEffect(() => {
    if (!code || wsRef.current) return;
    const name = window.sessionStorage.getItem('playerName') || 'ゲスト';
    connect(name);
  }, [code, connect]);

  // Ping to keep alive
  useEffect(() => {
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  return {
    ...state,
    connect,
    join,
    ready,
    start,
    select,
    vote,
  };
}

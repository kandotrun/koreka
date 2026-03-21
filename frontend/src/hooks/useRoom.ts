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
  error: string | null;
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
    error: null,
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
        const savedPlayerId = window.sessionStorage.getItem('playerId');
        const joinMsg: Record<string, string> = { type: 'join', name: autoJoinNameRef.current };
        if (savedPlayerId) joinMsg.playerId = savedPlayerId;
        ws.send(JSON.stringify(joinMsg));
        autoJoinNameRef.current = null;
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      setState(s => {
        // エラーで切断された場合は再接続しない
        if (s.error) return { ...s, connected: false };
        // 自動再接続（デプロイ後の断線復帰用）
        const savedName = window.sessionStorage.getItem('playerName') || 'ゲスト';
        setTimeout(() => {
          if (!wsRef.current) {
            connect(savedName);
          }
        }, 2000);
        return { ...s, connected: false };
      });
    };

    ws.onmessage = (event) => {
      const msg: ServerMessage = JSON.parse(event.data);

      switch (msg.type) {
        case 'welcome':
          window.sessionStorage.setItem('playerId', msg.playerId);
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
        case 'restart':
          setState(s => ({
            ...s,
            phase: 'waiting',
            cards: [],
            round: 0,
            pending: [],
            survivors: [],
            result: null,
            error: null,
          }));
          break;
        case 'error':
          console.error('Room error:', msg.message);
          // 致命的エラー（参加不可）
          if (msg.message === 'room_full' || msg.message === 'game_in_progress') {
            setState(s => ({ ...s, error: msg.message }));
            ws.close();
            break;
          }
          if (msg.message === 'kicked') {
            setState(s => ({ ...s, error: 'kicked' }));
            ws.close();
            break;
          }
          if (msg.message === 'selection_timeout') {
            setState(s => ({ ...s, error: 'selection_timeout' }));
            break;
          }
          if (msg.message === 'invalid_selection') {
            setState(s => {
              // selecting: カード再表示（全部キープしちゃった場合等）
              if (s.phase === 'selecting' && s.cards.length > 0) {
                return { ...s, cards: [...s.cards], pending: [] };
              }
              // voting: 投票状態リセットして再投票可能に
              if (s.phase === 'voting') {
                return { ...s, survivors: [...s.survivors], pending: [] };
              }
              return s;
            });
          }
          if (msg.message === 'already_voted') {
            // 二重投票 — 待機状態に戻す（他のプレイヤー待ち）
            setState(s => ({ ...s, pending: [] }));
          }
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
  const restart = useCallback(() => sendMessage({ type: 'restart' }), [sendMessage]);
  const kick = useCallback((playerId: string) => sendMessage({ type: 'kick', playerId }), [sendMessage]);

  useEffect(() => {
    if (!code || wsRef.current) return;
    const name = window.sessionStorage.getItem('playerName');
    if (name) {
      connect(name);
    }
    // 名前未設定の場合はLobbyで入力を促す（自動joinしない）
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
    restart,
    kick,
  };
}

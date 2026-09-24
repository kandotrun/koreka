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
  voted: boolean;
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
    voted: false,
    error: null,
  });

  // 接続時に自動joinするための名前を保持
  const autoJoinNameRef = useRef<string | null>(null);
  // 致命的エラー（部屋なし/満員/キック等）では再接続しない
  const fatalRef = useRef(false);
  // 再接続タイマー（unmount時にクリアしてゾンビ再接続を防ぐ）
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback((autoJoinName?: string) => {
    if (!code || wsRef.current) return;
    if (autoJoinName) autoJoinNameRef.current = autoJoinName;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/rooms/${code}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsRef.current !== ws) return; // 古い接続は無視
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
      // 古い接続のイベントは無視（unmount後・再接続後の二重処理を防ぐ）
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      setState(s => ({ ...s, connected: false }));

      // 致命的エラー（部屋なし/満員/キック）では再接続しない
      if (fatalRef.current) return;

      // 自動再接続（デプロイ・一時断線からの復帰。タイムアウト等の非致命的エラーは復帰させる）
      const savedName = window.sessionStorage.getItem('playerName') || 'ゲスト';
      reconnectTimerRef.current = setTimeout(() => {
        if (!wsRef.current) {
          connect(savedName);
        }
      }, 2000);
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return; // 古い接続は無視
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
          setState(s => ({ ...s, phase: 'selecting', cards: msg.cards, round: msg.round, pending: [], voted: false }));
          break;
        case 'pass':
          setState(s => ({ ...s, phase: 'selecting', cards: msg.cards, round: msg.round, pending: [], voted: false }));
          break;
        case 'waiting':
          setState(s => ({ ...s, pending: msg.pending }));
          break;
        case 'round_complete':
          setState(s => ({ ...s, round: msg.round }));
          break;
        case 'final_vote':
          // voted: 再接続時に「投票済みか」を受け取る（リロード後の二重投票防止）
          setState(s => ({ ...s, phase: 'voting', survivors: msg.cards, pending: [], voted: msg.voted ?? false }));
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
            voted: false,
            error: null,
          }));
          break;
        case 'error':
          console.error('Room error:', msg.message);
          // 致命的エラー（参加不可）
          if (msg.message === 'room_not_found') {
            fatalRef.current = true;
            setState(s => ({ ...s, error: 'room_not_found' }));
            ws.close();
            break;
          }
          if (msg.message === 'room_full' || msg.message === 'game_in_progress') {
            fatalRef.current = true;
            setState(s => ({ ...s, error: msg.message }));
            ws.close();
            break;
          }
          if (msg.message === 'kicked') {
            fatalRef.current = true;
            setState(s => ({ ...s, error: 'kicked' }));
            ws.close();
            break;
          }
          if (msg.message === 'selection_timeout') {
            setState(s => ({ ...s, error: 'selection_timeout' }));
            break;
          }
          if (msg.message === 'vote_timeout') {
            // 投票タイムアウトで自動投票された — 待機状態にする（この直後にresultが届く）
            setState(s => ({ ...s, voted: true, pending: [] }));
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
                return { ...s, survivors: [...s.survivors], pending: [], voted: false };
              }
              return s;
            });
          }
          if (msg.message === 'already_voted') {
            // 二重投票 — 投票済み扱いにして待機状態へ（他のプレイヤー待ち）
            setState(s => ({ ...s, pending: [], voted: true }));
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
  const vote = useCallback((cardId: string) => {
    sendMessage({ type: 'vote', cardId });
    // 楽観的更新: 投票直後に待機画面へ（不正投票時は invalid_selection で戻る）
    setState(s => ({ ...s, voted: true }));
  }, [sendMessage]);
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

  // Cleanup on unmount（ゾンビ再接続を防ぐ）
  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
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

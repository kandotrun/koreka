// Shared types for Koreka

export interface Card {
  id: string;
  text: string;
  category: CardCategory;
  generated: boolean;
}

export type CardCategory = 'adventure' | 'chill' | 'food' | 'night' | 'creative' | 'random';

export interface Player {
  id: string;
  name: string;
  ready: boolean;
  selectedCards?: string[];
}

export type RoomPhase = 'waiting' | 'dealing' | 'selecting' | 'passing' | 'voting' | 'result';

export interface RoomState {
  id: string;
  code: string;
  phase: RoomPhase;
  hostId: string;
  players: Player[];
  round: number;
  result: Card | null;
}

// Client → Server messages
export type ClientMessage =
  | { type: 'join'; name: string }
  | { type: 'ready' }
  | { type: 'start' }
  | { type: 'select'; cardIds: string[] }
  | { type: 'vote'; cardId: string }
  | { type: 'ping' };

// Server → Client messages
export type ServerMessage =
  | { type: 'welcome'; playerId: string; roomState: RoomPublicState }
  | { type: 'players'; players: PlayerInfo[] }
  | { type: 'deal'; cards: Card[]; round: number }
  | { type: 'pass'; cards: Card[]; round: number }
  | { type: 'waiting'; pending: string[] }
  | { type: 'round_complete'; remaining: number; round: number }
  | { type: 'final_vote'; cards: Card[] }
  | { type: 'result'; card: Card; votes: Record<string, string> }
  | { type: 'error'; message: string }
  | { type: 'pong' };

export interface PlayerInfo {
  id: string;
  name: string;
  ready: boolean;
}

export interface RoomPublicState {
  code: string;
  phase: RoomPhase;
  hostId: string;
  players: PlayerInfo[];
  round: number;
}

export interface CreateRoomRequest {
  hostName: string;
  settings?: {
    cardsPerPlayer?: number;
    categories?: CardCategory[];
  };
}

export interface CreateRoomResponse {
  roomId: string;
  code: string;
  wsUrl: string;
}

// Env is defined in env.ts (backend only, uses Cloudflare types)

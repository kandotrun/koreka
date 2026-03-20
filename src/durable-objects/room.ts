import type { Card, PlayerInfo, RoomPhase, ServerMessage, ClientMessage, RoomPublicState } from '../types';

interface PlayerState {
  id: string;
  name: string;
  ready: boolean;
  ws: WebSocket;
  selectedCards: string[];
}

interface InternalRoomState {
  code: string;
  phase: RoomPhase;
  hostId: string;
  players: Map<string, PlayerState>;
  deck: Card[];
  hands: Map<string, Card[]>;
  round: number;
  survivors: Card[];
  result: Card | null;
  votes: Map<string, string>;
  cardsPerPlayer: number;
}

export class RoomDurableObject implements DurableObject {
  private state: DurableObjectState;
  private room: InternalRoomState;

  constructor(state: DurableObjectState, env: unknown) {
    this.state = state;
    this.room = {
      code: '',
      phase: 'waiting',
      hostId: '',
      players: new Map(),
      deck: [],
      hands: new Map(),
      round: 0,
      survivors: [],
      result: null,
      votes: new Map(),
      cardsPerPlayer: 5,
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      return this.handleWebSocket(request);
    }

    if (url.pathname === '/init') {
      const body = await request.json() as { code: string; cards: Card[]; cardsPerPlayer?: number };
      this.room.code = body.code;
      this.room.deck = body.cards;
      if (body.cardsPerPlayer) {
        this.room.cardsPerPlayer = body.cardsPerPlayer;
      }
      return new Response(JSON.stringify({ ok: true }));
    }

    if (url.pathname === '/info') {
      return new Response(JSON.stringify(this.getPublicState()));
    }

    return new Response('Not found', { status: 404 });
  }

  private handleWebSocket(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.state.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string') return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(message);
    } catch {
      this.send(ws, { type: 'error', message: 'invalid_json' });
      return;
    }

    switch (msg.type) {
      case 'join':
        this.handleJoin(ws, msg.name);
        break;
      case 'ready':
        this.handleReady(ws);
        break;
      case 'start':
        this.handleStart(ws);
        break;
      case 'select':
        this.handleSelect(ws, msg.cardIds);
        break;
      case 'vote':
        this.handleVote(ws, msg.cardId);
        break;
      case 'ping':
        this.send(ws, { type: 'pong' });
        break;
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.removePlayer(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.removePlayer(ws);
  }

  private handleJoin(ws: WebSocket, name: string) {
    if (this.room.phase !== 'waiting') {
      this.send(ws, { type: 'error', message: 'game_in_progress' });
      return;
    }

    if (this.room.players.size >= 8) {
      this.send(ws, { type: 'error', message: 'room_full' });
      return;
    }

    const playerId = crypto.randomUUID().slice(0, 8);
    const player: PlayerState = {
      id: playerId,
      name,
      ready: false,
      ws,
      selectedCards: [],
    };

    this.room.players.set(playerId, player);

    // First player is the host
    if (this.room.players.size === 1) {
      this.room.hostId = playerId;
    }

    this.send(ws, {
      type: 'welcome',
      playerId,
      roomState: this.getPublicState(),
    });

    this.broadcastPlayers();
  }

  private handleReady(ws: WebSocket) {
    const player = this.findPlayer(ws);
    if (!player) return;

    player.ready = !player.ready;
    this.broadcastPlayers();
  }

  private handleStart(ws: WebSocket) {
    const player = this.findPlayer(ws);
    if (!player) return;

    if (player.id !== this.room.hostId) {
      this.send(ws, { type: 'error', message: 'not_host' });
      return;
    }

    if (this.room.players.size < 2) {
      this.send(ws, { type: 'error', message: 'need_more_players' });
      return;
    }

    const allReady = [...this.room.players.values()].every(p => p.id === this.room.hostId || p.ready);
    if (!allReady) {
      this.send(ws, { type: 'error', message: 'not_all_ready' });
      return;
    }

    this.startGame();
  }

  private startGame() {
    this.room.phase = 'dealing';
    this.room.round = 1;

    // Shuffle deck
    const shuffled = [...this.room.deck].sort(() => Math.random() - 0.5);
    const playerCount = this.room.players.size;
    const totalCards = Math.min(shuffled.length, playerCount * this.room.cardsPerPlayer);
    const cardsToUse = shuffled.slice(0, totalCards);
    const perPlayer = Math.ceil(cardsToUse.length / playerCount);

    // Deal cards
    const playerIds = [...this.room.players.keys()];
    this.room.hands = new Map();

    for (let i = 0; i < playerIds.length; i++) {
      const hand = cardsToUse.slice(i * perPlayer, (i + 1) * perPlayer);
      this.room.hands.set(playerIds[i], hand);
    }

    // Send dealt cards to each player
    this.room.phase = 'selecting';
    for (const [playerId, hand] of this.room.hands) {
      const player = this.room.players.get(playerId);
      if (player) {
        this.send(player.ws, { type: 'deal', cards: hand, round: this.room.round });
      }
    }
  }

  private handleSelect(ws: WebSocket, cardIds: string[]) {
    const player = this.findPlayer(ws);
    if (!player || this.room.phase !== 'selecting') return;

    const hand = this.room.hands.get(player.id);
    if (!hand) return;

    // Validate: selected cards must be subset of hand
    const handIds = new Set(hand.map(c => c.id));
    const validSelection = cardIds.every(id => handIds.has(id));
    if (!validSelection || cardIds.length === 0) {
      this.send(ws, { type: 'error', message: 'invalid_selection' });
      return;
    }

    // Must discard at least 1 card (unless only 1 card in hand)
    if (cardIds.length >= hand.length && hand.length > 1) {
      this.send(ws, { type: 'error', message: 'invalid_selection' });
      return;
    }

    player.selectedCards = cardIds;

    // Check if all players have selected
    const allSelected = [...this.room.players.values()].every(p => p.selectedCards.length > 0);

    if (!allSelected) {
      // Broadcast waiting status
      const pending = [...this.room.players.values()]
        .filter(p => p.selectedCards.length === 0)
        .map(p => p.name);
      this.broadcast({ type: 'waiting', pending });
      return;
    }

    // All selected — pass cards
    this.passCards();
  }

  private passCards() {
    this.room.phase = 'passing';
    const playerIds = [...this.room.players.keys()];
    const playerCount = playerIds.length;

    // Collect kept cards per player
    const keptCards = new Map<string, Card[]>();
    let totalRemaining = 0;

    for (const [playerId, player] of this.room.players) {
      const hand = this.room.hands.get(playerId) || [];
      const kept = hand.filter(c => player.selectedCards.includes(c.id));
      keptCards.set(playerId, kept);
      totalRemaining += kept.length;
    }

    // Check convergence: total remaining <= playerCount
    if (totalRemaining <= playerCount) {
      this.startFinalVote(keptCards);
      return;
    }

    // Pass cards to next player (right rotation)
    this.room.round++;
    const newHands = new Map<string, Card[]>();

    for (let i = 0; i < playerCount; i++) {
      const fromId = playerIds[i];
      const toId = playerIds[(i + 1) % playerCount];
      const cards = keptCards.get(fromId) || [];
      newHands.set(toId, cards);
    }

    this.room.hands = newHands;

    // Reset selections
    for (const player of this.room.players.values()) {
      player.selectedCards = [];
    }

    // Send new hand to each player
    this.room.phase = 'selecting';
    for (const [playerId, hand] of this.room.hands) {
      const player = this.room.players.get(playerId);
      if (player) {
        this.send(player.ws, { type: 'pass', cards: hand, round: this.room.round });
      }
    }

    this.broadcast({ type: 'round_complete', remaining: totalRemaining, round: this.room.round });
  }

  private startFinalVote(keptCards: Map<string, Card[]>) {
    this.room.phase = 'voting';
    this.room.votes = new Map();

    // Collect all surviving cards
    const allCards: Card[] = [];
    const seen = new Set<string>();
    for (const cards of keptCards.values()) {
      for (const card of cards) {
        if (!seen.has(card.id)) {
          allCards.push(card);
          seen.add(card.id);
        }
      }
    }

    this.room.survivors = allCards;

    // Reset selections
    for (const player of this.room.players.values()) {
      player.selectedCards = [];
    }

    this.broadcast({ type: 'final_vote', cards: allCards });
  }

  private handleVote(ws: WebSocket, cardId: string) {
    const player = this.findPlayer(ws);
    if (!player || this.room.phase !== 'voting') return;

    if (this.room.votes.has(player.id)) {
      this.send(ws, { type: 'error', message: 'already_voted' });
      return;
    }

    const validCard = this.room.survivors.some(c => c.id === cardId);
    if (!validCard) {
      this.send(ws, { type: 'error', message: 'invalid_selection' });
      return;
    }

    this.room.votes.set(player.id, cardId);

    // Check if all voted
    if (this.room.votes.size >= this.room.players.size) {
      this.resolveResult();
    } else {
      const pending = [...this.room.players.values()]
        .filter(p => !this.room.votes.has(p.id))
        .map(p => p.name);
      this.broadcast({ type: 'waiting', pending });
    }
  }

  private resolveResult() {
    this.room.phase = 'result';

    // Count votes
    const voteCounts = new Map<string, number>();
    for (const cardId of this.room.votes.values()) {
      voteCounts.set(cardId, (voteCounts.get(cardId) || 0) + 1);
    }

    // Find max
    let maxVotes = 0;
    const topCards: string[] = [];
    for (const [cardId, count] of voteCounts) {
      if (count > maxVotes) {
        maxVotes = count;
        topCards.length = 0;
        topCards.push(cardId);
      } else if (count === maxVotes) {
        topCards.push(cardId);
      }
    }

    // Tiebreak: random
    const winnerId = topCards[Math.floor(Math.random() * topCards.length)];
    const winnerCard = this.room.survivors.find(c => c.id === winnerId)!;
    this.room.result = winnerCard;

    // Build votes map (playerId → cardId)
    const votes: Record<string, string> = {};
    for (const [playerId, cardId] of this.room.votes) {
      votes[playerId] = cardId;
    }

    this.broadcast({ type: 'result', card: winnerCard, votes });
  }

  private findPlayer(ws: WebSocket): PlayerState | undefined {
    for (const player of this.room.players.values()) {
      if (player.ws === ws) return player;
    }
    return undefined;
  }

  private removePlayer(ws: WebSocket) {
    const player = this.findPlayer(ws);
    if (!player) return;

    this.room.players.delete(player.id);
    this.room.hands.delete(player.id);

    if (this.room.players.size === 0) return;

    // Transfer host if needed
    if (player.id === this.room.hostId) {
      const firstPlayer = this.room.players.values().next().value;
      if (firstPlayer) {
        this.room.hostId = firstPlayer.id;
      }
    }

    this.broadcastPlayers();
  }

  private getPublicState(): RoomPublicState {
    return {
      code: this.room.code,
      phase: this.room.phase,
      hostId: this.room.hostId,
      players: this.getPlayerInfoList(),
      round: this.room.round,
    };
  }

  private getPlayerInfoList(): PlayerInfo[] {
    return [...this.room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
    }));
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // WebSocket closed
    }
  }

  private broadcast(msg: ServerMessage) {
    for (const player of this.room.players.values()) {
      this.send(player.ws, msg);
    }
  }

  private broadcastPlayers() {
    this.broadcast({ type: 'players', players: this.getPlayerInfoList() });
  }
}

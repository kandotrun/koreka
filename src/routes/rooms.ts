import { Hono } from 'hono';
import type { CreateRoomRequest, CreateRoomResponse, Card } from '../types';
import type { Env } from '../env';

const rooms = new Hono<{ Bindings: Env }>();

// Generate a random 4-digit code
function generateCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// POST /api/rooms - Create a new room
rooms.post('/', async (c) => {
  const body = await c.req.json<CreateRoomRequest>();
  if (!body.hostName || typeof body.hostName !== 'string') {
    return c.json({ error: 'hostName required' }, 400);
  }
  const code = generateCode();

  const cardsPerPlayer = body.settings?.cardsPerPlayer || 5;
  let cards: Card[];

  // Use custom cards if provided, otherwise fetch from D1
  const customCards = body.settings?.customCards;
  if (customCards && Array.isArray(customCards) && customCards.length > 0) {
    cards = customCards.slice(0, 50).map((text, i) => ({
      id: `custom-${crypto.randomUUID().slice(0, 8)}`,
      text: String(text).trim().slice(0, 100),
      category: 'random' as Card['category'],
      generated: false,
    })).filter(c => c.text.length > 0);
  } else {
    // Fetch cards from D1
    const validCategories = ['adventure', 'chill', 'food', 'night', 'creative', 'random', 'spicy', 'trending', 'seasonal'];
    const categories = body.settings?.categories?.filter(c => validCategories.includes(c));
    let query = "SELECT id, text, category, generated FROM cards WHERE (expires_at IS NULL OR expires_at >= date('now'))";
    const params: string[] = [];

    if (categories && categories.length > 0) {
      const placeholders = categories.map(() => '?').join(', ');
      query += ` AND category IN (${placeholders})`;
      params.push(...categories);
    }

    query += ' ORDER BY RANDOM() LIMIT ?';
    // We'll get more cards than needed so the game has a good pool
    params.push(String(cardsPerPlayer * 8));

    const { results } = await c.env.DB.prepare(query).bind(...params).all<{
      id: string;
      text: string;
      category: string;
      generated: number;
    }>();

    cards = (results || []).map(r => ({
      id: r.id,
      text: r.text,
      category: r.category as Card['category'],
      generated: r.generated === 1,
    }));
  }

  // Create Durable Object
  const roomId = c.env.ROOM.idFromName(code);
  const roomObj = c.env.ROOM.get(roomId);

  // Initialize the room
  await roomObj.fetch(new Request('http://internal/init', {
    method: 'POST',
    body: JSON.stringify({ code, cards, cardsPerPlayer }),
  }));

  // Save room to D1
  await c.env.DB.prepare(
    'INSERT INTO rooms (id, code, player_count, created_at) VALUES (?, ?, 0, datetime(\'now\'))'
  ).bind(roomId.toString(), code).run();

  const response: CreateRoomResponse = {
    roomId: roomId.toString(),
    code,
    wsUrl: `${c.req.url.replace('http', 'ws').replace('/api/rooms', '')}/api/rooms/${code}/ws`,
  };

  return c.json(response, 201);
});

// GET /api/rooms/:code - Get room info
rooms.get('/:code', async (c) => {
  const code = c.req.param('code');

  const roomId = c.env.ROOM.idFromName(code);
  const roomObj = c.env.ROOM.get(roomId);

  const res = await roomObj.fetch(new Request('http://internal/info'));
  const info = await res.json();

  return c.json(info);
});

export default rooms;

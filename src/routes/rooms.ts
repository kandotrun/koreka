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
  const code = generateCode();

  // Fetch cards from D1
  const categories = body.settings?.categories;
  let query = 'SELECT id, text, category, generated FROM cards';
  const params: string[] = [];

  if (categories && categories.length > 0) {
    const placeholders = categories.map(() => '?').join(', ');
    query += ` WHERE category IN (${placeholders})`;
    params.push(...categories);
  }

  query += ' ORDER BY RANDOM() LIMIT ?';
  const cardsPerPlayer = body.settings?.cardsPerPlayer || 5;
  // We'll get more cards than needed so the game has a good pool
  params.push(String(cardsPerPlayer * 8));

  const { results } = await c.env.DB.prepare(query).bind(...params).all<{
    id: string;
    text: string;
    category: string;
    generated: number;
  }>();

  const cards: Card[] = (results || []).map(r => ({
    id: r.id,
    text: r.text,
    category: r.category as Card['category'],
    generated: r.generated === 1,
  }));

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

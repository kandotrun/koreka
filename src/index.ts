import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import roomsRouter from './routes/rooms';
import wsRouter from './routes/ws';

export { RoomDurableObject } from './durable-objects/room';

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors());

// API routes
app.route('/api/rooms', roomsRouter);
app.route('/api/rooms', wsRouter);

// Card categories
app.get('/api/cards/categories', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT category, COUNT(*) as count FROM cards GROUP BY category'
  ).all<{ category: string; count: number }>();

  const categoryMeta: Record<string, { name: string; icon: string }> = {
    adventure: { name: '冒険', icon: '🏔️' },
    chill: { name: 'まったり', icon: '☕' },
    food: { name: 'グルメ', icon: '🍜' },
    night: { name: '夜遊び', icon: '🌙' },
    creative: { name: 'クリエイティブ', icon: '🎨' },
    random: { name: 'カオス', icon: '🎲' },
  };

  const categories = (results || []).map(r => ({
    id: r.category,
    ...categoryMeta[r.category] || { name: r.category, icon: '📋' },
    count: r.count,
  }));

  return c.json({ categories });
});

export default app;

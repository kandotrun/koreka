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
    spicy: { name: 'スパイシー', icon: '🔥' },
  };

  const categories = (results || []).map(r => ({
    id: r.category,
    ...categoryMeta[r.category] || { name: r.category, icon: '📋' },
    count: r.count,
  }));

  return c.json({ categories });
});

// お題サンプル取得（QA用）
app.get('/api/cards/sample', async (c) => {
  const category = c.req.query('category');
  const limit = parseInt(c.req.query('limit') || '20');
  let query = 'SELECT id, text, category, generated FROM cards';
  const params: string[] = [];
  if (category) {
    query += ' WHERE category = ?';
    params.push(category);
  }
  query += ' ORDER BY RANDOM() LIMIT ?';
  params.push(String(Math.min(limit, 50)));
  const { results } = await c.env.DB.prepare(query).bind(...params).all<{
    id: string; text: string; category: string; generated: number;
  }>();
  return c.json({ cards: results || [], count: (results || []).length });
});

// お題総数
app.get('/api/cards/count', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT COUNT(*) as total FROM cards').all<{ total: number }>();
  return c.json({ total: results?.[0]?.total || 0 });
});

export default app;

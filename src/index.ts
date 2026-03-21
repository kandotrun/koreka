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

// カテゴリ定義（共通）
const categoryMeta: Record<string, { name: string; icon: string }> = {
  adventure: { name: '冒険', icon: '🏔️' },
  chill: { name: 'まったり', icon: '☕' },
  food: { name: 'グルメ', icon: '🍜' },
  night: { name: '夜遊び', icon: '🌙' },
  creative: { name: 'クリエイティブ', icon: '🎨' },
  random: { name: 'カオス', icon: '🎲' },
  spicy: { name: 'スパイシー', icon: '🔥' },
  trending: { name: '時事ネタ', icon: '📰' },
  seasonal: { name: '季節', icon: '🌸' },
};

const ALL_CATEGORIES = Object.keys(categoryMeta);

// Card categories
app.get('/api/cards/categories', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT category, COUNT(*) as count FROM cards GROUP BY category'
  ).all<{ category: string; count: number }>();

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
  const rawLimit = parseInt(c.req.query('limit') || '20');
  const limit = Math.min(Number.isNaN(rawLimit) ? 20 : Math.max(1, rawLimit), 200);

  type CardRow = { id: string; text: string; category: string; generated: number };

  if (category) {
    // カテゴリバリデーション
    if (!ALL_CATEGORIES.includes(category)) {
      return c.json({ cards: [], count: 0 });
    }
    const { results } = await c.env.DB.prepare(
      'SELECT id, text, category, generated FROM cards WHERE category = ? ORDER BY RANDOM() LIMIT ?'
    ).bind(category, limit).all<CardRow>();
    return c.json({ cards: results || [], count: (results || []).length });
  }

  // 全カテゴリから均等取得（1クエリ + UNION ALL）
  // D1はbatch不可なので個別クエリだが、並列実行で高速化
  const perCat = Math.max(Math.ceil(limit / ALL_CATEGORIES.length), 2);
  const queries = ALL_CATEGORIES.map(cat =>
    c.env.DB.prepare(
      'SELECT id, text, category, generated FROM cards WHERE category = ? ORDER BY RANDOM() LIMIT ?'
    ).bind(cat, perCat).all<CardRow>()
  );
  const results = await Promise.all(queries);
  const all = results.flatMap(r => r.results || []);

  // Fisher-Yates shuffle
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  const cards = all.slice(0, limit);
  return c.json({ cards, count: cards.length });
});

// お題総数
app.get('/api/cards/count', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT COUNT(*) as total FROM cards').all<{ total: number }>();
  return c.json({ total: results?.[0]?.total || 0 });
});

export default app;

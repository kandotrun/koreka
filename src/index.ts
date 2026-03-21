import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import type { Card, CardCategory } from './types';
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

// 有効期限フィルタ（expires_at IS NULL = 無期限, または未来日）
const ACTIVE_FILTER = "(expires_at IS NULL OR expires_at >= date('now'))";

// Card categories
app.get('/api/cards/categories', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT category, COUNT(*) as count FROM cards WHERE ${ACTIVE_FILTER} GROUP BY category`
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
      `SELECT id, text, category, generated FROM cards WHERE category = ? AND ${ACTIVE_FILTER} ORDER BY RANDOM() LIMIT ?`
    ).bind(category, limit).all<CardRow>();
    return c.json({ cards: results || [], count: (results || []).length });
  }

  // 全カテゴリから均等取得、並列実行で高速化
  const perCat = Math.max(Math.ceil(limit / ALL_CATEGORIES.length), 2);
  const queries = ALL_CATEGORIES.map(cat =>
    c.env.DB.prepare(
      `SELECT id, text, category, generated FROM cards WHERE category = ? AND ${ACTIVE_FILTER} ORDER BY RANDOM() LIMIT ?`
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
  const { results } = await c.env.DB.prepare(`SELECT COUNT(*) as total FROM cards WHERE ${ACTIVE_FILTER}`).all<{ total: number }>();
  return c.json({ total: results?.[0]?.total || 0 });
});

// --- Feature 1: AI On-Demand Card Generation ---

// Simple in-memory rate limiter (max 3 calls per minute)
const rateLimitState = { timestamps: [] as number[] };

app.post('/api/cards/generate', async (c) => {
  const now = Date.now();
  rateLimitState.timestamps = rateLimitState.timestamps.filter(t => now - t < 60_000);
  if (rateLimitState.timestamps.length >= 3) {
    return c.json({ error: 'rate_limit_exceeded' }, 429);
  }
  rateLimitState.timestamps.push(now);

  const body = await c.req.json<{
    context?: { time?: string; mood?: string; playerCount?: number };
    count: number;
  }>();

  const count = Math.min(Math.max(1, body.count || 1), 10);
  const ctx = body.context || {};

  const prompt = [
    'あなたは「これか！」というカードゲームのお題生成AIです。',
    '友達同士で「次何する？」を決めるためのユニークで楽しいお題カードを生成してください。',
    ctx.time ? `時間帯: ${ctx.time}` : '',
    ctx.mood ? `気分: ${ctx.mood}` : '',
    ctx.playerCount ? `人数: ${ctx.playerCount}人` : '',
    `${count}枚のカードを生成してください。`,
    'JSONの配列で返してください。各要素は { "text": "お題テキスト", "category": "カテゴリ" } の形式です。',
    `カテゴリは次のいずれか: ${ALL_CATEGORIES.join(', ')}`,
    'お題は短く（30文字以内）、具体的で面白いものにしてください。',
    'JSON配列のみを返してください。説明やコードブロックは不要です。',
  ].filter(Boolean).join('\n');

  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'gemini_api_key_not_configured' }, 500);
  }

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  );

  if (!geminiRes.ok) {
    return c.json({ error: 'gemini_api_error' }, 502);
  }

  const geminiData = await geminiRes.json<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  }>();

  const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
  // Extract JSON array from response (handle possible markdown code blocks)
  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return c.json({ error: 'invalid_gemini_response' }, 502);
  }

  let generated: Array<{ text: string; category: string }>;
  try {
    generated = JSON.parse(jsonMatch[0]);
  } catch {
    return c.json({ error: 'invalid_gemini_response' }, 502);
  }

  const cards: Card[] = [];
  const stmts = [];

  for (const item of generated.slice(0, count)) {
    const category = ALL_CATEGORIES.includes(item.category) ? item.category : 'random';
    const id = `gen-${crypto.randomUUID().slice(0, 8)}`;
    const card: Card = {
      id,
      text: item.text.slice(0, 100),
      category: category as CardCategory,
      generated: true,
    };
    cards.push(card);
    stmts.push(
      c.env.DB.prepare(
        'INSERT INTO cards (id, text, category, generated) VALUES (?, ?, ?, 1)'
      ).bind(id, card.text, card.category)
    );
  }

  if (stmts.length > 0) {
    await c.env.DB.batch(stmts);
  }

  return c.json({ cards });
});

// --- Feature 2: Memory Recording (思い出記録) ---

app.post('/api/rooms/:code/memories', async (c) => {
  const code = c.req.param('code');
  const body = await c.req.json<{ comment: string }>();

  if (!body.comment || typeof body.comment !== 'string' || body.comment.trim().length === 0) {
    return c.json({ error: 'comment_required' }, 400);
  }

  // Look up room by code
  const room = await c.env.DB.prepare('SELECT id FROM rooms WHERE code = ?').bind(code).first<{ id: string }>();
  if (!room) {
    return c.json({ error: 'room_not_found' }, 404);
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO memories (id, room_id, comment, created_at) VALUES (?, ?, ?, datetime(\'now\'))'
  ).bind(id, room.id, body.comment.trim().slice(0, 500)).run();

  return c.json({ id, comment: body.comment.trim().slice(0, 500) }, 201);
});

app.get('/api/rooms/:code/memories', async (c) => {
  const code = c.req.param('code');

  const room = await c.env.DB.prepare('SELECT id FROM rooms WHERE code = ?').bind(code).first<{ id: string }>();
  if (!room) {
    return c.json({ error: 'room_not_found' }, 404);
  }

  const { results } = await c.env.DB.prepare(
    'SELECT id, comment, created_at FROM memories WHERE room_id = ? ORDER BY created_at DESC'
  ).bind(room.id).all<{ id: string; comment: string; created_at: string }>();

  return c.json({ memories: results || [] });
});

// Save result card for a room (called from frontend after result is displayed)
app.post('/api/rooms/:code/result', async (c) => {
  const code = c.req.param('code');
  const body = await c.req.json<{ cardId: string }>();

  if (!body.cardId || typeof body.cardId !== 'string') {
    return c.json({ error: 'card_id_required' }, 400);
  }

  const result = await c.env.DB.prepare(
    'UPDATE rooms SET result_card_id = ? WHERE code = ?'
  ).bind(body.cardId, code).run();

  if (!result.meta.changes) {
    return c.json({ error: 'room_not_found' }, 404);
  }

  return c.json({ ok: true });
});

// --- Feature 3: Admin Auth + Stats ---

// In-memory token store (token -> expiry timestamp)
const adminTokens = new Map<string, number>();
const TOKEN_TTL = 24 * 60 * 60 * 1000; // 24h

app.post('/api/admin/login', async (c) => {
  const body = await c.req.json<{ password: string }>();
  if (!body.password || body.password !== c.env.ADMIN_PASSWORD) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const token = crypto.randomUUID();
  adminTokens.set(token, Date.now() + TOKEN_TTL);
  return c.json({ token });
});

app.get('/api/admin/stats', async (c) => {
  const auth = c.req.header('Authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return c.json({ error: 'unauthorized' }, 401);
  const expiry = adminTokens.get(token);
  if (!expiry || Date.now() > expiry) {
    if (expiry) adminTokens.delete(token);
    return c.json({ error: 'unauthorized' }, 401);
  }

  const [cardsRes, roomsRes, memoriesRes, topCardsRes] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) as total FROM cards WHERE ${ACTIVE_FILTER}`).first<{ total: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as total FROM rooms').first<{ total: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as total FROM memories').first<{ total: number }>(),
    c.env.DB.prepare(
      `SELECT c.text, c.category, COUNT(*) as timesSelected
       FROM rooms r
       JOIN cards c ON r.result_card_id = c.id
       WHERE r.result_card_id IS NOT NULL
       GROUP BY r.result_card_id
       ORDER BY timesSelected DESC
       LIMIT 20`
    ).all<{ text: string; category: string; timesSelected: number }>(),
  ]);

  return c.json({
    totalCards: cardsRes?.total || 0,
    totalRooms: roomsRes?.total || 0,
    totalMemories: memoriesRes?.total || 0,
    topCards: topCardsRes.results || [],
  });
});

export default app;

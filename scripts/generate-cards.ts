// お題バッチ生成スクリプト
// Gemini 3.1 Pro API でお題を50個生成し、Cloudflare D1にinsert

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN!;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID!;
const D1_DATABASE_ID = process.env.D1_DATABASE_ID!;

interface Card {
  id: string;
  text: string;
  category: string;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

interface D1QueryResponse {
  success: boolean;
  result?: Array<{ results?: Array<{ text: string }> }>;
  errors?: Array<{ message: string }>;
}

const CATEGORIES = [
  { id: 'adventure', name: '冒険', emoji: '🏔️', description: '冒険的で刺激的な体験' },
  { id: 'chill', name: 'まったり', emoji: '☕', description: 'のんびりリラックスできる活動' },
  { id: 'food', name: 'グルメ', emoji: '🍜', description: '食べ物や料理に関する体験' },
  { id: 'night', name: '夜遊び', emoji: '🌙', description: '夜ならではの遊びや体験' },
  { id: 'creative', name: 'クリエイティブ', emoji: '🎨', description: '創造的でユニークな活動' },
  { id: 'random', name: 'カオス', emoji: '🎲', description: '予測不能でカオスな体験' },
  { id: 'spicy', name: 'スパイシー', emoji: '🔥', description: '攻めた・ちょっとドキドキする体験' },
];

async function generateCards(): Promise<Array<{ text: string; category: string }>> {
  const prompt = `あなたは「Koreka」というリアルタイムカードゲームのお題生成AIです。
友達グループが「次何する？」を決めるためのお題カードを生成してください。

## カテゴリ
${CATEGORIES.map(c => `- ${c.id}（${c.name} ${c.emoji}）: ${c.description}`).join('\n')}

## ルール
- 200個のお題を生成してください
- 各カテゴリから均等に（各28-30個程度）
- 日本語で、友達同士のカジュアルな口調
- 短く（20文字以内推奨、最大30文字）
- 具体的で実行可能な内容
- 既存のお題と被らないユニークな内容

## 既存のお題例（参考・重複禁止）
- 終電逃してタクシーで行けるとこまで行く
- コンビニでアイス買って公園のベンチで語る
- 一番近いラーメン屋に突撃する
- カラオケで点数バトルする
- 全員でTikTok撮る
- ジャンケンで負けた人が奢る

## 出力形式
JSON配列で出力してください。他のテキストは不要です。
[{"text": "お題テキスト", "category": "カテゴリID"}, ...]`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 16384,
        },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status} ${await res.text()}`);
  }

  const data: GeminiResponse = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // JSON部分を抽出
  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse Gemini response: ${rawText.slice(0, 200)}`);
  }

  const cards: Array<{ text: string; category: string }> = JSON.parse(jsonMatch[0]);

  // バリデーション
  const validCategories = new Set(CATEGORIES.map(c => c.id));
  return cards.filter(c =>
    c.text && c.category && validCategories.has(c.category) && c.text.length <= 50
  );
}

async function queryD1(sql: string, params: string[] = []): Promise<D1QueryResponse> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    }
  );

  if (!res.ok) {
    throw new Error(`D1 API error: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

async function getExistingTexts(): Promise<Set<string>> {
  const result = await queryD1('SELECT text FROM cards');
  const texts = new Set<string>();
  if (result.result) {
    for (const r of result.result) {
      if (r.results) {
        for (const row of r.results) {
          texts.add(row.text);
        }
      }
    }
  }
  return texts;
}

async function insertCards(cards: Array<{ text: string; category: string }>): Promise<number> {
  let inserted = 0;
  for (const card of cards) {
    const id = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await queryD1(
      'INSERT INTO cards (id, text, category, generated) VALUES (?, ?, ?, 1)',
      [id, card.text, card.category]
    );
    inserted++;
    // Rate limit対策
    await new Promise(r => setTimeout(r, 100));
  }
  return inserted;
}

async function main() {
  console.log('🎴 お題生成を開始...');

  // 1. 既存のお題を取得
  console.log('📋 既存のお題を取得中...');
  const existingTexts = await getExistingTexts();
  console.log(`  既存: ${existingTexts.size}件`);

  // 2. Gemini APIでお題生成
  console.log('🤖 Gemini 3.1 Proでお題を生成中...');
  const generated = await generateCards();
  console.log(`  生成: ${generated.length}件`);

  // 3. 重複チェック
  const newCards = generated.filter(c => !existingTexts.has(c.text));
  console.log(`  新規（重複除外後）: ${newCards.length}件`);

  if (newCards.length === 0) {
    console.log('✅ 新しいお題はありませんでした');
    return;
  }

  // 4. D1にinsert
  console.log('💾 D1にinsert中...');
  const inserted = await insertCards(newCards);
  console.log(`✅ ${inserted}件のお題を追加しました`);

  // カテゴリ別集計
  const byCat = new Map<string, number>();
  for (const card of newCards) {
    byCat.set(card.category, (byCat.get(card.category) || 0) + 1);
  }
  for (const [cat, count] of byCat) {
    const catInfo = CATEGORIES.find(c => c.id === cat);
    console.log(`  ${catInfo?.emoji || '?'} ${catInfo?.name || cat}: ${count}件`);
  }
}

main().catch(err => {
  console.error('❌ エラー:', err);
  process.exit(1);
});

import { useEffect, useState } from 'react';

interface StatsData {
  totalCards: number;
  totalRooms: number;
  totalMemories: number;
  topCards: Array<{ text: string; category: string; timesSelected: number }>;
}

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

export default function Admin() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/stats')
      .then(res => res.json())
      .then(data => setStats(data))
      .catch(() => setError('統計データの取得に失敗しました'));
  }, []);

  if (error) {
    return (
      <div className="page" style={{ justifyContent: 'center' }}>
        <p style={{ color: 'var(--danger)' }}>{error}</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="page" style={{ justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-sub)' }}>読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="page" style={{ padding: 'var(--space-lg)', maxWidth: 600, margin: '0 auto' }}>
      <h1 style={{ fontSize: 28, fontWeight: 900, marginBottom: 'var(--space-xl)' }}>
        管理者ダッシュボード
      </h1>

      {/* Summary Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 'var(--space-md)',
        marginBottom: 'var(--space-xl)',
      }}>
        {[
          { label: 'お題カード', value: stats.totalCards },
          { label: 'ルーム数', value: stats.totalRooms },
          { label: '思い出数', value: stats.totalMemories },
        ].map(item => (
          <div key={item.label} style={{
            background: 'var(--surface)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-lg)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--primary)' }}>
              {item.value}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-sub)', marginTop: 'var(--space-xs)' }}>
              {item.label}
            </div>
          </div>
        ))}
      </div>

      {/* Top Cards */}
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 'var(--space-md)' }}>
        人気のお題 TOP 20
      </h2>
      {stats.topCards.length === 0 ? (
        <p style={{ color: 'var(--text-sub)', fontSize: 14 }}>まだデータがありません</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {stats.topCards.map((card, i) => {
            const meta = categoryMeta[card.category] || { name: card.category, icon: '📋' };
            return (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-sm)',
                background: 'var(--surface)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--space-sm) var(--space-md)',
              }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-sub)', minWidth: 24 }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: 16 }}>{meta.icon}</span>
                <span style={{ flex: 1, fontSize: 14 }}>{card.text}</span>
                <span style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--primary)',
                  background: 'rgba(255,107,53,0.1)',
                  borderRadius: 'var(--radius-full)',
                  padding: '2px 8px',
                }}>
                  {card.timesSelected}回
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

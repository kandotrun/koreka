import { motion } from 'framer-motion';
import type { Card as CardType } from '../../../src/types';

const categoryConfig: Record<string, { name: string; icon: string; color: string; gradient: string }> = {
  adventure: { name: '冒険', icon: '🏔️', color: '#FF6B35', gradient: 'linear-gradient(135deg, #FF6B35 0%, #FF8F5E 100%)' },
  chill: { name: 'まったり', icon: '☕', color: '#4ECDC4', gradient: 'linear-gradient(135deg, #4ECDC4 0%, #7EDDD6 100%)' },
  food: { name: 'グルメ', icon: '🍜', color: '#FFE66D', gradient: 'linear-gradient(135deg, #FFE66D 0%, #FFF0A0 100%)' },
  night: { name: '夜遊び', icon: '🌙', color: '#A855F7', gradient: 'linear-gradient(135deg, #A855F7 0%, #C084FC 100%)' },
  creative: { name: 'クリエイティブ', icon: '🎨', color: '#EC4899', gradient: 'linear-gradient(135deg, #EC4899 0%, #F472B6 100%)' },
  random: { name: 'カオス', icon: '🎲', color: '#EF4444', gradient: 'linear-gradient(135deg, #EF4444 0%, #F87171 100%)' },
};

interface CardProps {
  card: CardType;
  style?: React.CSSProperties;
  onClick?: () => void;
  selected?: boolean;
}

export default function Card({ card, style, onClick, selected }: CardProps) {
  const cat = categoryConfig[card.category] || categoryConfig.adventure;

  return (
    <motion.div
      onClick={onClick}
      style={{
        width: 280,
        aspectRatio: '3 / 4',
        borderRadius: 16,
        background: `${cat.gradient.replace('100%)', '10%)')}, var(--surface)`,
        border: selected
          ? `2px solid ${cat.color}`
          : '1px solid rgba(255,255,255,0.08)',
        boxShadow: selected
          ? `0 0 24px ${cat.color}40`
          : '0 8px 32px rgba(0,0,0,0.4)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 24,
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
        position: 'relative',
        overflow: 'hidden',
        ...style,
      }}
      whileTap={onClick ? { scale: 0.97 } : undefined}
    >
      {/* Category label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 16 }}>{cat.icon}</span>
        <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>{cat.name}</span>
      </div>

      {/* Card text */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 8px',
      }}>
        <p style={{
          fontSize: card.text.length > 15 ? 20 : 24,
          fontWeight: 700,
          textAlign: 'center',
          lineHeight: 1.5,
          color: 'var(--text)',
        }}>
          {card.text}
        </p>
      </div>

      {/* Card number */}
      <div style={{ textAlign: 'right' }}>
        <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>
          #{card.id.split('-').pop()}
        </span>
      </div>
    </motion.div>
  );
}

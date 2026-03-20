import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import Card from '../components/Card';
import type { Card as CardType, PlayerInfo } from '../../../src/types';

const bounceSpring = {
  type: 'spring' as const,
  stiffness: 500,
  damping: 15,
};

function Confetti() {
  const colors = ['#FF6B35', '#E8D44D', '#4ECDC4', '#A855F7', '#EC4899', '#EF4444'];
  const pieces = Array.from({ length: 40 }, (_, i) => ({
    id: i,
    color: colors[i % colors.length],
    left: `${Math.random() * 100}%`,
    delay: Math.random() * 2,
    size: 6 + Math.random() * 8,
    shape: Math.random() > 0.5 ? 'circle' : 'square',
  }));

  return (
    <>
      {pieces.map(p => (
        <div
          key={p.id}
          className="confetti-piece"
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            background: p.color,
            borderRadius: p.shape === 'circle' ? '50%' : '2px',
            animationDelay: `${p.delay}s`,
            animationDuration: `${2 + Math.random() * 2}s`,
          }}
        />
      ))}
    </>
  );
}

export default function Result() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as {
    card: CardType;
    votes: Record<string, string>;
    players: PlayerInfo[];
  } | null;

  if (!state) {
    navigate(`/${code || ''}`);
    return null;
  }

  const { card, votes, players } = state;
  const voteCount = Object.values(votes).filter(v => v === card.id).length;
  const totalPlayers = players.length;

  return (
    <div className="page" style={{ justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
      <Confetti />

      {/* Title */}
      <motion.h1
        initial={{ scale: 0, rotate: -10 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={bounceSpring}
        style={{
          fontSize: 48,
          fontWeight: 900,
          color: 'var(--accent)',
          marginBottom: 'var(--space-xl)',
          textShadow: '0 0 40px rgba(232, 212, 77, 0.3)',
        }}
      >
        これか！
      </motion.h1>

      {/* Result card */}
      <motion.div
        initial={{ rotateY: 90, opacity: 0 }}
        animate={{ rotateY: 0, opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.6, type: 'spring' }}
        style={{ perspective: 1000 }}
      >
        <Card card={card} selected />
      </motion.div>

      {/* Vote count */}
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
        style={{
          marginTop: 'var(--space-lg)',
          fontSize: 16,
          color: 'var(--text-sub)',
        }}
      >
        {voteCount}/{totalPlayers}人が選択 🔥
      </motion.p>

      {/* Actions */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2 }}
        style={{
          display: 'flex',
          gap: 'var(--space-md)',
          marginTop: 'var(--space-xl)',
          width: '100%',
          maxWidth: 320,
        }}
      >
        <button
          className="btn-secondary"
          style={{ flex: 1 }}
          onClick={() => navigate('/')}
        >
          もう一回
        </button>
        <button
          className="btn-primary"
          style={{ flex: 1 }}
          onClick={() => {
            // Future: memory recording
            navigate('/');
          }}
        >
          思い出記録
        </button>
      </motion.div>
    </div>
  );
}

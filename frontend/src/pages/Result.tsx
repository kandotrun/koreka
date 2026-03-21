import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Card from '../components/Card';
import type { Card as CardType, PlayerInfo } from '../../../src/types';
import { sound } from '../lib/sound';
import { useI18n } from '../contexts/I18nContext';

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
  const { t } = useI18n();
  const [showMemoryModal, setShowMemoryModal] = useState(false);
  const [memoryComment, setMemoryComment] = useState('');
  const [memorySaving, setMemorySaving] = useState(false);
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

  const handleSaveMemory = async () => {
    if (!memoryComment.trim() || !code) return;
    setMemorySaving(true);
    try {
      const res = await fetch(`/api/rooms/${code}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: memoryComment.trim() }),
      });
      if (res.ok) {
        setShowMemoryModal(false);
        alert(t('result.saved'));
        navigate('/');
      }
    } catch {
      alert(t('result.save_failed'));
    } finally {
      setMemorySaving(false);
    }
  };

  useEffect(() => {
    sound.play('result');
    // Fire-and-forget: save result card to D1
    if (code && card?.id) {
      fetch(`/api/rooms/${code}/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: card.id }),
      }).catch(() => {});
    }
  }, []);

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
        {t('result.vote_count', voteCount, totalPlayers)}
      </motion.p>

      {/* ChatGPT相談ボタン */}
      <motion.a
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.0 }}
        href={`https://chatgpt.com/?q=${encodeURIComponent(t('result.chatgpt_prompt', card.text))}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          marginTop: 'var(--space-lg)',
          width: '100%',
          maxWidth: 320,
          padding: '14px 20px',
          background: 'linear-gradient(135deg, #10A37F 0%, #1A7F64 100%)',
          color: 'white',
          borderRadius: 'var(--radius-md)',
          fontWeight: 700,
          fontSize: 15,
          textDecoration: 'none',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        {t('result.ask_chatgpt')}
      </motion.a>

      {/* Share button */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2 }}
        onClick={async () => {
          const shareText = t('result.share_text', card.text);
          const shareUrl = 'https://koreka.ninomiya.run';
          if (navigator.share) {
            try {
              await navigator.share({ title: 'これか！', text: shareText, url: shareUrl });
            } catch {
              // user cancelled
            }
          } else {
            await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
            alert(t('result.copied'));
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          marginTop: 'var(--space-md)',
          width: '100%',
          maxWidth: 320,
          padding: '14px 20px',
          background: 'linear-gradient(135deg, #1DA1F2 0%, #0d8ecf 100%)',
          color: 'white',
          borderRadius: 'var(--radius-md)',
          fontWeight: 700,
          fontSize: 15,
          border: 'none',
          cursor: 'pointer',
        }}
      >
        {t('result.share')}
      </motion.button>

      {/* Actions */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4 }}
        style={{
          display: 'flex',
          gap: 'var(--space-md)',
          marginTop: 'var(--space-md)',
          width: '100%',
          maxWidth: 320,
        }}
      >
        <button
          className="btn-secondary"
          style={{ flex: 1 }}
          onClick={() => navigate('/')}
        >
          {t('result.play_again')}
        </button>
        <button
          className="btn-primary"
          style={{ flex: 1 }}
          onClick={() => setShowMemoryModal(true)}
        >
          {t('result.save_memory')}
        </button>
      </motion.div>

      {/* Memory Recording Modal */}
      <AnimatePresence>
        {showMemoryModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowMemoryModal(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100,
              padding: 'var(--space-md)',
            }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--surface)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-xl)',
                width: '100%',
                maxWidth: 360,
              }}
            >
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 'var(--space-md)' }}>
                {t('result.memory_title')}
              </h2>
              <p style={{ fontSize: 14, color: 'var(--text-sub)', marginBottom: 'var(--space-md)' }}>
                {t('result.memory_desc', card.text)}
              </p>
              <textarea
                value={memoryComment}
                onChange={(e) => setMemoryComment(e.target.value)}
                placeholder={t('result.memory_placeholder')}
                maxLength={500}
                style={{
                  width: '100%',
                  minHeight: 100,
                  padding: 'var(--space-sm)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--text-sub)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  fontSize: 14,
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-md)' }}>
                <button
                  className="btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => setShowMemoryModal(false)}
                >
                  {t('common.cancel')}
                </button>
                <button
                  className="btn-primary"
                  style={{ flex: 1 }}
                  disabled={!memoryComment.trim() || memorySaving}
                  onClick={handleSaveMemory}
                >
                  {memorySaving ? t('result.saving') : t('result.save')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

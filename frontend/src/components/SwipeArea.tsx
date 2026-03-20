import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Card as CardType } from '../../../src/types';
import Card from './Card';
import { useSwipe } from '../hooks/useSwipe';
import { sound } from '../lib/sound';

const cardSpring = {
  type: 'spring' as const,
  stiffness: 300,
  damping: 20,
  mass: 0.8,
};

interface SwipeAreaProps {
  cards: CardType[];
  onComplete: (keptCardIds: string[]) => void;
}

export default function SwipeArea({ cards, onComplete }: SwipeAreaProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [keptCards, setKeptCards] = useState<string[]>([]);
  const [exitX, setExitX] = useState(0);

  const currentCard = cards[currentIndex];
  const remaining = cards.length - currentIndex;
  const isLast = currentIndex === cards.length - 1;

  const handleKeep = useCallback(() => {
    if (!currentCard) return;
    sound.play('swipeKeep');
    const newKept = [...keptCards, currentCard.id];
    setKeptCards(newKept);
    setExitX(300);

    if (currentIndex >= cards.length - 1) {
      // All cards swiped
      onComplete(newKept);
    } else {
      setCurrentIndex(i => i + 1);
    }
  }, [currentCard, keptCards, currentIndex, cards.length, onComplete]);

  const handleDiscard = useCallback(() => {
    if (!currentCard) return;
    sound.play('swipeDiscard');
    setExitX(-300);

    // If this is the last card, must keep if no others kept
    if (isLast && keptCards.length === 0) {
      // Force keep the last card
      const newKept = [currentCard.id];
      setKeptCards(newKept);
      onComplete(newKept);
      return;
    }

    if (currentIndex >= cards.length - 1) {
      // Ensure at least 1 card kept
      const finalKept = keptCards.length > 0 ? keptCards : [currentCard.id];
      onComplete(finalKept);
    } else {
      setCurrentIndex(i => i + 1);
    }
  }, [currentCard, keptCards, currentIndex, cards.length, isLast, onComplete]);

  const { x, y, rotation, swiping, direction, bind } = useSwipe({
    threshold: 80,
    onSwipeRight: handleKeep,
    onSwipeLeft: handleDiscard,
  });

  if (!currentCard) return null;

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      position: 'relative',
      touchAction: 'none',
    }}>
      {/* Progress */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        gap: 4,
        padding: '0 16px',
      }}>
        {cards.map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background: i < currentIndex
                ? 'var(--primary)'
                : i === currentIndex
                  ? 'var(--text)'
                  : 'var(--surface)',
              transition: 'background 0.2s',
            }}
          />
        ))}
      </div>

      {/* Swipe indicators */}
      <AnimatePresence>
        {direction === 'right' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'absolute',
              top: 60,
              left: 24,
              background: 'var(--primary)',
              color: 'white',
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              fontWeight: 700,
              fontSize: 18,
              zIndex: 10,
            }}
          >
            やる!
          </motion.div>
        )}
        {direction === 'left' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'absolute',
              top: 60,
              right: 24,
              background: 'rgba(255,255,255,0.1)',
              color: 'var(--text-sub)',
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              fontWeight: 700,
              fontSize: 18,
              zIndex: 10,
            }}
          >
            パス
          </motion.div>
        )}
      </AnimatePresence>

      {/* Card stack */}
      <div style={{ position: 'relative', width: 280, aspectRatio: '3/4' }} {...bind}>
        {/* Next card preview (behind) */}
        {currentIndex + 1 < cards.length && (
          <div style={{
            position: 'absolute',
            top: 8,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            opacity: 0.5,
            transform: 'scale(0.95)',
            pointerEvents: 'none',
          }}>
            <Card card={cards[currentIndex + 1]} />
          </div>
        )}

        {/* Current card */}
        <AnimatePresence mode="popLayout">
          <motion.div
            key={currentCard.id}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{
              x: swiping ? x : 0,
              y: swiping ? y * 0.3 : 0,
              rotate: swiping ? rotation : 0,
              scale: 1,
              opacity: 1,
            }}
            exit={{
              x: exitX,
              opacity: 0,
              rotate: exitX > 0 ? 20 : -20,
              transition: { duration: 0.3 },
            }}
            transition={cardSpring}
            style={{
              position: 'relative',
              zIndex: 2,
            }}
          >
            <Card
              card={currentCard}
              style={{
                boxShadow: direction === 'right'
                  ? '0 0 40px rgba(255,107,53,0.3)'
                  : direction === 'left'
                    ? '0 0 40px rgba(0,0,0,0.5)'
                    : '0 8px 32px rgba(0,0,0,0.4)',
              }}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Hint text */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        width: 280,
        marginTop: 24,
        color: 'var(--text-sub)',
        fontSize: 14,
      }}>
        <span>← やらない</span>
        <span>残り {remaining}/{cards.length}</span>
        <span>やる →</span>
      </div>
    </div>
  );
}

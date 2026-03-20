import { useState, useRef, useCallback } from 'react';

interface SwipeState {
  x: number;
  y: number;
  rotation: number;
  swiping: boolean;
  direction: 'left' | 'right' | null;
}

interface UseSwipeOptions {
  threshold?: number;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}

export function useSwipe(options: UseSwipeOptions = {}) {
  const { threshold = 100, onSwipeLeft, onSwipeRight } = options;
  const [swipeState, setSwipeState] = useState<SwipeState>({
    x: 0,
    y: 0,
    rotation: 0,
    swiping: false,
    direction: null,
  });

  const startPos = useRef({ x: 0, y: 0 });
  const currentPos = useRef({ x: 0, y: 0 });

  const handleStart = useCallback((clientX: number, clientY: number) => {
    startPos.current = { x: clientX, y: clientY };
    currentPos.current = { x: 0, y: 0 };
    setSwipeState(s => ({ ...s, swiping: true }));
  }, []);

  const handleMove = useCallback((clientX: number, clientY: number) => {
    const dx = clientX - startPos.current.x;
    const dy = clientY - startPos.current.y;
    currentPos.current = { x: dx, y: dy };

    const rotation = dx * 0.1;
    const direction = dx > 30 ? 'right' : dx < -30 ? 'left' : null;

    setSwipeState({
      x: dx,
      y: dy,
      rotation,
      swiping: true,
      direction,
    });
  }, []);

  const handleEnd = useCallback(() => {
    const dx = currentPos.current.x;

    if (dx > threshold) {
      onSwipeRight?.();
    } else if (dx < -threshold) {
      onSwipeLeft?.();
    }

    setSwipeState({ x: 0, y: 0, rotation: 0, swiping: false, direction: null });
  }, [threshold, onSwipeLeft, onSwipeRight]);

  const bind = {
    onTouchStart: (e: React.TouchEvent) => {
      const touch = e.touches[0];
      handleStart(touch.clientX, touch.clientY);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const touch = e.touches[0];
      handleMove(touch.clientX, touch.clientY);
    },
    onTouchEnd: () => handleEnd(),
    onMouseDown: (e: React.MouseEvent) => {
      handleStart(e.clientX, e.clientY);
    },
    onMouseMove: (e: React.MouseEvent) => {
      if (!swipeState.swiping) return;
      handleMove(e.clientX, e.clientY);
    },
    onMouseUp: () => handleEnd(),
    onMouseLeave: () => {
      if (swipeState.swiping) handleEnd();
    },
  };

  return { ...swipeState, bind };
}

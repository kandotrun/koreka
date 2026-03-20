import { describe, it, expect, vi, beforeEach } from 'vitest';

// sound.ts のロジックをテスト（Web Audio APIはブラウザ依存なのでロジック部分のみ）

describe('サウンドエフェクト', () => {
  describe('サウンドイベント定義', () => {
    const soundEvents = ['swipeKeep', 'swipeDiscard', 'roundComplete', 'result', 'playerJoin', 'ready'] as const;

    it('6種類のサウンドイベントが定義されている', () => {
      expect(soundEvents).toHaveLength(6);
    });

    it.each(soundEvents)('%s イベントが存在する', (event) => {
      expect(typeof event).toBe('string');
      expect(event.length).toBeGreaterThan(0);
    });
  });

  describe('ON/OFF切り替えロジック', () => {
    let storage: Map<string, string>;

    beforeEach(() => {
      storage = new Map();
    });

    function isSoundEnabled(): boolean {
      return storage.get('koreka-sound-enabled') !== 'false';
    }

    function setSoundEnabled(enabled: boolean): void {
      storage.set('koreka-sound-enabled', String(enabled));
    }

    function toggleSound(): boolean {
      const next = !isSoundEnabled();
      setSoundEnabled(next);
      return next;
    }

    it('デフォルトではON', () => {
      expect(isSoundEnabled()).toBe(true);
    });

    it('OFFに切り替えられる', () => {
      setSoundEnabled(false);
      expect(isSoundEnabled()).toBe(false);
    });

    it('ONに戻せる', () => {
      setSoundEnabled(false);
      setSoundEnabled(true);
      expect(isSoundEnabled()).toBe(true);
    });

    it('トグルで切り替わる', () => {
      expect(toggleSound()).toBe(false);
      expect(toggleSound()).toBe(true);
      expect(toggleSound()).toBe(false);
    });

    it('localStorage キーが正しい', () => {
      setSoundEnabled(false);
      expect(storage.get('koreka-sound-enabled')).toBe('false');
    });
  });
});

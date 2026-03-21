import { describe, it, expect } from 'vitest';
import { translate, LANGS } from '../../frontend/src/lib/i18n';
import type { Lang } from '../../frontend/src/lib/i18n';

describe('i18n', () => {
  describe('translation keys across all languages', () => {
    it('all languages defined in LANGS', () => {
      expect(LANGS).toHaveLength(3);
      const codes = LANGS.map(l => l.code);
      expect(codes).toContain('ja');
      expect(codes).toContain('en');
      expect(codes).toContain('ko');
    });

    it('translate returns correct value for Japanese', () => {
      expect(translate('common.back', 'ja')).toBe('戻る');
      expect(translate('common.cancel', 'ja')).toBe('キャンセル');
      expect(translate('common.error', 'ja')).toBe('エラー');
    });

    it('translate returns correct value for English', () => {
      expect(translate('common.back', 'en')).toBe('Back');
      expect(translate('common.cancel', 'en')).toBe('Cancel');
      expect(translate('common.error', 'en')).toBe('Error');
    });

    it('translate returns correct value for Korean', () => {
      expect(translate('common.back', 'ko')).toBe('뒤로');
      expect(translate('common.cancel', 'ko')).toBe('취소');
      expect(translate('common.error', 'ko')).toBe('오류');
    });
  });

  describe('fallback behavior', () => {
    it('returns key name when translation key does not exist', () => {
      expect(translate('nonexistent.key', 'ja')).toBe('nonexistent.key');
      expect(translate('nonexistent.key', 'en')).toBe('nonexistent.key');
      expect(translate('nonexistent.key', 'ko')).toBe('nonexistent.key');
    });
  });

  describe('interpolation', () => {
    it('replaces {0} with first argument', () => {
      const result = translate('lobby.join_room', 'ja', 'ABCD');
      expect(result).toBe('ルーム ABCD に参加');
    });

    it('replaces {0} in English', () => {
      const result = translate('lobby.join_room', 'en', '1234');
      expect(result).toBe('Join Room 1234');
    });

    it('replaces multiple placeholders {0} and {1}', () => {
      const result = translate('result.vote_count', 'ja', 3, 5);
      expect(result).toBe('3/5人が選択 🔥');
    });

    it('replaces multiple placeholders in English', () => {
      const result = translate('result.vote_count', 'en', 2, 4);
      expect(result).toBe('2/4 players chose this 🔥');
    });

    it('replaces multiple placeholders in Korean', () => {
      const result = translate('result.vote_count', 'ko', 1, 3);
      expect(result).toBe('1/3명이 선택 🔥');
    });
  });

  describe('category translations exist for all languages', () => {
    const categories = ['adventure', 'chill', 'food', 'night', 'creative', 'random', 'spicy', 'trending', 'seasonal'];
    const langs: Lang[] = ['ja', 'en', 'ko'];

    for (const cat of categories) {
      for (const lang of langs) {
        it(`cat.${cat} exists for ${lang}`, () => {
          const result = translate(`cat.${cat}`, lang);
          expect(result).not.toBe(`cat.${cat}`);
          expect(result.length).toBeGreaterThan(0);
        });
      }
    }
  });

  describe('key sections exist for all languages', () => {
    const sampleKeys = [
      'common.back', 'common.loading', 'common.host',
      'home.subtitle', 'home.create_room', 'home.join_code',
      'lobby.room', 'lobby.ready', 'lobby.start_game',
      'game.final_vote', 'game.dealing',
      'result.play_again', 'result.share',
      'admin.title', 'admin.login',
    ];
    const langs: Lang[] = ['ja', 'en', 'ko'];

    for (const key of sampleKeys) {
      for (const lang of langs) {
        it(`${key} exists for ${lang}`, () => {
          const result = translate(key, lang);
          expect(result).not.toBe(key);
        });
      }
    }
  });
});

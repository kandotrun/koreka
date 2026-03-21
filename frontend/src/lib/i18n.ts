export type Lang = 'ja' | 'en' | 'ko';

export const LANGS: { code: Lang; flag: string; label: string }[] = [
  { code: 'ja', flag: '🇯🇵', label: '日本語' },
  { code: 'en', flag: '🇺🇸', label: 'English' },
  { code: 'ko', flag: '🇰🇷', label: '한국어' },
];

const translations: Record<string, Record<Lang, string>> = {
  // ===== Common =====
  'common.back': { ja: '戻る', en: 'Back', ko: '뒤로' },
  'common.cancel': { ja: 'キャンセル', en: 'Cancel', ko: '취소' },
  'common.error': { ja: 'エラー', en: 'Error', ko: '오류' },
  'common.loading': { ja: '読み込み中...', en: 'Loading...', ko: '로딩 중...' },
  'common.guest': { ja: 'ゲスト', en: 'Guest', ko: '게스트' },
  'common.host': { ja: 'ホスト', en: 'Host', ko: '호스트' },

  // ===== Theme =====
  'theme.title': { ja: 'テーマ', en: 'Theme', ko: '테마' },

  // ===== Categories =====
  'cat.adventure': { ja: '冒険', en: 'Adventure', ko: '모험' },
  'cat.chill': { ja: 'まったり', en: 'Chill', ko: '힐링' },
  'cat.food': { ja: 'グルメ', en: 'Food', ko: '맛집' },
  'cat.night': { ja: '夜遊び', en: 'Nightlife', ko: '밤놀이' },
  'cat.creative': { ja: 'クリエイティブ', en: 'Creative', ko: '크리에이티브' },
  'cat.random': { ja: 'カオス', en: 'Random', ko: '랜덤' },
  'cat.spicy': { ja: 'スパイシー', en: 'Spicy', ko: '스파이시' },
  'cat.trending': { ja: '時事ネタ', en: 'Trending', ko: '트렌드' },
  'cat.seasonal': { ja: '季節', en: 'Seasonal', ko: '계절' },

  // ===== Home =====
  'home.subtitle': {
    ja: 'Koreka — みんなの「次どうする？」が決まるゲーム',
    en: 'Koreka — The game that decides "What\'s next?"',
    ko: 'Koreka — 다 같이 "다음 뭐 할까?"를 정하는 게임',
  },
  'home.desc1': { ja: 'カードをスワイプして', en: 'Swipe through cards and', ko: '카드를 스와이프해서' },
  'home.desc_highlight': { ja: 'やりたいこと', en: 'what you want to do', ko: '하고 싶은 것' },
  'home.desc2': { ja: 'を残すだけ。', en: ' — just keep it.', ko: '만 남기면 돼요.' },
  'home.desc3': {
    ja: '最後に残った1枚がみんなの答え。',
    en: 'The last card standing is everyone\'s answer.',
    ko: '마지막에 남은 한 장이 모두의 답.',
  },
  'home.sample_title': { ja: '— お題の例 —', en: '— Sample Topics —', ko: '— 주제 예시 —' },
  'home.step1': { ja: 'ルーム作成', en: 'Create Room', ko: '방 만들기' },
  'home.step2': { ja: 'カード選別', en: 'Pick Cards', ko: '카드 선택' },
  'home.step3': { ja: 'これか！', en: 'Koreka!', ko: '이거다!' },
  'home.create_room': { ja: 'ルームを作る 🎴', en: 'Create Room 🎴', ko: '방 만들기 🎴' },
  'home.join_code': { ja: 'コードで参加', en: 'Join with Code', ko: '코드로 참가' },
  'home.name_label': { ja: 'なまえ', en: 'Name', ko: '이름' },
  'home.name_placeholder': { ja: 'ニックネーム', en: 'Nickname', ko: '닉네임' },
  'home.category_label': { ja: 'カテゴリ', en: 'Categories', ko: '카테고리' },
  'home.deselect_all': { ja: 'すべて解除', en: 'Deselect all', ko: '전체 해제' },
  'home.select_all': { ja: 'すべて選択', en: 'Select all', ko: '전체 선택' },
  'home.no_category_hint': {
    ja: '未選択の場合はすべてのカテゴリから出題されます',
    en: 'All categories will be used if none selected',
    ko: '선택하지 않으면 모든 카테고리에서 출제됩니다',
  },
  'home.room_code_label': { ja: 'ルームコード', en: 'Room Code', ko: '방 코드' },
  'home.create_submit': { ja: 'ルームを作成', en: 'Create Room', ko: '방 만들기' },
  'home.join_submit': { ja: '参加する', en: 'Join', ko: '참가하기' },

  // ===== Lobby =====
  'lobby.room': { ja: 'ルーム', en: 'Room', ko: '방' },
  'lobby.qr_hint': {
    ja: 'QRコードをタップして拡大 · コードを友達にシェアしよう',
    en: 'Tap QR to enlarge · Share the code with friends',
    ko: 'QR 코드를 탭하면 확대 · 코드를 친구에게 공유하세요',
  },
  'lobby.tap_close': { ja: 'タップして閉じる', en: 'Tap to close', ko: '탭하면 닫힘' },
  'lobby.ready': { ja: '準備OK', en: 'Ready', ko: '준비 완료' },
  'lobby.waiting': { ja: '待機中', en: 'Waiting', ko: '대기 중' },
  'lobby.unready': { ja: '待機に戻す', en: 'Not ready', ko: '대기로 변경' },
  'lobby.ready_btn': { ja: '準備OK ✓', en: 'Ready ✓', ko: '준비 완료 ✓' },
  'lobby.start_game': { ja: 'ゲーム開始 ▶', en: 'Start Game ▶', ko: '게임 시작 ▶' },
  'lobby.waiting_all': { ja: '全員の準備を待っています...', en: 'Waiting for everyone...', ko: '모두 준비를 기다리는 중...' },
  'lobby.join_room': { ja: 'ルーム {0} に参加', en: 'Join Room {0}', ko: '방 {0} 에 참가' },
  'lobby.join_btn': { ja: '参加する 🎴', en: 'Join 🎴', ko: '참가하기 🎴' },
  'lobby.go_home': { ja: 'トップに戻る', en: 'Go Home', ko: '홈으로 돌아가기' },
  'lobby.room_full_title': { ja: 'ルームが満員です', en: 'Room is Full', ko: '방이 가득 찼습니다' },
  'lobby.room_full_desc': {
    ja: 'このルームは最大人数（8人）に達しています。',
    en: 'This room has reached the maximum (8 players).',
    ko: '이 방은 최대 인원(8명)에 도달했습니다.',
  },
  'lobby.game_in_progress_title': { ja: 'ゲーム進行中', en: 'Game in Progress', ko: '게임 진행 중' },
  'lobby.game_in_progress_desc': {
    ja: 'このルームではすでにゲームが始まっています。',
    en: 'A game is already underway in this room.',
    ko: '이 방에서는 이미 게임이 시작되었습니다.',
  },

  // ===== Game =====
  'game.final_vote': { ja: '最終投票', en: 'Final Vote', ko: '최종 투표' },
  'game.pick_one': { ja: '1枚だけ選んでください', en: 'Pick just one card', ko: '카드를 하나만 골라주세요' },
  'game.waiting_others': {
    ja: '他のプレイヤーを待っています...',
    en: 'Waiting for other players...',
    ko: '다른 플레이어를 기다리는 중...',
  },
  'game.dealing': { ja: 'カードを配布中...', en: 'Dealing cards...', ko: '카드 배분 중...' },
  'game.selecting': { ja: '{0} が選択中', en: '{0} selecting', ko: '{0} 선택 중' },

  // ===== Result =====
  'result.vote_count': {
    ja: '{0}/{1}人が選択 🔥',
    en: '{0}/{1} players chose this 🔥',
    ko: '{0}/{1}명이 선택 🔥',
  },
  'result.ask_chatgpt': { ja: '🤖 ChatGPTに相談する', en: '🤖 Ask ChatGPT', ko: '🤖 ChatGPT에 물어보기' },
  'result.chatgpt_prompt': {
    ja: '「{0}」をやることになりました！具体的なプラン・準備・おすすめを教えてください。',
    en: 'We decided to do "{0}"! Please give us a concrete plan, preparations, and recommendations.',
    ko: '"{0}"을(를) 하기로 했어요! 구체적인 계획, 준비, 추천을 알려주세요.',
  },
  'result.share': { ja: '📤 結果をシェア', en: '📤 Share Result', ko: '📤 결과 공유' },
  'result.share_text': {
    ja: '「{0}」に決まった！🎴\n\nこれか！ - みんなの「次どうする？」が決まるゲーム',
    en: 'We chose "{0}"! 🎴\n\nKoreka! — The game that decides "What\'s next?"',
    ko: '"{0}"(으)로 결정! 🎴\n\nKoreka! — 다 같이 "다음 뭐 할까?"를 정하는 게임',
  },
  'result.play_again': { ja: 'もう一回', en: 'Play Again', ko: '한 번 더' },
  'result.save_memory': { ja: '思い出記録', en: 'Save Memory', ko: '추억 기록' },
  'result.memory_title': { ja: '思い出を記録', en: 'Save a Memory', ko: '추억 기록하기' },
  'result.memory_desc': {
    ja: '「{0}」の思い出コメントを残そう',
    en: 'Leave a memory comment about "{0}"',
    ko: '"{0}"에 대한 추억 코멘트를 남기세요',
  },
  'result.memory_placeholder': {
    ja: '楽しかった！また来よう...',
    en: 'That was fun! Let\'s do it again...',
    ko: '즐거웠어! 또 하자...',
  },
  'result.saving': { ja: '保存中...', en: 'Saving...', ko: '저장 중...' },
  'result.save': { ja: '保存する', en: 'Save', ko: '저장' },
  'result.saved': { ja: '思い出を保存しました！', en: 'Memory saved!', ko: '추억이 저장되었습니다!' },
  'result.save_failed': { ja: '保存に失敗しました', en: 'Failed to save', ko: '저장에 실패했습니다' },
  'result.copied': { ja: 'コピーしました！', en: 'Copied!', ko: '복사되었습니다!' },

  // ===== Admin =====
  'admin.title': { ja: '管理者ダッシュボード', en: 'Admin Dashboard', ko: '관리자 대시보드' },
  'admin.total_cards': { ja: 'お題カード', en: 'Topic Cards', ko: '주제 카드' },
  'admin.total_rooms': { ja: 'ルーム数', en: 'Rooms', ko: '방 수' },
  'admin.total_memories': { ja: '思い出数', en: 'Memories', ko: '추억 수' },
  'admin.top_cards': { ja: '人気のお題 TOP 20', en: 'Top 20 Popular Topics', ko: '인기 주제 TOP 20' },
  'admin.no_data': { ja: 'まだデータがありません', en: 'No data yet', ko: '아직 데이터가 없습니다' },
  'admin.fetch_error': {
    ja: '統計データの取得に失敗しました',
    en: 'Failed to fetch stats',
    ko: '통계 데이터를 가져오지 못했습니다',
  },
  'admin.times': { ja: '{0}回', en: '{0}x', ko: '{0}회' },
  'admin.login_title': { ja: '管理者ログイン', en: 'Admin Login', ko: '관리자 로그인' },
  'admin.password': { ja: 'パスワード', en: 'Password', ko: '비밀번호' },
  'admin.login': { ja: 'ログイン', en: 'Login', ko: '로그인' },
  'admin.logout': { ja: 'ログアウト', en: 'Logout', ko: '로그아웃' },
  'admin.login_failed': { ja: 'パスワードが正しくありません', en: 'Incorrect password', ko: '비밀번호가 올바르지 않습니다' },
  'admin.auth_error': {
    ja: '認証エラー。再ログインしてください。',
    en: 'Auth error. Please log in again.',
    ko: '인증 오류. 다시 로그인해 주세요.',
  },
};

export function detectLang(): Lang {
  const stored = localStorage.getItem('lang');
  if (stored === 'ja' || stored === 'en' || stored === 'ko') return stored;

  const nav = navigator.language.toLowerCase();
  if (nav.startsWith('ko')) return 'ko';
  if (nav.startsWith('en')) return 'en';
  return 'ja';
}

export function translate(key: string, lang: Lang, ...args: (string | number)[]): string {
  const entry = translations[key];
  if (!entry) return key;
  let text = entry[lang] ?? entry['ja'] ?? key;
  args.forEach((arg, i) => {
    text = text.replace(`{${i}}`, String(arg));
  });
  return text;
}

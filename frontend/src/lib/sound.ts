// Web Audio API サウンドエフェクト
// 外部ファイル不要 - オシレーターで合成

type SoundEvent = 'swipeKeep' | 'swipeDiscard' | 'roundComplete' | 'result' | 'playerJoin' | 'ready';

const STORAGE_KEY = 'koreka-sound-enabled';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

function isSoundEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // localStorage unavailable
  }
}

function playTone(frequency: number, duration: number, type: OscillatorType = 'sine', gain = 0.15): void {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);
  gainNode.gain.setValueAtTime(gain, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  osc.connect(gainNode);
  gainNode.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

function playSequence(notes: { freq: number; delay: number; duration: number; type?: OscillatorType; gain?: number }[]): void {
  for (const note of notes) {
    setTimeout(() => {
      playTone(note.freq, note.duration, note.type || 'sine', note.gain ?? 0.15);
    }, note.delay * 1000);
  }
}

const sounds: Record<SoundEvent, () => void> = {
  swipeKeep: () => {
    // 上昇する明るい音
    playSequence([
      { freq: 523, delay: 0, duration: 0.1, type: 'triangle' },
      { freq: 659, delay: 0.05, duration: 0.15, type: 'triangle' },
    ]);
  },

  swipeDiscard: () => {
    // 下降する低い音
    playTone(330, 0.12, 'triangle', 0.1);
  },

  roundComplete: () => {
    // 3音のファンファーレ
    playSequence([
      { freq: 523, delay: 0, duration: 0.15, type: 'square', gain: 0.08 },
      { freq: 659, delay: 0.12, duration: 0.15, type: 'square', gain: 0.08 },
      { freq: 784, delay: 0.24, duration: 0.25, type: 'square', gain: 0.08 },
    ]);
  },

  result: () => {
    // 華やかなファンファーレ
    playSequence([
      { freq: 523, delay: 0, duration: 0.2, type: 'triangle', gain: 0.12 },
      { freq: 659, delay: 0.15, duration: 0.2, type: 'triangle', gain: 0.12 },
      { freq: 784, delay: 0.3, duration: 0.2, type: 'triangle', gain: 0.12 },
      { freq: 1047, delay: 0.45, duration: 0.4, type: 'triangle', gain: 0.15 },
    ]);
  },

  playerJoin: () => {
    // ポップな参加音
    playSequence([
      { freq: 880, delay: 0, duration: 0.08, type: 'sine', gain: 0.1 },
      { freq: 1100, delay: 0.06, duration: 0.12, type: 'sine', gain: 0.1 },
    ]);
  },

  ready: () => {
    // 確認音
    playTone(740, 0.15, 'sine', 0.12);
  },
};

export const sound = {
  play(event: SoundEvent): void {
    if (!isSoundEnabled()) return;
    try {
      sounds[event]();
    } catch {
      // Audio not available
    }
  },

  get enabled(): boolean {
    return isSoundEnabled();
  },

  toggle(): boolean {
    const next = !isSoundEnabled();
    setSoundEnabled(next);
    return next;
  },

  setEnabled(enabled: boolean): void {
    setSoundEnabled(enabled);
  },
};

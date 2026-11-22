/**
 * Pure Web Audio API singing-bowl chime synthesizer.
 * Zero external audio assets; unlocked inside user tap gesture for iPadOS Safari.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  return audioCtx;
}

/**
 * Call synchronously inside a click/tap handler on iPadOS Safari to unlock audio playback.
 */
export function unlockAudio(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  try {
    // Silent 1-sample buffer unlock for iOS WebKit
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // ignore
  }
}

/**
 * Plays a warm, organic Tibetan/crystal singing-bowl chime.
 * @param variant 'gentle' (Stage 1 notice) | 'grounding' (Stage 2 pause / completion)
 */
export function playSingingBowl(variant: 'gentle' | 'grounding' = 'gentle'): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  const now = ctx.currentTime;
  const master = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(variant === 'gentle' ? 2200 : 1800, now);
  filter.Q.setValueAtTime(0.7, now);

  master.gain.setValueAtTime(0.0001, now);
  master.gain.linearRampToValueAtTime(variant === 'gentle' ? 0.18 : 0.14, now + 0.045);
  master.gain.exponentialRampToValueAtTime(0.0001, now + (variant === 'gentle' ? 3.1 : 3.8));

  master.connect(filter);
  filter.connect(ctx.destination);

  // Warm harmonic partials inspired by a real cast singing bowl
  const baseFreq = variant === 'gentle' ? 396 : 330; // G4-ish warm / E4 grounding
  const partials: Array<{ ratio: number; detune: number; gain: number; decay: number }> = [
    { ratio: 1.0, detune: 0, gain: 0.65, decay: 3.0 },
    { ratio: 1.0035, detune: 2, gain: 0.35, decay: 2.8 }, // subtle organic shimmer beat
    { ratio: 2.756, detune: -3, gain: 0.22, decay: 1.85 }, // authentic singing-bowl overtone
    { ratio: 5.404, detune: 4, gain: 0.06, decay: 0.95 }, // delicate airy ring
  ];

  for (const p of partials) {
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq * p.ratio, now);
    osc.detune.setValueAtTime(p.detune, now);

    oscGain.gain.setValueAtTime(0.0001, now);
    oscGain.gain.linearRampToValueAtTime(p.gain, now + 0.035);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);

    osc.connect(oscGain);
    oscGain.connect(master);

    osc.start(now);
    osc.stop(now + p.decay + 0.1);
  }
}

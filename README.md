# Still

A minimal, calm, **100% on-device** eyebrow-plucking awareness PWA built for iPadOS Safari, iPadOS Chrome, and desktop browsers.

Live PWA: **https://chaverick.github.io/Still/**

## Privacy & Architecture
- **100% Local Vision**: Runs MediaPipe `FaceLandmarker` + `HandLandmarker` (`@mediapipe/tasks-vision`) directly in the browser using locally bundled `public/models/*.task` and `public/wasm/*`.
- **Zero Cloud Calls**: No video frames, landmarks, notes, or telemetry ever leave your device.
- **Offline-Ready PWA**: Service worker (`public/sw.js`) caches the app shell, WASM runtime, and `.task` models locally.

## iPadOS Safari Engineering
- Calls `getUserMedia()` and unlocks Web Audio **immediately on tap** before loading vision models so Safari never drops the user gesture.
- Keeps `<video autoplay playsinline muted>` mounted at `2px × 2px` with `opacity: 0.001` (never hidden/`display: none`) so WebKit never pauses frame decoding.
- Runs a battery-friendly **4 FPS** detection loop with an **eye-width normalized eyebrow halo** and a **1.5-second face occlusion cache** (maintaining the brow zone even when a hand blocks your face).
- Automatic **GPU → CPU** delegate fallback and **Screen Wake Lock** with `visibilitychange` re-acquisition.

## Gentle Awareness & HRT
- **Stage 1 (~1.2s dwell)**: Warm peripheral screen-edge glow + Web Audio singing-bowl chime with a 5-second auto-catch when your hand lowers.
- **Stage 2 (~2.6s dwell)**: Calm 60-second Habit Reversal Training (HRT) competing-response pause sheet with auto-catch, compassionate **Grace recovery**, and **False alarm** dismissal.
- **Welcome Back Check-in**: Gentle check-in after 5-minute walks or stepping away.
- **Calibration & Preview**: Expandable privacy-first **Silhouette** or mirrored **Camera** preview with dwell & brow-zone sliders.

## Development

```bash
npm install
npm run dev
npm run build
```

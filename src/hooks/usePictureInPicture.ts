import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDuration } from '../lib/storage';
import type { EngineStatus, PiPKind, ThemeMode } from '../types';

interface DocumentPiPApi {
  requestWindow: (opts?: { width?: number; height?: number }) => Promise<Window>;
  window?: Window | null;
}

interface WebKitVideoElement extends HTMLVideoElement {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitPresentationMode?: string;
}

export interface PipCanvasState {
  theme: ThemeMode;
  status: EngineStatus;
  calmSeconds: number;
  urgesRedirected: number;
  handInZone: boolean;
  stage1Glow: boolean;
  stage2AlertOpen: boolean;
  faceState: 'detected' | 'cached' | 'away';
  sideAngle: boolean;
  cameraState: 'live' | 'muted' | 'ended';
  fps: number;
  dwellSec: number;
  stage2DwellSec: number;
}

export function usePictureInPicture(
  canvasState: PipCanvasState,
  cameraVideoRef?: React.RefObject<HTMLVideoElement | null>
) {
  const [pipKind, setPipKind] = useState<PiPKind>('none');
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);
  const [pipError, setPipError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activePipVideoElRef = useRef<WebKitVideoElement | null>(null);
  const stateRef = useRef(canvasState);
  stateRef.current = canvasState;

  const isSupported =
    typeof window !== 'undefined' &&
    ('documentPictureInPicture' in window ||
      (typeof document !== 'undefined' &&
        (document.pictureInPictureEnabled ||
          typeof (HTMLVideoElement.prototype as WebKitVideoElement)
            .webkitSetPresentationMode === 'function')));

  const drawCanvasFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const s = stateRef.current;
    const w = canvas.width;
    const h = canvas.height;
    const isDark = s.theme === 'dark';
    const isRunning = s.status === 'running';
    const camPausedByOs = isRunning && s.cameraState !== 'live';
    const isAlert = s.stage2AlertOpen;
    const isStage1 = !camPausedByOs && (s.stage1Glow || s.handInZone);

    const t = performance.now() / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * (isAlert ? 3.2 : 2.0));

    ctx.fillStyle = isDark ? '#1A1917' : '#FAF9F5';
    ctx.fillRect(0, 0, w, h);

    if (isAlert || isStage1) {
      const grad = ctx.createRadialGradient(w / 2, h / 2, 16, w / 2, h / 2, w * 0.65);
      const alpha = isAlert ? 0.34 + 0.22 * pulse : 0.16 + 0.1 * pulse;
      grad.addColorStop(0, `rgba(232, 150, 74, ${alpha.toFixed(3)})`);
      grad.addColorStop(1, 'rgba(201, 100, 66, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.strokeStyle = isAlert
        ? `rgba(236, 156, 78, ${(0.72 + 0.28 * pulse).toFixed(3)})`
        : `rgba(217, 130, 68, ${(0.45 + 0.25 * pulse).toFixed(3)})`;
      ctx.lineWidth = isAlert ? 14 : 8;
      ctx.strokeRect(
        ctx.lineWidth / 2,
        ctx.lineWidth / 2,
        w - ctx.lineWidth,
        h - ctx.lineWidth
      );
      ctx.restore();
    }

    const ink = isDark ? '#F2EFE8' : '#1F1E1C';
    const inkMuted = isDark ? '#B2ACA1' : '#5C5952';
    const accent = isDark ? '#D97757' : '#C96442';
    const sage = isDark ? '#7DA388' : '#587B64';

    const orbX = 34;
    const orbY = 36;
    const orbColor = camPausedByOs
      ? accent
      : isAlert || isStage1
        ? '#E8964A'
        : isRunning && s.faceState !== 'away'
          ? sage
          : inkMuted;

    if (isAlert || isStage1 || (isRunning && !camPausedByOs)) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(orbX, orbY, isAlert ? 16 + 4 * pulse : 11, 0, Math.PI * 2);
      ctx.fillStyle =
        isAlert || isStage1
          ? 'rgba(232, 150, 74, 0.32)'
          : 'rgba(88, 123, 100, 0.2)';
      ctx.fill();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(orbX, orbY, 6, 0, Math.PI * 2);
    ctx.fillStyle = orbColor;
    ctx.fill();

    ctx.font = '500 20px Georgia, serif';
    ctx.fillStyle = ink;
    ctx.fillText('Still', 52, 43);

    // Real live diagnostic badge in top-right (never hardcoded!)
    const rightBadge = !isRunning
      ? 'Paused'
      : camPausedByOs
        ? 'Camera paused by OS'
        : `${s.fps.toFixed(1)} FPS · ${
            s.faceState === 'away'
              ? 'No face'
              : s.faceState === 'cached'
                ? 'Cached'
                : s.sideAngle
                  ? 'Side angle'
                  : 'Face locked'
          }`;

    ctx.font = '500 13px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = camPausedByOs ? accent : inkMuted;
    ctx.textAlign = 'right';
    ctx.fillText(rightBadge, w - 28, 41);
    ctx.textAlign = 'left';

    const title = camPausedByOs
      ? 'Camera paused by iPadOS'
      : isAlert
        ? 'Gentle pause — hands down.'
        : isStage1
          ? 'Hand near zone…'
          : !isRunning
            ? 'Session paused'
            : s.faceState === 'away'
              ? 'Face not in camera view'
              : 'Hands at ease';

    ctx.font = '400 28px Georgia, serif';
    ctx.fillStyle = camPausedByOs || isAlert ? accent : ink;
    ctx.fillText(title, 28, 114);

    const sub = camPausedByOs
      ? 'Keep Safari in Split View / Slide Over for live camera'
      : isAlert
        ? 'Rest palms flat for 60s · tap Still to respond'
        : isStage1
          ? `Dwell ${s.dwellSec.toFixed(1)}s · lower hand to auto-catch`
          : !isRunning
            ? 'Tap Begin session in Still to watch'
            : s.faceState === 'away'
              ? 'Angle your iPad slightly closer toward your face'
              : s.sideAngle
                ? 'Side-angle boost active · watching gently'
                : 'Watching locally in Picture-in-Picture';

    ctx.font = '400 14.5px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = inkMuted;
    ctx.fillText(sub, 28, 146);

    // Live dwell progress bar right on the PiP card
    const barX = 28;
    const barY = 166;
    const barW = w - 56;
    const barH = 6;
    const dwellPct = Math.min(1, s.dwellSec / Math.max(0.5, s.stage2DwellSec));
    ctx.fillStyle = isDark ? 'rgba(242,239,232,0.1)' : 'rgba(31,30,28,0.08)';
    ctx.fillRect(barX, barY, barW, barH);
    if (dwellPct > 0.01) {
      ctx.fillStyle = accent;
      ctx.fillRect(barX, barY, Math.round(barW * dwellPct), barH);
    }

    ctx.strokeStyle = isDark ? 'rgba(242,239,232,0.12)' : 'rgba(31,30,28,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(28, h - 72);
    ctx.lineTo(w - 28, h - 72);
    ctx.stroke();

    ctx.font = '500 12px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = inkMuted;
    ctx.fillText('CALM TODAY', 28, h - 46);
    ctx.fillText('REDIRECTED', 210, h - 46);

    ctx.font = '400 24px Georgia, serif';
    ctx.fillStyle = ink;
    ctx.fillText(formatDuration(s.calmSeconds), 28, h - 18);
    ctx.fillText(String(s.urgesRedirected), 210, h - 18);
  }, []);

  /**
   * Pre-warm the Canvas -> MediaStream -> <video> pipeline BEFORE the user taps "Float PiP"
   * so iPadOS / macOS Safari already has readyState >= 2 and can enter PiP SYNCHRONOUSLY
   * inside the tap gesture without losing Safari's user-activation token.
   */
  const primeCanvasVideo = useCallback(() => {
    const canvas = canvasRef.current;
    const video = pipVideoRef.current as WebKitVideoElement | null;
    if (!canvas || !video) return;

    drawCanvasFrame();

    if (!streamRef.current && typeof canvas.captureStream === 'function') {
      try {
        streamRef.current = canvas.captureStream(10);
      } catch {
        try {
          streamRef.current = canvas.captureStream();
        } catch {
          return;
        }
      }
    }

    if (streamRef.current && video.srcObject !== streamRef.current) {
      video.srcObject = streamRef.current;
    }

    video.muted = true;
    video.playsInline = true;
    video.setAttribute('webkit-playsinline', 'true');
    video.setAttribute('playsinline', 'true');

    if (video.paused) {
      video.play().catch(() => {});
    }
  }, [drawCanvasFrame]);

  // Pre-warm on mount + first pointer gesture (handles Safari autoplay policy cleanly)
  useEffect(() => {
    if ('documentPictureInPicture' in window) return;

    primeCanvasVideo();

    const onFirstTouch = () => {
      primeCanvasVideo();
    };
    window.addEventListener('pointerdown', onFirstTouch, { passive: true, once: true });

    // Light keep-alive frame every 1s so captureStream stays alive & readyState >= 2
    const keepAlive = window.setInterval(() => {
      if (streamRef.current) {
        drawCanvasFrame();
      }
    }, 1000);

    return () => {
      window.removeEventListener('pointerdown', onFirstTouch);
      window.clearInterval(keepAlive);
    };
  }, [drawCanvasFrame, primeCanvasVideo]);

  // Smooth 5 FPS canvas refresh while Video PiP is actively floating
  useEffect(() => {
    if (pipKind !== 'video') return;
    drawCanvasFrame();
    const timer = window.setInterval(drawCanvasFrame, 200);
    return () => window.clearInterval(timer);
  }, [pipKind, drawCanvasFrame]);

  // Sync theme attribute on Document PiP window whenever theme changes
  useEffect(() => {
    if (pipWindow && !pipWindow.closed) {
      pipWindow.document.documentElement.setAttribute('data-theme', canvasState.theme);
    }
  }, [pipWindow, canvasState.theme]);

  const attachLeaveListeners = useCallback((video: WebKitVideoElement) => {
    activePipVideoElRef.current = video;

    const onLeave = () => {
      setPipKind('none');
      activePipVideoElRef.current = null;
      video.removeEventListener('leavepictureinpicture', onLeave);
    };
    video.addEventListener('leavepictureinpicture', onLeave);

    const onWebKitChange = () => {
      if (video.webkitPresentationMode !== 'picture-in-picture') {
        setPipKind('none');
        activePipVideoElRef.current = null;
        video.removeEventListener('webkitpresentationmodechanged', onWebKitChange);
      }
    };
    video.addEventListener('webkitpresentationmodechanged', onWebKitChange);
  }, []);

  /**
   * Attempts to enter native video PiP SYNCHRONOUSLY on a ready video element.
   * Prefers Safari WebKit presentation mode on iPadOS/macOS Safari, then W3C requestPictureInPicture.
   */
  const tryEnterVideoPiPSync = useCallback(
    async (video: WebKitVideoElement): Promise<{ ok: boolean; error?: string }> => {
      // 1. Safari / iPadOS WebKit API (must run synchronously inside tap gesture)
      if (
        typeof video.webkitSupportsPresentationMode === 'function' &&
        typeof video.webkitSetPresentationMode === 'function' &&
        video.webkitSupportsPresentationMode('picture-in-picture')
      ) {
        try {
          attachLeaveListeners(video);
          video.webkitSetPresentationMode('picture-in-picture');
          return { ok: true };
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      // 2. Standard W3C Picture-in-Picture API
      if (typeof video.requestPictureInPicture === 'function') {
        try {
          attachLeaveListeners(video);
          await video.requestPictureInPicture();
          return { ok: true };
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      return { ok: false, error: 'PiP API not exposed on this video element' };
    },
    [attachLeaveListeners]
  );

  const closePiP = useCallback(async () => {
    setPipError(null);
    if (pipWindow && !pipWindow.closed) {
      pipWindow.close();
    }
    setPipWindow(null);
    setPipContainer(null);

    if (document.pictureInPictureElement) {
      try {
        await document.exitPictureInPicture();
      } catch {
        // ignore
      }
    }
    const activeVid =
      activePipVideoElRef.current ?? (pipVideoRef.current as WebKitVideoElement | null);
    if (activeVid?.webkitPresentationMode === 'picture-in-picture') {
      try {
        activeVid.webkitSetPresentationMode?.('inline');
      } catch {
        // ignore
      }
    }
    activePipVideoElRef.current = null;
    setPipKind('none');
  }, [pipWindow]);

  const openPiP = useCallback(async () => {
    setPipError(null);

    // 1. Desktop Chrome / Edge: Document Picture-in-Picture (interactive mini HTML window)
    const docPiP = (window as unknown as { documentPictureInPicture?: DocumentPiPApi })
      .documentPictureInPicture;

    if (docPiP?.requestWindow) {
      try {
        const win = await docPiP.requestWindow({ width: 344, height: 310 });
        win.document.documentElement.setAttribute('data-theme', stateRef.current.theme);
        win.document.title = 'Still · Floating';

        for (const sheet of Array.from(document.styleSheets)) {
          try {
            if (sheet.href) {
              const link = win.document.createElement('link');
              link.rel = 'stylesheet';
              link.href = sheet.href;
              win.document.head.appendChild(link);
            } else if (sheet.cssRules) {
              const style = win.document.createElement('style');
              style.textContent = Array.from(sheet.cssRules)
                .map((r) => r.cssText)
                .join('\n');
              win.document.head.appendChild(style);
            }
          } catch {
            if (sheet.href) {
              const link = win.document.createElement('link');
              link.rel = 'stylesheet';
              link.href = sheet.href;
              win.document.head.appendChild(link);
            }
          }
        }

        const root = win.document.createElement('div');
        root.className = 'pip-doc-root';
        win.document.body.innerHTML = '';
        win.document.body.appendChild(root);

        win.addEventListener('pagehide', () => {
          setPipWindow(null);
          setPipContainer(null);
          setPipKind('none');
        });

        setPipWindow(win);
        setPipContainer(root);
        setPipKind('document');
        return;
      } catch {
        // Fall through to Video PiP
      }
    }

    // 2. Safari / iPadOS: Synchronous Video PiP on pre-warmed Canvas stream
    const pipVideo = pipVideoRef.current as WebKitVideoElement | null;
    if (pipVideo) {
      // Ensure frame is freshly drawn & playback started WITHOUT awaiting before PiP call!
      primeCanvasVideo();

      if (pipVideo.readyState >= 1) {
        const res = await tryEnterVideoPiPSync(pipVideo);
        if (res.ok) {
          setPipKind('video');
          return;
        }
      }
    }

    // 3. Fallback for iPadOS builds that disallow canvas.captureStream PiP:
    //    Enter PiP directly on the live front-camera <video> element if a session is running!
    const camVideo = cameraVideoRef?.current as WebKitVideoElement | null;
    if (camVideo && camVideo.readyState >= 1 && camVideo.srcObject) {
      const camRes = await tryEnterVideoPiPSync(camVideo);
      if (camRes.ok) {
        setPipKind('video');
        return;
      }
    }

    // 4. If canvas video was cold (readyState === 0 on first tap), wait briefly for metadata
    //    and prompt a second tap so Safari gets a fresh synchronous gesture with readyState >= 2.
    if (pipVideo && pipVideo.readyState === 0) {
      primeCanvasVideo();
      setPipError(
        'Picture-in-Picture is now warmed up — tap "Float PiP" one more time to pop it out.'
      );
      return;
    }

    // 5. Final clear diagnostic message tailored to iPadOS Chrome vs Safari
    const ua = navigator.userAgent;
    const isCriOS = /CriOS/i.test(ua);
    if (isCriOS) {
      setPipError(
        'Chrome on iPadOS restricts programmatic web PiP. Open Still in Safari on iPad (or use iPad Split View / Slide Over) to float Still beside other apps.'
      );
    } else {
      setPipError(
        'This browser blocked floating PiP. On iPadOS Safari, make sure Settings → Multitasking & Gestures → Picture in Picture is on, or start a session first and try again (Split View / Slide Over also keeps Still visible).'
      );
    }
  }, [cameraVideoRef, primeCanvasVideo, tryEnterVideoPiPSync]);

  const togglePiP = useCallback(async () => {
    if (pipKind !== 'none') {
      await closePiP();
    } else {
      await openPiP();
    }
  }, [closePiP, openPiP, pipKind]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop();
      }
    };
  }, []);

  return {
    pipKind,
    pipActive: pipKind !== 'none',
    pipContainer,
    pipError,
    isSupported,
    canvasRef,
    pipVideoRef,
    primeCanvasVideo,
    togglePiP,
    closePiP,
  };
}

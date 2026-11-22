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
}

export function usePictureInPicture(canvasState: PipCanvasState) {
  const [pipKind, setPipKind] = useState<PiPKind>('none');
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);
  const [pipError, setPipError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
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
    const isAlert = s.stage2AlertOpen;
    const isStage1 = s.stage1Glow || s.handInZone;

    // Pulse phase for luminous glowing light animation
    const t = performance.now() / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * (isAlert ? 3.2 : 2.0));

    // Base warm paper / dark editorial background
    ctx.fillStyle = isDark ? '#1A1917' : '#FAF9F5';
    ctx.fillRect(0, 0, w, h);

    // Prominent glowing light halo on Stage 2 or Stage 1
    if (isAlert || isStage1) {
      const grad = ctx.createRadialGradient(w / 2, h / 2, 16, w / 2, h / 2, w * 0.65);
      const alpha = isAlert ? 0.34 + 0.22 * pulse : 0.16 + 0.1 * pulse;
      grad.addColorStop(0, `rgba(232, 150, 74, ${alpha.toFixed(3)})`);
      grad.addColorStop(1, 'rgba(201, 100, 66, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Glowing border rim
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

    // Top-left glowing status orb + brand
    const orbX = 34;
    const orbY = 36;
    const orbColor = isAlert || isStage1 ? '#E8964A' : s.status === 'running' ? sage : inkMuted;

    if (isAlert || isStage1 || s.status === 'running') {
      ctx.save();
      ctx.beginPath();
      ctx.arc(orbX, orbY, isAlert ? 16 + 4 * pulse : 11, 0, Math.PI * 2);
      ctx.fillStyle = isAlert || isStage1 ? 'rgba(232, 150, 74, 0.32)' : 'rgba(88, 123, 100, 0.2)';
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

    // Right badge
    ctx.font = '500 13px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = inkMuted;
    ctx.textAlign = 'right';
    ctx.fillText(
      s.status === 'running' ? 'Local · 4 FPS' : 'Paused',
      w - 28,
      41
    );
    ctx.textAlign = 'left';

    // Main message
    const title = isAlert
      ? 'Gentle pause — hands down.'
      : isStage1
        ? 'Hand near zone…'
        : s.status !== 'running'
          ? 'Session paused'
          : s.faceState === 'away'
            ? 'Waiting quietly'
            : 'Hands at ease';

    ctx.font = '400 30px Georgia, serif';
    ctx.fillStyle = isAlert ? accent : ink;
    ctx.fillText(title, 28, 122);

    const sub = isAlert
      ? 'Rest palms flat for 60s · return to respond'
      : isStage1
        ? 'Lower hand gently to auto-catch'
        : s.status === 'running'
          ? 'Watching locally in Picture-in-Picture'
          : 'Open Still to begin watching';

    ctx.font = '400 15px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = inkMuted;
    ctx.fillText(sub, 28, 154);

    // Bottom hairline & calm summary
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

  // Keep Canvas Video PiP redrawing smoothly while active
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
    const vid = pipVideoRef.current as WebKitVideoElement | null;
    if (vid?.webkitPresentationMode === 'picture-in-picture') {
      try {
        vid.webkitSetPresentationMode?.('inline');
      } catch {
        // ignore
      }
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    setPipKind('none');
  }, [pipWindow]);

  const openPiP = useCallback(async () => {
    setPipError(null);

    // 1. Prefer Document Picture-in-Picture (Chrome / Edge desktop) for full interactive mini-window
    const docPiP = (window as unknown as { documentPictureInPicture?: DocumentPiPApi })
      .documentPictureInPicture;

    if (docPiP?.requestWindow) {
      try {
        const win = await docPiP.requestWindow({ width: 344, height: 310 });
        win.document.documentElement.setAttribute('data-theme', stateRef.current.theme);
        win.document.title = 'Still · Floating';

        // Copy stylesheets into PiP window so warm paper / dark editorial theme matches 100%
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
            // Cross-origin stylesheet (Google Fonts) -> copy <link> directly
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
        // Fall through to Canvas Video PiP if Document PiP was blocked or unavailable
      }
    }

    // 2. Fallback: Canvas-streamed Video PiP (works on iPadOS Safari, macOS Safari, Firefox)
    const canvas = canvasRef.current;
    const video = pipVideoRef.current as WebKitVideoElement | null;
    if (!canvas || !video) {
      setPipError('Picture-in-Picture is not supported in this browser.');
      return;
    }

    try {
      drawCanvasFrame();
      if (!streamRef.current && typeof canvas.captureStream === 'function') {
        streamRef.current = canvas.captureStream(8);
      }
      if (!streamRef.current) {
        setPipError('This browser does not support floating Picture-in-Picture.');
        return;
      }

      video.srcObject = streamRef.current;
      video.muted = true;
      video.playsInline = true;
      await video.play();

      const onLeave = () => {
        setPipKind('none');
        video.removeEventListener('leavepictureinpicture', onLeave);
      };
      video.addEventListener('leavepictureinpicture', onLeave);

      if (typeof video.requestPictureInPicture === 'function') {
        await video.requestPictureInPicture();
        setPipKind('video');
        return;
      }

      if (
        typeof video.webkitSupportsPresentationMode === 'function' &&
        video.webkitSupportsPresentationMode('picture-in-picture') &&
        typeof video.webkitSetPresentationMode === 'function'
      ) {
        const onWebKitChange = () => {
          if (video.webkitPresentationMode !== 'picture-in-picture') {
            setPipKind('none');
            video.removeEventListener('webkitpresentationmodechanged', onWebKitChange);
          }
        };
        video.addEventListener('webkitpresentationmodechanged', onWebKitChange);
        video.webkitSetPresentationMode('picture-in-picture');
        setPipKind('video');
        return;
      }

      setPipError('Picture-in-Picture is unavailable in this browser.');
    } catch {
      setPipError(
        'Could not open Picture-in-Picture. On iPadOS, Split View or Slide Over also keeps Still visible.'
      );
    }
  }, [drawCanvasFrame]);

  const togglePiP = useCallback(async () => {
    if (pipKind !== 'none') {
      await closePiP();
    } else {
      await openPiP();
    }
  }, [closePiP, openPiP, pipKind]);

  // Cleanup on unmount
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
    togglePiP,
    closePiP,
  };
}

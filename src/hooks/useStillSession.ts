import { useCallback, useEffect, useRef, useState } from 'react';
import { playSingingBowl, unlockAudio } from '../lib/audio';
import { checkModelsCached, LocalVisionEngine } from '../lib/vision';
import { WakeLockController } from '../lib/wakeLock';
import type {
  EngineStatus,
  FrameGeometry,
  Stage1AutoCatch,
  StillSettings,
  VisionDiagnostics,
  WelcomeBackPrompt,
} from '../types';

const TARGET_INTERVAL_MS = 250; // 4 FPS loop
const HAND_FLICKER_HOLD_MS = 380; // tolerate a brief 1-frame side-angle drop without losing dwell
const CAMERA_STALL_MS = 2600; // flag if camera stops advancing frames for > 2.6s
const STAGE1_AUTOCATCH_MS = 5000; // 5s auto-catch window after hand lowers
const AWAY_PAUSE_CALM_MS = 30_000; // stop ticking calm time after 30s without face
const WELCOME_BACK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes stepped away / walk

export interface WhisperToast {
  id: number;
  message: string;
  undoEventId?: string;
}

interface UseStillSessionOptions {
  settings: StillSettings;
  onAddCalmSecond: () => void;
  onStage1AutoCaught: () => string;
  onStage2Triggered: () => void;
  pauseSheetOpen: boolean;
  pipActive: boolean;
  pipWindow: Window | null;
}

export function useStillSession({
  settings,
  onAddCalmSecond,
  onStage1AutoCaught,
  onStage2Triggered,
  pauseSheetOpen,
  pipActive,
  pipWindow,
}: UseStillSessionOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<LocalVisionEngine | null>(null);
  const wakeLockRef = useRef<WakeLockController | null>(null);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pauseSheetOpenRef = useRef(pauseSheetOpen);
  pauseSheetOpenRef.current = pauseSheetOpen;
  const pipActiveRef = useRef(pipActive);
  pipActiveRef.current = pipActive;
  const onAddCalmSecondRef = useRef(onAddCalmSecond);
  onAddCalmSecondRef.current = onAddCalmSecond;
  const onStage1AutoCaughtRef = useRef(onStage1AutoCaught);
  onStage1AutoCaughtRef.current = onStage1AutoCaught;
  const onStage2TriggeredRef = useRef(onStage2Triggered);
  onStage2TriggeredRef.current = onStage2Triggered;

  const [status, setStatus] = useState<EngineStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [edgeGlowActive, setEdgeGlowActive] = useState(false);
  const [dwellSec, setDwellSec] = useState(0);
  const [stage1AutoCatch, setStage1AutoCatch] = useState<Stage1AutoCatch | null>(null);
  const [welcomeBack, setWelcomeBack] = useState<WelcomeBackPrompt | null>(null);
  const [whisper, setWhisper] = useState<WhisperToast | null>(null);
  const [frameGeometry, setFrameGeometry] = useState<FrameGeometry | null>(null);
  const [diagnostics, setDiagnostics] = useState<VisionDiagnostics>({
    delegate: null,
    fps: 0,
    faceState: 'away',
    sideAngle: false,
    cameraState: 'ended',
    cameraStalled: false,
    detectCount: 0,
    handsCount: 0,
    modelsCached: false,
    wakeLockActive: false,
  });

  // Mutable loop state refs
  const runningRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const rvfcRef = useRef<number | null>(null);
  const lastDetectMsRef = useRef(0);
  const lastHandInZoneMsRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const lastFrameAdvanceMsRef = useRef(0);
  const detectCountRef = useRef(0);
  const dwellRef = useRef(0);
  const stage1FiredRef = useRef(false);
  const stage1StartedAtRef = useRef(0);
  const stage1ClearedAtRef = useRef<number | null>(null);
  const lastFaceSeenMsRef = useRef<number>(Date.now());
  const awaySinceMsRef = useRef<number | null>(null);
  const hiddenAtMsRef = useRef<number | null>(null);
  const fpsSamplesRef = useRef<number[]>([]);
  const testGlowTimerRef = useRef<number | null>(null);
  const whisperTimerRef = useRef<number | null>(null);
  const welcomeBackRef = useRef<WelcomeBackPrompt | null>(null);
  welcomeBackRef.current = welcomeBack;

  const showWhisper = useCallback((message: string, undoEventId?: string, durationMs = 5500) => {
    if (whisperTimerRef.current) {
      window.clearTimeout(whisperTimerRef.current);
    }
    setWhisper({ id: Date.now(), message, undoEventId });
    whisperTimerRef.current = window.setTimeout(() => {
      setWhisper(null);
      whisperTimerRef.current = null;
    }, durationMs);
  }, []);

  const dismissWhisper = useCallback(() => {
    if (whisperTimerRef.current) {
      window.clearTimeout(whisperTimerRef.current);
      whisperTimerRef.current = null;
    }
    setWhisper(null);
  }, []);

  // Check offline cache status on mount
  useEffect(() => {
    let active = true;
    const refreshCache = async () => {
      const cached = await checkModelsCached();
      if (active) {
        setDiagnostics((d) => ({ ...d, modelsCached: cached }));
      }
    };
    void refreshCache();
    const timer = window.setTimeout(refreshCache, 4000);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  // Initialize WakeLockController once
  useEffect(() => {
    const controller = new WakeLockController((wakeLockActive) => {
      setDiagnostics((d) => ({ ...d, wakeLockActive }));
    });
    wakeLockRef.current = controller;
    return () => {
      controller.dispose();
      wakeLockRef.current = null;
    };
  }, []);

  const stopCameraTracks = useCallback(() => {
    const video = videoRef.current;
    if (video && rvfcRef.current !== null && video.cancelVideoFrameCallback) {
      try {
        video.cancelVideoFrameCallback(rvfcRef.current);
      } catch {
        // ignore
      }
      rvfcRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.onpause = null;
      videoRef.current.srcObject = null;
    }
  }, []);

  const resetDwellState = useCallback(() => {
    dwellRef.current = 0;
    stage1FiredRef.current = false;
    stage1StartedAtRef.current = 0;
    stage1ClearedAtRef.current = null;
    setDwellSec(0);
    setStage1AutoCatch(null);
    setEdgeGlowActive(false);
  }, []);

  const stopSession = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    stopCameraTracks();
    engineRef.current?.resetCache();
    void wakeLockRef.current?.disable();
    resetDwellState();
    setFrameGeometry(null);
    setStatus('idle');
    setErrorMessage(null);
    setDiagnostics((d) => ({
      ...d,
      fps: 0,
      faceState: 'away',
      sideAngle: false,
      cameraState: 'ended',
      cameraStalled: false,
      handsCount: 0,
    }));
  }, [resetDwellState, stopCameraTracks]);

  const stepDetection = useCallback(() => {
    if (!runningRef.current) return;

    const now = performance.now();
    const wallNow = Date.now();

    if (now - lastDetectMsRef.current < TARGET_INTERVAL_MS) {
      return;
    }

    const prevDetect = lastDetectMsRef.current || now - TARGET_INTERVAL_MS;
    const dt = Math.min(Math.max((now - prevDetect) / 1000, 0.05), 1.2);
    lastDetectMsRef.current = now;

    const track = streamRef.current?.getVideoTracks()[0];
    const liveCamState: 'live' | 'muted' | 'ended' =
      !track || track.readyState !== 'live'
        ? 'ended'
        : track.muted
          ? 'muted'
          : 'live';

    if (liveCamState !== 'live') {
      setDiagnostics((d) => ({
        ...d,
        fps: 0,
        cameraState: liveCamState,
        cameraStalled: true,
      }));
      return;
    }

    const video = videoRef.current;
    const engine = engineRef.current;
    const s = settingsRef.current;

    if (!video || !engine || !engine.isReady) return;

    // CRITICAL iPadOS Safari PiP Fix:
    // Entering Picture-in-Picture on the secondary PiP <video> causes Safari WebKit to pause
    // other <video> elements on the page! Auto-resume the camera <video> immediately if paused.
    if (video.paused && runningRef.current) {
      video.play().catch(() => {});
    }

    // Track whether video.currentTime is actually advancing (detects silent OS camera freezes)
    if (video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      lastFrameAdvanceMsRef.current = now;
    }
    const cameraStalled =
      lastFrameAdvanceMsRef.current > 0 &&
      now - lastFrameAdvanceMsRef.current > CAMERA_STALL_MS;

    if (cameraStalled) {
      setDiagnostics((d) => ({
        ...d,
        fps: 0,
        cameraState: 'live',
        cameraStalled: true,
      }));
      return;
    }

    const frame = engine.detectFrame(
      video,
      {
        zoneScale: s.zoneScale,
        activeZones: s.activeZones,
        pinchFilterEnabled: s.pinchFilterEnabled,
      },
      now
    );

    if (!frame) return;

    detectCountRef.current += 1;

    // Measure rolling FPS
    fpsSamplesRef.current.push(now);
    while (
      fpsSamplesRef.current.length > 0 &&
      now - fpsSamplesRef.current[0] > 2000
    ) {
      fpsSamplesRef.current.shift();
    }
    const measuredFps =
      fpsSamplesRef.current.length > 1
        ? ((fpsSamplesRef.current.length - 1) * 1000) /
          Math.max(1, now - fpsSamplesRef.current[0])
        : 4.0;

    setFrameGeometry(frame);

    const faceState = frame.facePresent
      ? frame.usingOcclusionCache
        ? 'cached'
        : 'detected'
      : 'away';
    const handsCount = new Set(frame.fingertips.map((f) => f.handIndex)).size;

    setDiagnostics((d) => ({
      ...d,
      delegate: engine.activeDelegate,
      fps: Math.round(measuredFps * 10) / 10,
      faceState,
      sideAngle: frame.sideAngle,
      cameraState: 'live',
      cameraStalled: false,
      detectCount: detectCountRef.current,
      handsCount,
    }));

    // Track stepping away >= 5 minutes -> Welcome Back check-in on return
    if (frame.facePresent) {
      if (awaySinceMsRef.current !== null) {
        const awayMs = wallNow - awaySinceMsRef.current;
        if (awayMs >= WELCOME_BACK_THRESHOLD_MS && !welcomeBackRef.current) {
          setWelcomeBack({
            awayMinutes: Math.max(5, Math.round(awayMs / 60_000)),
            reason: 'stepped-away',
          });
        }
        awaySinceMsRef.current = null;
      }
      lastFaceSeenMsRef.current = wallNow;
    } else {
      if (awaySinceMsRef.current === null) {
        awaySinceMsRef.current = wallNow;
      }
    }

    // Two-stage gentle alerting logic (paused while PauseSheet or WelcomeBack is open)
    if (!pauseSheetOpenRef.current && !welcomeBackRef.current) {
      if (frame.handInZone) {
        lastHandInZoneMsRef.current = now;
        const nextDwell = Math.min(s.stage2DwellSec + 1.5, dwellRef.current + dt);
        dwellRef.current = nextDwell;
        setDwellSec(nextDwell);

        if (stage1FiredRef.current) {
          stage1ClearedAtRef.current = null;
          setEdgeGlowActive(true);
          setStage1AutoCatch({
            startedAt: stage1StartedAtRef.current,
            handClearedAt: null,
            remainingSec: 5,
          });
        }

        // Stage 1 trigger (~1.2s default)
        if (
          s.stage1Enabled &&
          !stage1FiredRef.current &&
          nextDwell >= s.stage1DwellSec
        ) {
          stage1FiredRef.current = true;
          stage1StartedAtRef.current = wallNow;
          stage1ClearedAtRef.current = null;
          setEdgeGlowActive(true);
          if (s.soundEnabled) {
            playSingingBowl('gentle');
          }
          setStage1AutoCatch({
            startedAt: wallNow,
            handClearedAt: null,
            remainingSec: 5,
          });
        }

        // Stage 2 trigger (~2.6s default)
        const effectiveStage2 = Math.max(s.stage2DwellSec, s.stage1DwellSec + 0.5);
        if (s.stage2Enabled && nextDwell >= effectiveStage2) {
          dwellRef.current = 0;
          stage1FiredRef.current = false;
          stage1ClearedAtRef.current = null;
          setDwellSec(0);
          setStage1AutoCatch(null);
          setEdgeGlowActive(false);
          onStage2TriggeredRef.current();
        }
      } else {
        const sinceInZone = now - lastHandInZoneMsRef.current;
        if (dwellRef.current > 0 && sinceInZone >= HAND_FLICKER_HOLD_MS) {
          const nextDwell = Math.max(0, dwellRef.current - dt * 1.1);
          dwellRef.current = nextDwell;
          setDwellSec(nextDwell);
        }

        if (stage1FiredRef.current && sinceInZone >= HAND_FLICKER_HOLD_MS) {
          if (stage1ClearedAtRef.current === null) {
            stage1ClearedAtRef.current = wallNow;
          }
          const elapsedClearMs = wallNow - stage1ClearedAtRef.current;

          const glowHoldMs = pipActiveRef.current ? 2500 : 1000;
          if (elapsedClearMs >= glowHoldMs) {
            setEdgeGlowActive(false);
          }

          const remainingMs = Math.max(0, STAGE1_AUTOCATCH_MS - elapsedClearMs);
          if (remainingMs <= 0) {
            stage1FiredRef.current = false;
            stage1ClearedAtRef.current = null;
            dwellRef.current = 0;
            setDwellSec(0);
            setStage1AutoCatch(null);
            setEdgeGlowActive(false);
            const eventId = onStage1AutoCaughtRef.current();
            showWhisper('Hand lowered · urge redirected', eventId, 6500);
          } else {
            setStage1AutoCatch({
              startedAt: stage1StartedAtRef.current,
              handClearedAt: stage1ClearedAtRef.current,
              remainingSec: Math.ceil(remainingMs / 1000),
            });
          }
        }
      }
    }
  }, [showWhisper]);

  const runLoop = useCallback(() => {
    if (!runningRef.current) return;
    stepDetection();
    rafRef.current = requestAnimationFrame(runLoop);
  }, [stepDetection]);

  // Whenever PiP activates, immediately verify camera <video> wasn't paused by Safari
  // and drive detection via BOTH Document PiP's unthrottled rAF AND a 250ms interval!
  useEffect(() => {
    if (status !== 'running' || !pipActive) return;

    const resumeCam = () => {
      const v = videoRef.current;
      if (v && v.paused && runningRef.current) {
        v.play().catch(() => {});
      }
    };
    resumeCam();
    const t1 = window.setTimeout(resumeCam, 100);
    const t2 = window.setTimeout(resumeCam, 400);

    // 1. If Document PiP window is open (desktop Chrome/Edge), run its unthrottled rAF
    let pipRafId: number | null = null;
    if (pipWindow && !pipWindow.closed) {
      const tickPipRaf = () => {
        if (!runningRef.current || pipWindow.closed) return;
        stepDetection();
        pipRafId = pipWindow.requestAnimationFrame(tickPipRaf);
      };
      pipRafId = pipWindow.requestAnimationFrame(tickPipRaf);
    }

    // 2. Interval backup for Video PiP (iPadOS / macOS Safari)
    const id = window.setInterval(() => {
      resumeCam();
      stepDetection();
    }, TARGET_INTERVAL_MS);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearInterval(id);
      if (pipRafId !== null && pipWindow && !pipWindow.closed) {
        pipWindow.cancelAnimationFrame(pipRafId);
      }
    };
  }, [status, pipActive, pipWindow, stepDetection]);

  /**
   * CRITICAL iPadOS Safari Fix:
   * Request getUserMedia and unlock Web Audio IMMEDIATELY inside the user tap gesture
   * BEFORE awaiting MediaPipe WASM / .task model loading.
   */
  const startSession = useCallback(async () => {
    if (runningRef.current || status === 'requesting-camera' || status === 'loading-models') {
      return;
    }

    // 1. Unlock Web Audio synchronously inside user tap
    unlockAudio();
    setErrorMessage(null);
    setStatus('requesting-camera');

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setErrorMessage(
        'Camera access is unavailable in this browser context. Open Still over HTTPS in Safari or Chrome.'
      );
      return;
    }

    let stream: MediaStream;
    try {
      // 2. Request getUserMedia immediately on tap BEFORE loading models
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'user' },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 15, max: 30 },
        },
        audio: false,
      });
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Camera permission was declined. Enable camera access in Safari settings to watch locally.'
          : 'Could not open the front camera. Make sure no other app is holding it exclusively.';
      setStatus('error');
      setErrorMessage(msg);
      return;
    }

    streamRef.current = stream;
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      setDiagnostics((d) => ({
        ...d,
        cameraState: videoTrack.muted ? 'muted' : 'live',
        cameraStalled: false,
      }));
      videoTrack.onmute = () => {
        setDiagnostics((d) => ({ ...d, cameraState: 'muted', cameraStalled: true, fps: 0 }));
      };
      videoTrack.onunmute = () => {
        lastFrameAdvanceMsRef.current = performance.now();
        setDiagnostics((d) => ({ ...d, cameraState: 'live', cameraStalled: false }));
      };
      videoTrack.onended = () => {
        setDiagnostics((d) => ({ ...d, cameraState: 'ended', cameraStalled: true, fps: 0 }));
      };
    }

    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      // Auto-resume immediately if Safari pauses the camera video when PiP opens!
      video.onpause = () => {
        if (runningRef.current) {
          window.setTimeout(() => {
            if (runningRef.current && video.paused) {
              video.play().catch(() => {});
            }
          }, 60);
        }
      };
      try {
        await video.play();
      } catch {
        await new Promise<void>((resolve) => {
          const onMeta = () => {
            video.removeEventListener('loadedmetadata', onMeta);
            video.play().catch(() => {}).finally(resolve);
          };
          video.addEventListener('loadedmetadata', onMeta);
        });
      }
    }

    // 3. Request Screen Wake Lock
    void wakeLockRef.current?.enable();

    // 4. Load local MediaPipe FaceLandmarker + HandLandmarker (GPU -> CPU fallback)
    setStatus('loading-models');
    try {
      if (!engineRef.current) {
        engineRef.current = new LocalVisionEngine();
      }
      const delegate = await engineRef.current.init();
      const cached = await checkModelsCached();
      setDiagnostics((d) => ({
        ...d,
        delegate,
        modelsCached: cached,
      }));
    } catch (err) {
      stopCameraTracks();
      void wakeLockRef.current?.disable();
      setStatus('error');
      setErrorMessage(
        err instanceof Error
          ? `Local vision models could not initialize: ${err.message}`
          : 'Local vision models could not initialize in this browser.'
      );
      return;
    }

    // 5. Start 4 FPS detection loop (driven by rAF + requestVideoFrameCallback if supported)
    runningRef.current = true;
    lastDetectMsRef.current = 0;
    lastVideoTimeRef.current = -1;
    lastFrameAdvanceMsRef.current = performance.now();
    detectCountRef.current = 0;
    lastFaceSeenMsRef.current = Date.now();
    awaySinceMsRef.current = null;
    fpsSamplesRef.current = [];
    resetDwellState();
    setStatus('running');
    rafRef.current = requestAnimationFrame(runLoop);

    // Attach requestVideoFrameCallback on camera video so real camera frames directly drive detection
    if (video && typeof video.requestVideoFrameCallback === 'function') {
      const onVideoFrame = () => {
        if (!runningRef.current) return;
        lastFrameAdvanceMsRef.current = performance.now();
        stepDetection();
        rvfcRef.current = video.requestVideoFrameCallback?.(onVideoFrame) ?? null;
      };
      rvfcRef.current = video.requestVideoFrameCallback(onVideoFrame);
    }
  }, [resetDwellState, runLoop, status, stepDetection, stopCameraTracks]);

  // Cumulative calm time ticker (ticks every 1s while actively running & face present recently)
  useEffect(() => {
    if (status !== 'running') return;
    const interval = window.setInterval(() => {
      if (pauseSheetOpenRef.current || welcomeBackRef.current) return;
      if (document.visibilityState !== 'visible' && !pipActiveRef.current) return;
      const sinceFace = Date.now() - lastFaceSeenMsRef.current;
      if (sinceFace <= AWAY_PAUSE_CALM_MS) {
        onAddCalmSecondRef.current();
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [status]);

  // Visibility change handler for Welcome Back check-in after 5-min walks / screen lock
  useEffect(() => {
    const onVisibility = () => {
      if (!runningRef.current) return;
      if (document.visibilityState === 'hidden') {
        if (!pipActiveRef.current) {
          hiddenAtMsRef.current = Date.now();
        }
      } else if (document.visibilityState === 'visible') {
        const hiddenAt = hiddenAtMsRef.current;
        hiddenAtMsRef.current = null;
        if (hiddenAt && !pipActiveRef.current) {
          const awayMs = Date.now() - hiddenAt;
          if (awayMs >= WELCOME_BACK_THRESHOLD_MS) {
            setWelcomeBack({
              awayMinutes: Math.max(5, Math.round(awayMs / 60_000)),
              reason: 'tab-returned',
            });
          }
        }

        const track = streamRef.current?.getVideoTracks()[0];
        if (!track || track.readyState !== 'live') {
          stopSession();
          showWhisper('Camera paused while away · tap Begin to resume', undefined, 6000);
        } else if (videoRef.current && videoRef.current.paused) {
          videoRef.current.play().catch(() => {});
        }
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [showWhisper, stopSession]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (testGlowTimerRef.current) window.clearTimeout(testGlowTimerRef.current);
      if (whisperTimerRef.current) window.clearTimeout(whisperTimerRef.current);
      stopCameraTracks();
      engineRef.current?.dispose();
    };
  }, [stopCameraTracks]);

  const triggerTestCue = useCallback(() => {
    unlockAudio();
    if (settingsRef.current.soundEnabled) {
      playSingingBowl('gentle');
    }
    setEdgeGlowActive(true);
    if (testGlowTimerRef.current) {
      window.clearTimeout(testGlowTimerRef.current);
    }
    testGlowTimerRef.current = window.setTimeout(() => {
      if (!stage1FiredRef.current) {
        setEdgeGlowActive(false);
      }
      testGlowTimerRef.current = null;
    }, 2800);
    showWhisper(
      settingsRef.current.soundEnabled
        ? 'Gentle cue test · warm edge glow & singing bowl'
        : 'Gentle cue test · warm edge glow (chime muted)',
      undefined,
      3600
    );
  }, [showWhisper]);

  const cancelStage1FalseAlarm = useCallback(() => {
    resetDwellState();
    showWhisper('Marked as false alarm — calm time untouched', undefined, 4000);
  }, [resetDwellState, showWhisper]);

  const dismissWelcomeBack = useCallback(() => {
    setWelcomeBack(null);
    lastFaceSeenMsRef.current = Date.now();
    awaySinceMsRef.current = null;
  }, []);

  return {
    videoRef,
    status,
    errorMessage,
    edgeGlowActive,
    dwellSec,
    stage1AutoCatch,
    welcomeBack,
    whisper,
    frameGeometry,
    diagnostics,
    startSession,
    stopSession,
    triggerTestCue,
    cancelStage1FalseAlarm,
    dismissWelcomeBack,
    dismissWhisper,
    showWhisper,
    resetDwellState,
  };
}

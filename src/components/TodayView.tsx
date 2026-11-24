import { formatDuration } from '../lib/storage';
import type {
  CameraDeviceOption,
  DaySummary,
  EngineStatus,
  FrameGeometry,
  PiPKind,
  Stage1AutoCatch,
  StillSettings,
  VisionDiagnostics,
  WelcomeBackPrompt,
} from '../types';
import { CalibrationDrawer } from './CalibrationDrawer';
import { TypewriterHeadline } from './TypewriterHeadline';
import { WelcomeBackCard } from './WelcomeBackCard';

interface TodayViewProps {
  status: EngineStatus;
  errorMessage: string | null;
  today: DaySummary;
  totalCalmSeconds: number;
  settings: StillSettings;
  availableCameras: CameraDeviceOption[];
  onUpdateSettings: (patch: Partial<StillSettings>) => void;
  onSelectCamera: (deviceId: string) => void;
  onStart: () => void;
  onStop: () => void;
  onTestStage1: () => void;
  onTestStage2: () => void;
  onOpenSettings: () => void;
  pipSupported: boolean;
  autoPipSupported: boolean;
  autoPipPermission: 'granted' | 'prompt' | 'denied' | 'unknown';
  pipKind: PiPKind;
  pipError: string | null;
  onTogglePiP: () => void;
  recentFalseAlarms: number;
  onTuneAddDwell: () => void;
  onTuneTightenZone: () => void;
  onTuneEnablePinch: () => void;
  onDismissFalseAlarmNudge: () => void;
  stage1AutoCatch: Stage1AutoCatch | null;
  onCancelStage1FalseAlarm: () => void;
  welcomeBack: WelcomeBackPrompt | null;
  onWelcomeCalm: (addAwayMinutes: boolean) => void;
  onWelcomeRedirect: () => void;
  onWelcomeGrace: () => void;
  onWelcomeDismiss: () => void;
  calibrationOpen: boolean;
  onToggleCalibration: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  frameGeometry: FrameGeometry | null;
  dwellSec: number;
  diagnostics: VisionDiagnostics;
}

export function TodayView({
  status,
  errorMessage,
  today,
  totalCalmSeconds,
  settings,
  availableCameras,
  onUpdateSettings,
  onSelectCamera,
  onStart,
  onStop,
  onTestStage1,
  onTestStage2,
  onOpenSettings,
  pipSupported,
  autoPipSupported,
  autoPipPermission,
  pipKind,
  pipError,
  onTogglePiP,
  recentFalseAlarms,
  onTuneAddDwell,
  onTuneTightenZone,
  onTuneEnablePinch,
  onDismissFalseAlarmNudge,
  stage1AutoCatch,
  onCancelStage1FalseAlarm,
  welcomeBack,
  onWelcomeCalm,
  onWelcomeRedirect,
  onWelcomeGrace,
  onWelcomeDismiss,
  calibrationOpen,
  onToggleCalibration,
  videoRef,
  frameGeometry,
  dwellSec,
  diagnostics,
}: TodayViewProps) {
  const isRunning = status === 'running';
  const isBusy =
    status === 'requesting-camera' ||
    status === 'loading-models' ||
    status === 'choosing-camera';
  const pipActive = pipKind !== 'none';
  const name = settings.userName.trim();

  const headline = (() => {
    if (status === 'requesting-camera') return 'Opening your front camera locally.';
    if (status === 'loading-models') return 'Preparing on-device awareness.';
    if (status === 'choosing-camera') return 'Finding the camera in front of your face.';
    if (status === 'running') {
      if (frameGeometry?.handInZone) {
        return name
          ? `${name}, noticing a hand near your brow.`
          : 'Noticing a hand in your watched zone.';
      }
      if (diagnostics.faceState === 'away') return 'Waiting quietly until you return.';
      return 'You are here. Hands at ease.';
    }
    if (today.calmSeconds > 0) return 'Stillness builds quietly.';
    return 'A quiet pause before the habit.';
  })();

  const subline = (() => {
    if (status === 'requesting-camera') {
      return 'Nothing is recorded or sent anywhere — frames stay strictly in this browser tab.';
    }
    if (status === 'loading-models') {
      return 'Loading bundled MediaPipe face and hand models from local cache.';
    }
    if (status === 'choosing-camera') {
      return 'Quickly checking your connected cameras to pick the straight-on view.';
    }
    if (status === 'running') {
      if (pipActive) {
        return 'Floating in a mini-window at 4 FPS. Switch to another tab or app freely.';
      }
      return diagnostics.faceState === 'cached'
        ? 'Occlusion cache holding your watched zone steady.'
        : diagnostics.cameraLabel
          ? `Watching gently at 4 FPS on-device via ${diagnostics.cameraLabel}.`
          : 'Watching gently at 4 FPS on-device. Keep reading or working as usual.';
    }
    return '100% on-device eyebrow awareness. Zero cloud calls, zero video saved.';
  })();

  const activeCueSummary = [
    settings.stage1Enabled ? `Stage 1 (${settings.stage1DwellSec.toFixed(1)}s)` : null,
    settings.stage2Enabled ? `Stage 2 (${settings.stage2DwellSec.toFixed(1)}s)` : null,
    settings.soundEnabled ? 'Chime on' : 'Visual only',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="view-stack">
      {/* Welcome Back check-in after 5-min walk or stepping away */}
      {welcomeBack && (
        <WelcomeBackCard
          prompt={welcomeBack}
          userName={name}
          onCalmReturn={onWelcomeCalm}
          onRedirectedWhileAway={onWelcomeRedirect}
          onGraceReturn={onWelcomeGrace}
          onDismiss={onWelcomeDismiss}
        />
      )}

      {/* Adaptive False-Alarm Learning Nudge */}
      {recentFalseAlarms >= 2 && (
        <section className="nudge-card" aria-label="Adaptive sensitivity tuning">
          <div className="welcome-header">
            <span className="section-label">Adaptive tuning</span>
            <button
              type="button"
              className="text-link-btn text-link-btn--muted"
              onClick={onDismissFalseAlarmNudge}
            >
              Keep as is
            </button>
          </div>
          <p className="nudge-copy">
            You dismissed {recentFalseAlarms} false alarms recently (like adjusting glasses or a
            quick scratch). Want to soften sensitivity by one small step?
          </p>
          <div className="welcome-actions">
            <button
              type="button"
              id="btn-tune-dwell"
              className="btn btn-subtle btn-sm"
              onClick={onTuneAddDwell}
            >
              Add +0.2s dwell ({(settings.stage1DwellSec + 0.2).toFixed(1)}s)
            </button>
            <button
              type="button"
              id="btn-tune-zone"
              className="btn btn-subtle btn-sm"
              onClick={onTuneTightenZone}
            >
              Tighten zone (−10%)
            </button>
            {!settings.pinchFilterEnabled && (
              <button
                type="button"
                id="btn-tune-pinch"
                className="btn btn-subtle btn-sm"
                onClick={onTuneEnablePinch}
              >
                Enable pinch filter
              </button>
            )}
          </div>
        </section>
      )}

      {/* Hero Stillness Section */}
      <section className="hero-section" aria-label="Session status">
        <TypewriterHeadline text={headline} />
        <p className="hero-subline">{subline}</p>

        <div className="hero-cta-row">
          {!isRunning ? (
            <button
              type="button"
              id="btn-session-toggle"
              className="btn btn-primary btn-lg"
              disabled={isBusy}
              onClick={onStart}
            >
              {status === 'requesting-camera'
                ? 'Requesting camera…'
                : status === 'loading-models'
                  ? 'Loading local models…'
                  : status === 'choosing-camera'
                    ? 'Choosing front camera…'
                    : 'Begin session'}
            </button>
          ) : (
            <button
              type="button"
              id="btn-session-toggle"
              className="btn btn-subtle btn-lg"
              onClick={onStop}
            >
              Pause session
            </button>
          )}

          {pipSupported && (
            <button
              type="button"
              id="btn-toggle-pip"
              className={`btn btn-lg ${pipActive ? 'btn-subtle' : 'btn-ghost'}`}
              title="Picture-in-Picture: floats a tiny Still card in the corner while you use other tabs or apps"
              onClick={onTogglePiP}
            >
              {pipActive ? 'Close mini-window' : 'Float mini-window'}
            </button>
          )}

          <button
            type="button"
            id="btn-test-cue"
            className="btn btn-ghost btn-lg"
            onClick={onTestStage1}
          >
            Test cue
          </button>
        </div>

        {/* Clear, friendly 1-line explanation of Floating Mini-Window (PiP) */}
        {pipSupported && (
          <p className="pip-helper-line">
            {autoPipPermission === 'denied' ? (
              <>
                <strong>Auto-float is blocked in browser settings</strong> — click the site controls
                icon left of the address bar to allow Automatic picture-in-picture, or click{' '}
                <strong>Float mini-window</strong> above.
              </>
            ) : (
              <>
                <strong>Mini-window (Picture-in-Picture)</strong> pops out automatically when you
                switch browser tabs
                {autoPipSupported && settings.autoPipOnTabSwitch
                  ? ' — click Float mini-window once to keep it floating over other Mac apps too.'
                  : '. Click Float mini-window to keep it floating over other apps.'}
              </>
            )}
          </p>
        )}

        {(errorMessage || pipError) && (
          <p className="inline-error" role="alert">
            {errorMessage || pipError}
          </p>
        )}

        {/* Stage 1 live 5-second auto-catch status bar */}
        {stage1AutoCatch && (
          <div className="autocatch-bar" role="status" aria-live="polite">
            <span className="autocatch-text">
              {stage1AutoCatch.handClearedAt
                ? `Hand lowered — auto-catching redirect in ${stage1AutoCatch.remainingSec}s`
                : name
                  ? `${name}, hand near zone — lower gently to redirect`
                  : 'Hand near zone — lower gently to redirect'}
            </span>
            <button
              type="button"
              className="text-link-btn"
              onClick={onCancelStage1FalseAlarm}
            >
              False alarm
            </button>
          </div>
        )}
      </section>

      {/* Editorial Stat Trio (cumulative calm time, urges redirected, grace recoveries) */}
      <section className="metrics-strip" aria-label="Today's stillness summary">
        <div className="metric-item">
          <span className="metric-label">Cumulative calm time</span>
          <span className="metric-value tabular">{formatDuration(today.calmSeconds)}</span>
          <span className="metric-footnote">
            {totalCalmSeconds > today.calmSeconds
              ? `${formatDuration(totalCalmSeconds)} all-time · never resets`
              : 'Accumulates gently · never resets'}
          </span>
        </div>

        <div className="metric-item">
          <span className="metric-label">Urges redirected</span>
          <span className="metric-value tabular">{today.urgesRedirected}</span>
          <span className="metric-footnote">Stage 1 &amp; 2 catches today</span>
        </div>

        <div className="metric-item">
          <span className="metric-label">Grace recoveries</span>
          <span className="metric-value tabular">{today.graceRecoveries}</span>
          <span className="metric-footnote">Noticed &amp; reset without shame</span>
        </div>
      </section>

      {/* Quiet 1-line summary bar linking to Settings for Gentle cues */}
      <div className="cue-summary-bar">
        <span className="cue-summary-text">
          {activeCueSummary || 'All gentle cues paused'}
        </span>
        <div className="settings-inline-actions">
          <button
            type="button"
            id="btn-today-preview-pause"
            className="text-link-btn"
            onClick={onTestStage2}
          >
            Preview pause
          </button>
          <span className="meta-dot" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            id="btn-open-cue-settings"
            className="text-link-btn"
            onClick={onOpenSettings}
          >
            Cue settings →
          </button>
        </div>
      </div>

      {/* Expandable Silhouette / Camera Calibration Preview */}
      <CalibrationDrawer
        expanded={calibrationOpen}
        onToggleExpand={onToggleCalibration}
        settings={settings}
        availableCameras={availableCameras}
        onUpdateSettings={onUpdateSettings}
        onSelectCamera={onSelectCamera}
        videoRef={videoRef}
        frameGeometry={frameGeometry}
        dwellSec={dwellSec}
        sessionRunning={isRunning}
        diagnostics={diagnostics}
      />
    </div>
  );
}

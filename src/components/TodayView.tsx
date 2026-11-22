import { formatDuration } from '../lib/storage';
import type {
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
import { WelcomeBackCard } from './WelcomeBackCard';

interface TodayViewProps {
  status: EngineStatus;
  errorMessage: string | null;
  today: DaySummary;
  totalCalmSeconds: number;
  settings: StillSettings;
  onUpdateSettings: (patch: Partial<StillSettings>) => void;
  onStart: () => void;
  onStop: () => void;
  onTestStage1: () => void;
  onTestStage2: () => void;
  pipSupported: boolean;
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
  onUpdateSettings,
  onStart,
  onStop,
  onTestStage1,
  onTestStage2,
  pipSupported,
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
  const isBusy = status === 'requesting-camera' || status === 'loading-models';
  const pipActive = pipKind !== 'none';

  const headline = (() => {
    if (status === 'requesting-camera') return 'Opening your front camera locally.';
    if (status === 'loading-models') return 'Preparing on-device awareness.';
    if (status === 'running') {
      if (frameGeometry?.handInZone) return 'Noticing a hand in your watched zone.';
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
    if (status === 'running') {
      if (pipActive) {
        return 'Floating in Picture-in-Picture at 4 FPS. Switch to another app or tab freely.';
      }
      return diagnostics.faceState === 'cached'
        ? 'Occlusion cache holding your watched zone steady.'
        : 'Watching gently at 4 FPS on-device. Keep reading or working as usual.';
    }
    return '100% on-device eyebrow awareness. Zero cloud calls, zero video saved.';
  })();

  return (
    <div className="view-stack">
      {/* Welcome Back check-in after 5-min walk or stepping away */}
      {welcomeBack && (
        <WelcomeBackCard
          prompt={welcomeBack}
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
        <h1 className="hero-headline">{headline}</h1>
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
              onClick={onTogglePiP}
            >
              {pipActive ? 'Close floating PiP' : 'Float PiP'}
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

      {/* Two-Stage Gentle Alerting Controls */}
      <section className="editorial-section" aria-label="Gentle alerting settings">
        <div className="section-head-row">
          <h2 className="section-heading">Gentle cues</h2>
          <button
            type="button"
            id="btn-preview-pause-sheet"
            className="text-link-btn"
            onClick={onTestStage2}
          >
            Preview 60s pause sheet
          </button>
        </div>

        <div className="toggle-list">
          <div className="toggle-row">
            <div className="toggle-copy">
              <div className="toggle-title">
                Stage 1 · Edge glow &amp; singing bowl{' '}
                <span className="inline-timing tabular">
                  ~{settings.stage1DwellSec.toFixed(1)}s
                </span>
              </div>
              <p className="toggle-desc">
                Warm peripheral screen glow and soft chime, with a 5-second auto-catch when you
                lower your hand.
              </p>
            </div>
            <button
              type="button"
              id="toggle-stage1"
              role="switch"
              aria-checked={settings.stage1Enabled}
              aria-label="Toggle Stage 1 warm glow and chime"
              className={`switch ${settings.stage1Enabled ? 'switch--on' : ''}`}
              onClick={() => onUpdateSettings({ stage1Enabled: !settings.stage1Enabled })}
            >
              <span className="switch-thumb" />
            </button>
          </div>

          <div className="toggle-row">
            <div className="toggle-copy">
              <div className="toggle-title">
                Stage 2 · 60s competing-response pause{' '}
                <span className="inline-timing tabular">
                  ~{settings.stage2DwellSec.toFixed(1)}s
                </span>
              </div>
              <p className="toggle-desc">
                Calm HRT pause sheet with glowing light, breath pacing, auto-catch, Grace recovery,
                and False alarm.
              </p>
            </div>
            <button
              type="button"
              id="toggle-stage2"
              role="switch"
              aria-checked={settings.stage2Enabled}
              aria-label="Toggle Stage 2 60-second pause sheet"
              className={`switch ${settings.stage2Enabled ? 'switch--on' : ''}`}
              onClick={() => onUpdateSettings({ stage2Enabled: !settings.stage2Enabled })}
            >
              <span className="switch-thumb" />
            </button>
          </div>

          <div className="toggle-row">
            <div className="toggle-copy">
              <div className="toggle-title">Singing-bowl chime audio</div>
              <p className="toggle-desc">
                Synthesized locally via Web Audio. Turn off for visual-only glowing light in quiet
                rooms.
              </p>
            </div>
            <button
              type="button"
              id="toggle-sound"
              role="switch"
              aria-checked={settings.soundEnabled}
              aria-label="Toggle singing-bowl chime audio"
              className={`switch ${settings.soundEnabled ? 'switch--on' : ''}`}
              onClick={() => onUpdateSettings({ soundEnabled: !settings.soundEnabled })}
            >
              <span className="switch-thumb" />
            </button>
          </div>

          <div className="toggle-row">
            <div className="toggle-copy">
              <div className="toggle-title">Repeat soft chime during pause alert</div>
              <p className="toggle-desc">
                Gently repeats the singing bowl every few seconds alongside the glowing light until
                you respond or mute it.
              </p>
            </div>
            <button
              type="button"
              id="toggle-repeat-chime"
              role="switch"
              aria-checked={settings.stage2RepeatChime}
              aria-label="Toggle repeating chime during Stage 2 pause alert"
              className={`switch ${settings.stage2RepeatChime ? 'switch--on' : ''}`}
              onClick={() =>
                onUpdateSettings({ stage2RepeatChime: !settings.stage2RepeatChime })
              }
            >
              <span className="switch-thumb" />
            </button>
          </div>
        </div>
      </section>

      {/* Expandable Silhouette / Camera Calibration Preview */}
      <CalibrationDrawer
        expanded={calibrationOpen}
        onToggleExpand={onToggleCalibration}
        settings={settings}
        onUpdateSettings={onUpdateSettings}
        videoRef={videoRef}
        frameGeometry={frameGeometry}
        dwellSec={dwellSec}
        sessionRunning={isRunning}
        diagnostics={diagnostics}
      />
    </div>
  );
}

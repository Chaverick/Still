import { COMPETING_RESPONSES, formatDuration } from '../lib/storage';
import type { EngineStatus } from '../types';

interface PipWindowContentProps {
  status: EngineStatus;
  calmSeconds: number;
  urgesRedirected: number;
  handInZone: boolean;
  stage1Glow: boolean;
  stage2AlertOpen: boolean;
  faceState: 'detected' | 'cached' | 'away';
  pinnedResponses: string[];
  onStart: () => void;
  onStop: () => void;
  onAutoCatch: (responseId: string) => void;
  onGraceRecovery: () => void;
  onFalseAlarm: () => void;
  onClosePiP: () => void;
}

/**
 * Interactive mini-window rendered inside Document Picture-in-Picture (Chrome / Edge desktop).
 */
export function PipWindowContent({
  status,
  calmSeconds,
  urgesRedirected,
  handInZone,
  stage1Glow,
  stage2AlertOpen,
  faceState,
  pinnedResponses,
  onStart,
  onStop,
  onAutoCatch,
  onGraceRecovery,
  onFalseAlarm,
  onClosePiP,
}: PipWindowContentProps) {
  const isRunning = status === 'running';
  const isGlowing = stage2AlertOpen || stage1Glow || handInZone;

  const topResponse =
    COMPETING_RESPONSES.find((r) => pinnedResponses.includes(r.id)) ?? COMPETING_RESPONSES[0];

  return (
    <div
      className={`pip-shell ${
        stage2AlertOpen ? 'pip-shell--alert' : isGlowing ? 'pip-shell--stage1' : ''
      }`}
    >
      <div className="pip-top-row">
        <div className="pip-brand">
          <span
            className={`pip-orb ${
              isGlowing ? 'pip-orb--glow' : isRunning ? 'pip-orb--live' : ''
            }`}
          />
          <span className="pip-title">Still</span>
        </div>
        <button type="button" className="text-link-btn text-link-btn--muted" onClick={onClosePiP}>
          Return to tab
        </button>
      </div>

      {stage2AlertOpen ? (
        <div className="pip-alert-body">
          <h2 className="pip-headline">Hands down · let it pass.</h2>
          <p className="pip-prompt">{topResponse.instruction}</p>
          <div className="pip-alert-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => onAutoCatch(topResponse.id)}
            >
              Caught it
            </button>
            <button
              type="button"
              className="btn btn-subtle btn-sm"
              onClick={onGraceRecovery}
            >
              Grace
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onFalseAlarm}
            >
              False alarm
            </button>
          </div>
        </div>
      ) : (
        <div className="pip-calm-body">
          <h2 className="pip-headline">
            {isGlowing
              ? 'Noticing hand near zone…'
              : !isRunning
                ? 'Paused'
                : faceState === 'away'
                  ? 'Waiting quietly'
                  : 'Hands at ease.'}
          </h2>
          <div className="pip-metrics">
            <div>
              <span className="pip-metric-label">Calm today</span>
              <span className="pip-metric-val tabular">{formatDuration(calmSeconds)}</span>
            </div>
            <div>
              <span className="pip-metric-label">Redirected</span>
              <span className="pip-metric-val tabular">{urgesRedirected}</span>
            </div>
          </div>
          <div className="pip-controls">
            {isRunning ? (
              <button type="button" className="btn btn-subtle btn-sm" onClick={onStop}>
                Pause watching
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" onClick={onStart}>
                Begin session
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

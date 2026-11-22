import { useEffect, useMemo, useState } from 'react';
import { playSingingBowl } from '../lib/audio';
import { COMPETING_RESPONSES, CONTEXT_TAGS } from '../lib/storage';
import type { CompetingResponse } from '../types';

const PAUSE_DURATION_SEC = 60;

interface PauseSheetProps {
  open: boolean;
  isPreview?: boolean;
  handInZone: boolean;
  sessionRunning: boolean;
  soundEnabled: boolean;
  pinnedResponses: string[];
  onAutoCatch: (responseId: string) => void;
  onGraceRecovery: (tag?: string) => void;
  onFalseAlarm: () => void;
}

export function PauseSheet({
  open,
  isPreview = false,
  handInZone,
  sessionRunning,
  soundEnabled,
  pinnedResponses,
  onAutoCatch,
  onGraceRecovery,
  onFalseAlarm,
}: PauseSheetProps) {
  const orderedResponses = useMemo<CompetingResponse[]>(() => {
    const pinned = COMPETING_RESPONSES.filter((r) => pinnedResponses.includes(r.id));
    const rest = COMPETING_RESPONSES.filter((r) => !pinnedResponses.includes(r.id));
    return [...pinned, ...rest];
  }, [pinnedResponses]);

  const [responseIndex, setResponseIndex] = useState(0);
  const [remainingSec, setRemainingSec] = useState(PAUSE_DURATION_SEC);
  const [graceStep, setGraceStep] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | undefined>(undefined);

  const currentResponse = orderedResponses[responseIndex % orderedResponses.length];

  // Reset countdown whenever sheet opens
  useEffect(() => {
    if (!open) return;
    setRemainingSec(PAUSE_DURATION_SEC);
    setGraceStep(false);
    setSelectedTag(undefined);
    setResponseIndex((prev) => (prev + 1) % orderedResponses.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 60-second HRT countdown -> auto-catch on completion
  useEffect(() => {
    if (!open || graceStep) return;
    const timer = window.setInterval(() => {
      setRemainingSec((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          if (soundEnabled) {
            playSingingBowl('grounding');
          }
          onAutoCatch(currentResponse.id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [open, graceStep, currentResponse.id, onAutoCatch, soundEnabled]);

  if (!open) return null;

  const progress = (PAUSE_DURATION_SEC - remainingSec) / PAUSE_DURATION_SEC;
  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  // 14-second gentle breathing cadence: 4s inhale, 4s hold, 6s exhale
  const elapsed = PAUSE_DURATION_SEC - remainingSec;
  const breathCycle = elapsed % 14;
  const breathCue =
    breathCycle < 4 ? 'Breathe in slowly' : breathCycle < 8 ? 'Rest for a moment' : 'Exhale gently';

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pause-sheet-title"
    >
      <div className="sheet-card">
        <div className="sheet-eyebrow-row">
          <span className="sheet-kicker">
            {isPreview ? 'Pause sheet preview · HRT' : 'Gentle pause · Competing response'}
          </span>
          {sessionRunning && (
            <span
              className={`hand-state-chip ${handInZone ? 'hand-state-chip--near' : 'hand-state-chip--clear'}`}
            >
              {handInZone ? 'Lower hand to lap' : 'Hands clear'}
            </span>
          )}
        </div>

        {!graceStep ? (
          <>
            <h2 id="pause-sheet-title" className="sheet-title">
              Let the urge crest and pass.
            </h2>

            <div className="breath-timer-wrap">
              <svg className="breath-ring" viewBox="0 0 132 132" aria-hidden="true">
                <circle
                  className="breath-ring-track"
                  cx="66"
                  cy="66"
                  r={radius}
                />
                <circle
                  className="breath-ring-progress"
                  cx="66"
                  cy="66"
                  r={radius}
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                />
              </svg>
              <div className="breath-timer-center">
                <span className="breath-seconds">{remainingSec}s</span>
                <span className="breath-cue">{breathCue}</span>
              </div>
            </div>

            <div className="hrt-prompt-box">
              <div className="hrt-prompt-head">
                <span className="hrt-prompt-title">{currentResponse.title}</span>
                <button
                  type="button"
                  className="text-link-btn"
                  onClick={() =>
                    setResponseIndex((i) => (i + 1) % orderedResponses.length)
                  }
                >
                  Try another
                </button>
              </div>
              <p className="hrt-prompt-body">{currentResponse.instruction}</p>
            </div>

            <p className="sheet-subnote">
              Auto-catches when the minute finishes, or choose below whenever you are ready.
            </p>

            <div className="sheet-actions">
              <button
                type="button"
                id="btn-pause-autocatch"
                className="btn btn-primary"
                onClick={() => onAutoCatch(currentResponse.id)}
              >
                Auto-catch · urge passed
              </button>
              <div className="sheet-secondary-row">
                <button
                  type="button"
                  id="btn-pause-grace"
                  className="btn btn-subtle"
                  onClick={() => setGraceStep(true)}
                >
                  Grace recovery
                </button>
                <button
                  type="button"
                  id="btn-pause-false-alarm"
                  className="btn btn-ghost"
                  onClick={onFalseAlarm}
                >
                  False alarm
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <h2 id="pause-sheet-title" className="sheet-title">
              Reset with grace.
            </h2>
            <p className="sheet-grace-copy">
              Noticing is already part of rewiring the habit. Your calm time from today stays intact.
              If helpful, tap what was happening around you:
            </p>

            <div className="tag-row">
              {CONTEXT_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`tag-chip ${selectedTag === tag ? 'tag-chip--selected' : ''}`}
                  onClick={() => setSelectedTag((prev) => (prev === tag ? undefined : tag))}
                >
                  {tag}
                </button>
              ))}
            </div>

            <div className="sheet-actions">
              <button
                type="button"
                id="btn-confirm-grace"
                className="btn btn-primary"
                onClick={() => onGraceRecovery(selectedTag)}
              >
                Save grace recovery & continue
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setGraceStep(false)}
              >
                Back to 60s pause
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { COMPETING_RESPONSES, ENVIRONMENT_ANCHORS } from '../lib/storage';
import type { StillSettings } from '../types';
import { CompetingResponseVisual } from './CompetingResponseVisual';

interface WhatWorksViewProps {
  settings: StillSettings;
  onUpdateSettings: (patch: Partial<StillSettings>) => void;
}

const PRACTICE_SECONDS = 15;

export function WhatWorksView({
  settings,
  onUpdateSettings,
}: WhatWorksViewProps) {
  const [practicingId, setPracticingId] = useState<string | null>(null);
  const [practiceRemaining, setPracticeRemaining] = useState(PRACTICE_SECONDS);

  useEffect(() => {
    if (!practicingId) return;
    const timer = window.setInterval(() => {
      setPracticeRemaining((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          setPracticingId(null);
          return PRACTICE_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [practicingId]);

  const togglePractice = (id: string) => {
    if (practicingId === id) {
      setPracticingId(null);
      setPracticeRemaining(PRACTICE_SECONDS);
    } else {
      setPracticingId(id);
      setPracticeRemaining(PRACTICE_SECONDS);
    }
  };

  const togglePinResponse = (id: string) => {
    const exists = settings.pinnedResponses.includes(id);
    const next = exists
      ? settings.pinnedResponses.filter((x) => x !== id)
      : [id, ...settings.pinnedResponses];
    onUpdateSettings({ pinnedResponses: next });
  };

  const toggleAnchor = (id: string) => {
    const exists = settings.checkedAnchors.includes(id);
    const next = exists
      ? settings.checkedAnchors.filter((x) => x !== id)
      : [...settings.checkedAnchors, id];
    onUpdateSettings({ checkedAnchors: next });
  };

  return (
    <div className="view-stack">
      <header className="page-intro">
        <h1 className="page-title">What works</h1>
        <p className="page-lead">
          Simply lowering your hand works great for light urges. For stronger ones, mirror one of
          these gentle physical movements — practicing for 15 seconds while calm builds effortless
          muscle memory.
        </p>
      </header>

      {/* Visual Competing Responses Library */}
      <section className="editorial-section" aria-label="Visual competing responses">
        <div className="section-head-row">
          <h2 className="section-heading">Physical resets (see &amp; mirror)</h2>
          <span className="section-meta">Starred appear first during pauses</span>
        </div>

        <div className="response-list">
          {COMPETING_RESPONSES.map((item) => {
            const pinned = settings.pinnedResponses.includes(item.id);
            const isPracticing = practicingId === item.id;
            return (
              <article
                key={item.id}
                className={`response-card response-card--visual ${
                  isPracticing ? 'response-card--practicing' : ''
                }`}
              >
                <CompetingResponseVisual id={item.id} />

                <div className="response-content">
                  <div className="response-head">
                    <h3 className="response-title">{item.title}</h3>
                    <div className="response-head-actions">
                      <button
                        type="button"
                        className={`pin-btn ${isPracticing ? 'pin-btn--practice' : ''}`}
                        onClick={() => togglePractice(item.id)}
                      >
                        {isPracticing ? `Practicing · ${practiceRemaining}s` : 'Try 15s'}
                      </button>
                      <button
                        type="button"
                        className={`pin-btn ${pinned ? 'pin-btn--active' : ''}`}
                        aria-pressed={pinned}
                        onClick={() => togglePinResponse(item.id)}
                      >
                        {pinned ? '★ First' : '☆ Star'}
                      </button>
                    </div>
                  </div>
                  <p className="response-instruction">{item.instruction}</p>
                  <p className="response-why">{item.why}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Sensory & Environment Anchors */}
      <section className="editorial-section" aria-label="Sensory and environment nudges">
        <div className="section-head-row">
          <h2 className="section-heading">Quiet environment anchors</h2>
          <span className="section-meta">Check what helps today</span>
        </div>

        <div className="anchor-list">
          {ENVIRONMENT_ANCHORS.map((anchor) => {
            const checked = settings.checkedAnchors.includes(anchor.id);
            return (
              <label key={anchor.id} className="anchor-item">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleAnchor(anchor.id)}
                />
                <div className="anchor-copy">
                  <span className={`anchor-title ${checked ? 'anchor-title--done' : ''}`}>
                    {anchor.title}
                  </span>
                  <span className="anchor-detail">{anchor.detail}</span>
                </div>
              </label>
            );
          })}
        </div>
      </section>
    </div>
  );
}

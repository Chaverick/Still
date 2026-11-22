import { useMemo } from 'react';
import {
  COMPETING_RESPONSES,
  ENVIRONMENT_ANCHORS,
  formatShortDuration,
  getLocalDateKey,
} from '../lib/storage';
import type { AwarenessEvent, DaySummary, StillSettings } from '../types';

interface WhatWorksViewProps {
  days: Record<string, DaySummary>;
  events: AwarenessEvent[];
  settings: StillSettings;
  onUpdateSettings: (patch: Partial<StillSettings>) => void;
}

export function WhatWorksView({
  days,
  events,
  settings,
  onUpdateSettings,
}: WhatWorksViewProps) {
  const last7Days = useMemo(() => {
    const out: Array<{ label: string; dateKey: string; calmSeconds: number; redirects: number }> =
      [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = getLocalDateKey(d.getTime());
      const summary = days[key];
      out.push({
        label: d.toLocaleDateString(undefined, { weekday: 'short' }),
        dateKey: key,
        calmSeconds: summary?.calmSeconds ?? 0,
        redirects: summary?.urgesRedirected ?? 0,
      });
    }
    return out;
  }, [days]);

  const maxCalmSec = Math.max(60, ...last7Days.map((d) => d.calmSeconds));

  const insights = useMemo(() => {
    const redirects = events.filter(
      (e) => e.kind === 'redirect-stage1' || e.kind === 'redirect-stage2'
    );
    const graces = events.filter((e) => e.kind === 'grace');
    const totalMoments = redirects.length + graces.length;
    const redirectRate =
      totalMoments > 0 ? Math.round((redirects.length / totalMoments) * 100) : null;

    // Find most common window of day for urges
    const buckets: Record<string, number> = {
      Morning: 0,
      Afternoon: 0,
      Evening: 0,
      Late: 0,
    };
    for (const ev of [...redirects, ...graces]) {
      const hr = new Date(ev.timestamp).getHours();
      if (hr >= 5 && hr < 12) buckets.Morning += 1;
      else if (hr >= 12 && hr < 17) buckets.Afternoon += 1;
      else if (hr >= 17 && hr < 22) buckets.Evening += 1;
      else buckets.Late += 1;
    }
    const topWindow = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0];

    // Most used competing response
    const responseCounts: Record<string, number> = {};
    for (const ev of redirects) {
      if (ev.responseId) {
        responseCounts[ev.responseId] = (responseCounts[ev.responseId] ?? 0) + 1;
      }
    }
    const topResponseId = Object.entries(responseCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    const topResponse = COMPETING_RESPONSES.find((r) => r.id === topResponseId);

    return {
      totalMoments,
      redirectRate,
      topWindow: topWindow && topWindow[1] > 0 ? topWindow[0] : null,
      topResponse: topResponse?.title ?? null,
    };
  }, [events]);

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
          Habit Reversal Training pairs gentle awareness with an easy physical alternative. Pin the
          responses that feel natural to you — Stage 2 will offer them first.
        </p>
      </header>

      {/* 7-day calm rhythm */}
      <section className="editorial-section" aria-label="Seven-day calm rhythm">
        <div className="section-head-row">
          <h2 className="section-heading">Last 7 days · calm rhythm</h2>
          <span className="section-meta">
            {insights.redirectRate !== null
              ? `${insights.redirectRate}% redirected (${insights.totalMoments} noticed)`
              : 'Builds as you use Still'}
          </span>
        </div>

        <div className="rhythm-chart" role="img" aria-label="Seven day calm time bar chart">
          {last7Days.map((day, idx) => {
            const pct = Math.max(4, Math.round((day.calmSeconds / maxCalmSec) * 100));
            const isToday = idx === last7Days.length - 1;
            return (
              <div key={day.dateKey} className="rhythm-col">
                <span className="rhythm-val tabular">
                  {day.calmSeconds > 0 ? formatShortDuration(day.calmSeconds) : '—'}
                </span>
                <div className="rhythm-bar-track">
                  <div
                    className={`rhythm-bar ${isToday ? 'rhythm-bar--today' : ''} ${day.calmSeconds === 0 ? 'rhythm-bar--empty' : ''}`}
                    style={{ height: `${day.calmSeconds === 0 ? 4 : pct}%` }}
                  />
                </div>
                <span className={`rhythm-day ${isToday ? 'rhythm-day--today' : ''}`}>
                  {day.label}
                </span>
              </div>
            );
          })}
        </div>

        {(insights.topWindow || insights.topResponse) && (
          <div className="pattern-notes">
            {insights.topWindow && (
              <p>
                Most urges have shown up in the <strong>{insights.topWindow.toLowerCase()}</strong>.
              </p>
            )}
            {insights.topResponse && (
              <p>
                Most helpful pause so far: <strong>{insights.topResponse}</strong>.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Competing Responses Library */}
      <section className="editorial-section" aria-label="Competing responses">
        <div className="section-head-row">
          <h2 className="section-heading">Competing responses (HRT)</h2>
          <span className="section-meta">Starred appear first in pauses</span>
        </div>

        <div className="response-list">
          {COMPETING_RESPONSES.map((item) => {
            const pinned = settings.pinnedResponses.includes(item.id);
            return (
              <article key={item.id} className="response-card">
                <div className="response-head">
                  <h3 className="response-title">{item.title}</h3>
                  <button
                    type="button"
                    className={`pin-btn ${pinned ? 'pin-btn--active' : ''}`}
                    aria-pressed={pinned}
                    onClick={() => togglePinResponse(item.id)}
                  >
                    {pinned ? '★ Prioritized' : '☆ Prioritize'}
                  </button>
                </div>
                <p className="response-instruction">{item.instruction}</p>
                <p className="response-why">{item.why}</p>
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

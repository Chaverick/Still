import { useMemo, useRef, useState } from 'react';
import {
  formatDuration,
  formatShortDuration,
  getEmptyDay,
  getLocalDateKey,
} from '../lib/storage';
import type { DaySummary } from '../types';

type MetricKey = 'calm' | 'redirectRate' | 'redirected' | 'grace';

interface ProgressViewProps {
  days: Record<string, DaySummary>;
  onExportData: () => void;
  onImportFile: (file: File) => void;
}

interface DayRow {
  dateKey: string;
  shortLabel: string;
  fullLabel: string;
  isToday: boolean;
  summary: DaySummary;
  redirectRate: number | null; // 0..100 or null when no moments
  deltaCalmSec: number | null; // vs prior day
}

function formatDayLabel(dateKey: string, todayKey: string, yesterdayKey: string): string {
  if (dateKey === todayKey) return 'Today';
  if (dateKey === yesterdayKey) return 'Yesterday';
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatDeltaCalm(deltaSec: number): string {
  const abs = Math.abs(deltaSec);
  const sign = deltaSec > 0 ? '+' : '−';
  if (abs < 60) return `${sign}${abs}s`;
  return `${sign}${formatShortDuration(abs)}`;
}

export function ProgressView({
  days,
  onExportData,
  onImportFile,
}: ProgressViewProps) {
  const [metric, setMetric] = useState<MetricKey>('calm');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const todayKey = getLocalDateKey();
  const yesterdayKey = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return getLocalDateKey(d.getTime());
  }, []);

  // Build 14-day window (oldest -> newest) for trend chart
  const last14Days = useMemo<DayRow[]>(() => {
    const now = new Date();
    const rows: DayRow[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dateKey = getLocalDateKey(d.getTime());
      const summary = days[dateKey] ?? getEmptyDay(dateKey);
      const totalMoments = summary.urgesRedirected + summary.graceRecoveries;
      const redirectRate =
        totalMoments > 0 ? Math.round((summary.urgesRedirected / totalMoments) * 100) : null;

      const prevCalm = rows.length > 0 ? rows[rows.length - 1].summary.calmSeconds : null;
      const deltaCalmSec =
        prevCalm !== null && (summary.calmSeconds > 0 || prevCalm > 0)
          ? summary.calmSeconds - prevCalm
          : null;

      rows.push({
        dateKey,
        shortLabel:
          i === 0
            ? 'Today'
            : d.toLocaleDateString(undefined, { day: 'numeric' }),
        fullLabel: formatDayLabel(dateKey, todayKey, yesterdayKey),
        isToday: i === 0,
        summary,
        redirectRate,
        deltaCalmSec,
      });
    }
    return rows;
  }, [days, todayKey, yesterdayKey]);

  const [selectedKey, setSelectedKey] = useState<string>(todayKey);
  const selectedDay =
    last14Days.find((d) => d.dateKey === selectedKey) ?? last14Days[last14Days.length - 1];

  // Today vs Yesterday & 7-day rolling averages
  const comparison = useMemo(() => {
    const today = days[todayKey] ?? getEmptyDay(todayKey);
    const yesterday = days[yesterdayKey];
    const hasYesterday = Boolean(
      yesterday &&
        (yesterday.calmSeconds > 0 ||
          yesterday.urgesRedirected > 0 ||
          yesterday.graceRecoveries > 0)
    );

    const calmDelta = hasYesterday ? today.calmSeconds - (yesterday?.calmSeconds ?? 0) : null;

    const allRecorded = Object.values(days).filter(
      (d) => d.calmSeconds > 0 || d.urgesRedirected > 0 || d.graceRecoveries > 0
    );
    const activeDays14 = last14Days.filter(
      (d) =>
        d.summary.calmSeconds > 0 ||
        d.summary.urgesRedirected > 0 ||
        d.summary.graceRecoveries > 0
    ).length;

    const totalRedirected = allRecorded.reduce((acc, d) => acc + d.urgesRedirected, 0);
    const totalGrace = allRecorded.reduce((acc, d) => acc + d.graceRecoveries, 0);
    const overallRate =
      totalRedirected + totalGrace > 0
        ? Math.round((totalRedirected / (totalRedirected + totalGrace)) * 100)
        : null;

    const last7 = last14Days.slice(7);
    const prev7 = last14Days.slice(0, 7);
    const last7CalmAvg = Math.round(
      last7.reduce((acc, d) => acc + d.summary.calmSeconds, 0) / 7
    );
    const prev7CalmAvg = Math.round(
      prev7.reduce((acc, d) => acc + d.summary.calmSeconds, 0) / 7
    );

    return {
      today,
      calmDelta,
      hasYesterday,
      activeDays14,
      totalDays: allRecorded.length,
      overallRate,
      totalRedirected,
      totalGrace,
      last7CalmAvg,
      prev7CalmAvg,
    };
  }, [days, last14Days, todayKey, yesterdayKey]);

  // All recorded days sorted newest first for Day-by-Day Log
  const historyRows = useMemo<DayRow[]>(() => {
    const keys = Object.keys(days)
      .filter((k) => {
        const d = days[k];
        return d && (d.calmSeconds > 0 || d.urgesRedirected > 0 || d.graceRecoveries > 0);
      })
      .sort((a, b) => (a < b ? 1 : -1));

    // Always include Today at top even if 0 so user sees where today stands
    if (!keys.includes(todayKey)) {
      keys.unshift(todayKey);
    }

    return keys.map((dateKey, idx) => {
      const summary = days[dateKey] ?? getEmptyDay(dateKey);
      const totalMoments = summary.urgesRedirected + summary.graceRecoveries;
      const redirectRate =
        totalMoments > 0 ? Math.round((summary.urgesRedirected / totalMoments) * 100) : null;
      const priorKey = keys[idx + 1];
      const prior = priorKey ? days[priorKey] : null;
      const deltaCalmSec = prior ? summary.calmSeconds - prior.calmSeconds : null;

      return {
        dateKey,
        shortLabel: dateKey.slice(5),
        fullLabel: formatDayLabel(dateKey, todayKey, yesterdayKey),
        isToday: dateKey === todayKey,
        summary,
        redirectRate,
        deltaCalmSec,
      };
    });
  }, [days, todayKey, yesterdayKey]);

  // Chart scaling per selected metric
  const chartValues = useMemo(() => {
    const raw = last14Days.map((row) => {
      switch (metric) {
        case 'calm':
          return row.summary.calmSeconds;
        case 'redirectRate':
          return row.redirectRate ?? 0;
        case 'redirected':
          return row.summary.urgesRedirected;
        case 'grace':
          return row.summary.graceRecoveries;
      }
    });
    const maxVal =
      metric === 'redirectRate' ? 100 : Math.max(metric === 'calm' ? 60 : 1, ...raw);
    return { raw, maxVal };
  }, [last14Days, metric]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImportFile(file);
    }
    e.target.value = '';
  };

  return (
    <div className="view-stack">
      <header className="page-intro">
        <h1 className="page-title">Day-over-day progress</h1>
        <p className="page-lead">
          Quiet proof that awareness is compounding. Every day builds on the last without harsh
          streak resets.
        </p>
      </header>

      {/* Day-over-day comparison strip */}
      <section className="metrics-strip" aria-label="Day-over-day comparison">
        <div className="metric-item">
          <span className="metric-label">Today vs yesterday</span>
          <span className="metric-value tabular">
            {formatDuration(comparison.today.calmSeconds)}
          </span>
          <span className="metric-footnote">
            {comparison.calmDelta !== null
              ? `${formatDeltaCalm(comparison.calmDelta)} vs yesterday`
              : 'Yesterday had no logged time'}
          </span>
        </div>

        <div className="metric-item">
          <span className="metric-label">Overall redirect rate</span>
          <span className="metric-value tabular">
            {comparison.overallRate !== null ? `${comparison.overallRate}%` : '—'}
          </span>
          <span className="metric-footnote">
            {comparison.totalRedirected + comparison.totalGrace > 0
              ? `${comparison.totalRedirected} redirected · ${comparison.totalGrace} grace`
              : 'Grows as urges are noticed'}
          </span>
        </div>

        <div className="metric-item">
          <span className="metric-label">Active days (14d)</span>
          <span className="metric-value tabular">{comparison.activeDays14} / 14</span>
          <span className="metric-footnote">
            {comparison.last7CalmAvg > 0
              ? `7-day avg ${formatShortDuration(comparison.last7CalmAvg)}/day`
              : `${comparison.totalDays} total days tracked`}
          </span>
        </div>
      </section>

      {/* Interactive 14-day Trend Chart */}
      <section className="editorial-section" aria-label="Fourteen-day trend">
        <div className="section-head-row">
          <h2 className="section-heading">Last 14 days</h2>
          <div className="segmented" role="group" aria-label="Select progress metric">
            <button
              type="button"
              className={`segmented-btn ${metric === 'calm' ? 'segmented-btn--active' : ''}`}
              onClick={() => setMetric('calm')}
            >
              Calm
            </button>
            <button
              type="button"
              className={`segmented-btn ${metric === 'redirectRate' ? 'segmented-btn--active' : ''}`}
              onClick={() => setMetric('redirectRate')}
            >
              Redirect %
            </button>
            <button
              type="button"
              className={`segmented-btn ${metric === 'redirected' ? 'segmented-btn--active' : ''}`}
              onClick={() => setMetric('redirected')}
            >
              Caught
            </button>
            <button
              type="button"
              className={`segmented-btn ${metric === 'grace' ? 'segmented-btn--active' : ''}`}
              onClick={() => setMetric('grace')}
            >
              Grace
            </button>
          </div>
        </div>

        <div className="trend-card">
          <div className="trend-bars" role="list" aria-label="14 day bar chart">
            {last14Days.map((row, idx) => {
              const val = chartValues.raw[idx];
              const isEmpty =
                metric === 'redirectRate' ? row.redirectRate === null : val === 0;
              const pct = isEmpty
                ? 5
                : Math.max(10, Math.round((val / chartValues.maxVal) * 100));
              const isSelected = row.dateKey === selectedDay.dateKey;

              return (
                <button
                  key={row.dateKey}
                  type="button"
                  role="listitem"
                  className={`trend-col ${isSelected ? 'trend-col--selected' : ''}`}
                  aria-label={`${row.fullLabel}: ${formatDuration(row.summary.calmSeconds)} calm, ${row.summary.urgesRedirected} redirected`}
                  onClick={() => setSelectedKey(row.dateKey)}
                >
                  <span className="trend-bar-track">
                    <span
                      className={`trend-bar ${row.isToday ? 'trend-bar--today' : ''} ${
                        isEmpty ? 'trend-bar--empty' : ''
                      } ${metric === 'grace' && !isEmpty ? 'trend-bar--grace' : ''}`}
                      style={{ height: `${pct}%` }}
                    />
                  </span>
                  <span className={`trend-day-label ${row.isToday ? 'trend-day-label--today' : ''}`}>
                    {row.shortLabel}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Inspected day detail strip */}
          <div className="trend-detail-strip">
            <span className="trend-detail-date">{selectedDay.fullLabel}</span>
            <div className="trend-detail-stats tabular">
              <span>{formatDuration(selectedDay.summary.calmSeconds)} calm</span>
              <span>·</span>
              <span>{selectedDay.summary.urgesRedirected} redirected</span>
              <span>·</span>
              <span>{selectedDay.summary.graceRecoveries} grace</span>
              {selectedDay.redirectRate !== null && (
                <>
                  <span>·</span>
                  <span>{selectedDay.redirectRate}% caught</span>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Day-by-Day History Log */}
      <section className="editorial-section" aria-label="Day-by-day history">
        <div className="section-head-row">
          <h2 className="section-heading">Day-by-day log</h2>
          <span className="section-meta">{historyRows.length} days</span>
        </div>

        <div className="history-table">
          <div className="history-header-row" aria-hidden="true">
            <span>Day</span>
            <span>Calm time</span>
            <span>Redirected</span>
            <span>Grace</span>
            <span>Rate</span>
          </div>

          {historyRows.map((row) => (
            <div
              key={row.dateKey}
              className={`history-row ${row.isToday ? 'history-row--today' : ''}`}
            >
              <div className="history-day-cell">
                <span className="history-day-name">{row.fullLabel}</span>
                {row.deltaCalmSec !== null && row.deltaCalmSec !== 0 && (
                  <span
                    className={`delta-badge ${
                      row.deltaCalmSec > 0 ? 'delta-badge--up' : 'delta-badge--down'
                    }`}
                  >
                    {formatDeltaCalm(row.deltaCalmSec)}
                  </span>
                )}
              </div>
              <span className="tabular">{formatDuration(row.summary.calmSeconds)}</span>
              <span className="tabular">{row.summary.urgesRedirected}</span>
              <span className="tabular">{row.summary.graceRecoveries}</span>
              <span className="tabular history-rate">
                {row.redirectRate !== null ? `${row.redirectRate}%` : '—'}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Portable Local Sync (Move history between iPad & other computers) */}
      <section className="portable-sync-box" aria-label="Move progress between devices">
        <div className="portable-sync-copy">
          <h3 className="portable-sync-title">Using Still on another computer or browser?</h3>
          <p className="portable-sync-desc">
            Because Still stores everything 100% locally with zero cloud servers, each browser keeps
            its own history. Export a JSON backup to carry or merge your day-over-day progress onto
            another device anytime.
          </p>
        </div>
        <div className="portable-sync-actions">
          <button
            type="button"
            id="btn-progress-export"
            className="btn btn-subtle btn-sm"
            onClick={onExportData}
          >
            Export JSON
          </button>
          <button
            type="button"
            id="btn-progress-import"
            className="btn btn-ghost btn-sm"
            onClick={() => fileInputRef.current?.click()}
          >
            Import &amp; merge JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={handleFileChange}
          />
        </div>
      </section>
    </div>
  );
}

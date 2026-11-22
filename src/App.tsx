import { useCallback, useEffect, useMemo, useState } from 'react';
import { EdgeGlow } from './components/EdgeGlow';
import { NotesView } from './components/NotesView';
import { PauseSheet } from './components/PauseSheet';
import { TodayView } from './components/TodayView';
import { WhatWorksView } from './components/WhatWorksView';
import { useStillSession } from './hooks/useStillSession';
import {
  clearAllLocalData,
  createId,
  getEmptyDay,
  getLocalDateKey,
  loadDays,
  loadEvents,
  loadNotes,
  loadSettings,
  saveDays,
  saveEvents,
  saveNotes,
  saveSettings,
} from './lib/storage';
import type {
  AwarenessEvent,
  DaySummary,
  NoteEntry,
  StillSettings,
  TabId,
  ThemeMode,
} from './types';

function getInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem('still:theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // ignore
  }
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function App() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [activeTab, setActiveTab] = useState<TabId>('today');
  const [settings, setSettings] = useState<StillSettings>(loadSettings);
  const [days, setDays] = useState<Record<string, DaySummary>>(loadDays);
  const [events, setEvents] = useState<AwarenessEvent[]>(loadEvents);
  const [notes, setNotes] = useState<NoteEntry[]>(loadNotes);
  const [calibrationOpen, setCalibrationOpen] = useState(false);

  const [pauseSheetState, setPauseSheetState] = useState<{
    open: boolean;
    isPreview: boolean;
  }>({ open: false, isPreview: false });

  // Apply theme attribute & persist
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('still:theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const updateSettings = useCallback((patch: Partial<StillSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const appendEvent = useCallback((ev: AwarenessEvent) => {
    setEvents((prev) => {
      const next = [ev, ...prev].slice(0, 500);
      saveEvents(next);
      return next;
    });
  }, []);

  const updateTodaySummary = useCallback((updater: (cur: DaySummary) => DaySummary) => {
    const dateKey = getLocalDateKey();
    setDays((prev) => {
      const current = prev[dateKey] ?? getEmptyDay(dateKey);
      const updated = updater(current);
      const next = { ...prev, [dateKey]: updated };
      saveDays(next);
      return next;
    });
  }, []);

  const handleAddCalmSecond = useCallback(() => {
    updateTodaySummary((cur) => ({ ...cur, calmSeconds: cur.calmSeconds + 1 }));
  }, [updateTodaySummary]);

  const handleStage1AutoCaught = useCallback(() => {
    const id = createId();
    const dateKey = getLocalDateKey();
    updateTodaySummary((cur) => ({
      ...cur,
      urgesRedirected: cur.urgesRedirected + 1,
    }));
    appendEvent({
      id,
      timestamp: Date.now(),
      dateKey,
      kind: 'redirect-stage1',
    });
    return id;
  }, [appendEvent, updateTodaySummary]);

  const handleStage2Triggered = useCallback(() => {
    setPauseSheetState({ open: true, isPreview: false });
  }, []);

  const session = useStillSession({
    settings,
    onAddCalmSecond: handleAddCalmSecond,
    onStage1AutoCaught: handleStage1AutoCaught,
    onStage2Triggered: handleStage2Triggered,
    pauseSheetOpen: pauseSheetState.open,
  });

  // Ensure webkit-playsinline attribute is explicitly set on the live video element for iPadOS Safari
  useEffect(() => {
    const v = session.videoRef.current;
    if (v) {
      v.setAttribute('webkit-playsinline', 'true');
      v.setAttribute('playsinline', 'true');
    }
  }, [session.videoRef]);

  // Undo a Stage 1 auto-catch as a false alarm from the whisper bar
  const handleUndoAutoCatchAsFalseAlarm = useCallback(
    (eventId: string) => {
      const dateKey = getLocalDateKey();
      setEvents((prev) => {
        const next = prev.filter((e) => e.id !== eventId);
        saveEvents(next);
        return next;
      });
      updateTodaySummary((cur) => ({
        ...cur,
        urgesRedirected: Math.max(0, cur.urgesRedirected - 1),
        falseAlarms: cur.falseAlarms + 1,
      }));
      appendEvent({
        id: createId(),
        timestamp: Date.now(),
        dateKey,
        kind: 'false-alarm',
      });
      session.dismissWhisper();
      session.showWhisper('Undone · marked as false alarm', undefined, 3500);
    },
    [appendEvent, session, updateTodaySummary]
  );

  // Stage 2 PauseSheet handlers
  const handlePauseAutoCatch = useCallback(
    (responseId: string) => {
      const wasPreview = pauseSheetState.isPreview;
      setPauseSheetState({ open: false, isPreview: false });
      session.resetDwellState();
      if (!wasPreview) {
        const dateKey = getLocalDateKey();
        updateTodaySummary((cur) => ({
          ...cur,
          urgesRedirected: cur.urgesRedirected + 1,
        }));
        appendEvent({
          id: createId(),
          timestamp: Date.now(),
          dateKey,
          kind: 'redirect-stage2',
          responseId,
        });
        session.showWhisper('Urge redirected · calm time continues', undefined, 4500);
      } else {
        session.showWhisper('Pause sheet preview complete', undefined, 3000);
      }
    },
    [appendEvent, pauseSheetState.isPreview, session, updateTodaySummary]
  );

  const handlePauseGraceRecovery = useCallback(
    (tag?: string) => {
      const wasPreview = pauseSheetState.isPreview;
      setPauseSheetState({ open: false, isPreview: false });
      session.resetDwellState();
      if (!wasPreview) {
        const dateKey = getLocalDateKey();
        updateTodaySummary((cur) => ({
          ...cur,
          graceRecoveries: cur.graceRecoveries + 1,
        }));
        appendEvent({
          id: createId(),
          timestamp: Date.now(),
          dateKey,
          kind: 'grace',
          tag,
        });
        session.showWhisper('Grace recovery noted · continuing gently', undefined, 4500);
      } else {
        session.showWhisper('Grace recovery previewed (not logged)', undefined, 3000);
      }
    },
    [appendEvent, pauseSheetState.isPreview, session, updateTodaySummary]
  );

  const handlePauseFalseAlarm = useCallback(() => {
    const wasPreview = pauseSheetState.isPreview;
    setPauseSheetState({ open: false, isPreview: false });
    session.resetDwellState();
    if (!wasPreview) {
      const dateKey = getLocalDateKey();
      updateTodaySummary((cur) => ({
        ...cur,
        falseAlarms: cur.falseAlarms + 1,
      }));
      appendEvent({
        id: createId(),
        timestamp: Date.now(),
        dateKey,
        kind: 'false-alarm',
      });
      session.showWhisper('Dismissed as false alarm', undefined, 3500);
    }
  }, [appendEvent, pauseSheetState.isPreview, session, updateTodaySummary]);

  // Welcome Back check-in handlers
  const handleWelcomeCalm = useCallback(
    (addAwayMinutes: boolean) => {
      const mins = session.welcomeBack?.awayMinutes ?? 5;
      if (addAwayMinutes) {
        updateTodaySummary((cur) => ({
          ...cur,
          calmSeconds: cur.calmSeconds + mins * 60,
        }));
      }
      appendEvent({
        id: createId(),
        timestamp: Date.now(),
        dateKey: getLocalDateKey(),
        kind: 'welcome-back-calm',
        note: `Returned calm after ${mins}m away`,
      });
      session.dismissWelcomeBack();
      session.showWhisper(`Welcome back · +${mins}m added to calm time`, undefined, 4500);
    },
    [appendEvent, session, updateTodaySummary]
  );

  const handleWelcomeRedirect = useCallback(() => {
    updateTodaySummary((cur) => ({
      ...cur,
      urgesRedirected: cur.urgesRedirected + 1,
    }));
    appendEvent({
      id: createId(),
      timestamp: Date.now(),
      dateKey: getLocalDateKey(),
      kind: 'redirect-stage1',
      note: 'Redirected while away',
    });
    session.dismissWelcomeBack();
    session.showWhisper('Welcome back · redirect logged', undefined, 4000);
  }, [appendEvent, session, updateTodaySummary]);

  const handleWelcomeGrace = useCallback(() => {
    updateTodaySummary((cur) => ({
      ...cur,
      graceRecoveries: cur.graceRecoveries + 1,
    }));
    appendEvent({
      id: createId(),
      timestamp: Date.now(),
      dateKey: getLocalDateKey(),
      kind: 'grace',
      tag: 'After a walk',
    });
    session.dismissWelcomeBack();
    session.showWhisper('Welcome back · reset with grace', undefined, 4000);
  }, [appendEvent, session, updateTodaySummary]);

  // Notes handlers
  const handleAddNote = useCallback((text: string, tags: string[]) => {
    const entry: NoteEntry = {
      id: createId(),
      timestamp: Date.now(),
      dateKey: getLocalDateKey(),
      text,
      tags,
    };
    setNotes((prev) => {
      const next = [entry, ...prev];
      saveNotes(next);
      return next;
    });
  }, []);

  const handleDeleteNote = useCallback((id: string) => {
    setNotes((prev) => {
      const next = prev.filter((n) => n.id !== id);
      saveNotes(next);
      return next;
    });
  }, []);

  const handleExportData = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      settings,
      days,
      events,
      notes,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `still-local-export-${getLocalDateKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [days, events, notes, settings]);

  const handleClearData = useCallback(() => {
    clearAllLocalData();
    setDays({});
    setEvents([]);
    setNotes([]);
    session.showWhisper('Local history cleared', undefined, 3500);
  }, [session]);

  const todayKey = getLocalDateKey();
  const today = days[todayKey] ?? getEmptyDay(todayKey);

  const totalCalmSeconds = useMemo(
    () => Object.values(days).reduce((acc, d) => acc + d.calmSeconds, 0),
    [days]
  );

  return (
    <div className="app-shell">
      {/* Warm peripheral edge glow (Stage 1 visual cue) */}
      <EdgeGlow active={session.edgeGlowActive} />

      {/* CRITICAL iPadOS Safari Fix: keep <video autoplay playsinline muted> visibly rendered
          at 2x2px opacity 0.001 (never hidden / display:none) across all views */}
      <video
        ref={session.videoRef}
        className="safari-live-video"
        autoPlay
        playsInline
        muted
        aria-hidden="true"
      />

      {/* Minimal Claude-inspired Header */}
      <header className="top-header">
        <div className="top-header-inner">
          <div className="brand-group">
            <span className="brand-mark" aria-hidden="true">
              <span
                className={`brand-dot ${session.status === 'running' ? 'brand-dot--live' : ''}`}
              />
            </span>
            <span className="brand-name">Still</span>
          </div>

          <nav className="nav-tabs" aria-label="Primary navigation">
            <button
              type="button"
              id="nav-today"
              className={`nav-tab ${activeTab === 'today' ? 'nav-tab--active' : ''}`}
              aria-current={activeTab === 'today' ? 'page' : undefined}
              onClick={() => setActiveTab('today')}
            >
              Today
            </button>
            <button
              type="button"
              id="nav-what-works"
              className={`nav-tab ${activeTab === 'what-works' ? 'nav-tab--active' : ''}`}
              aria-current={activeTab === 'what-works' ? 'page' : undefined}
              onClick={() => setActiveTab('what-works')}
            >
              What works
            </button>
            <button
              type="button"
              id="nav-notes"
              className={`nav-tab ${activeTab === 'notes' ? 'nav-tab--active' : ''}`}
              aria-current={activeTab === 'notes' ? 'page' : undefined}
              onClick={() => setActiveTab('notes')}
            >
              Notes
            </button>
          </nav>

          <button
            type="button"
            id="btn-theme-toggle"
            className="theme-btn"
            aria-label={`Switch to ${theme === 'light' ? 'dark editorial' : 'warm paper'} theme`}
            title={theme === 'light' ? 'Dark editorial theme' : 'Warm paper theme'}
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? 'Dark' : 'Paper'}
          </button>
        </div>
      </header>

      {/* Main Centered Editorial Column */}
      <main className="main-column">
        {activeTab === 'today' && (
          <TodayView
            status={session.status}
            errorMessage={session.errorMessage}
            today={today}
            totalCalmSeconds={totalCalmSeconds}
            settings={settings}
            onUpdateSettings={updateSettings}
            onStart={() => void session.startSession()}
            onStop={session.stopSession}
            onTestStage1={session.triggerTestCue}
            onTestStage2={() => setPauseSheetState({ open: true, isPreview: true })}
            stage1AutoCatch={session.stage1AutoCatch}
            onCancelStage1FalseAlarm={session.cancelStage1FalseAlarm}
            welcomeBack={session.welcomeBack}
            onWelcomeCalm={handleWelcomeCalm}
            onWelcomeRedirect={handleWelcomeRedirect}
            onWelcomeGrace={handleWelcomeGrace}
            onWelcomeDismiss={session.dismissWelcomeBack}
            calibrationOpen={calibrationOpen}
            onToggleCalibration={() => setCalibrationOpen((o) => !o)}
            videoRef={session.videoRef}
            frameGeometry={session.frameGeometry}
            dwellSec={session.dwellSec}
            diagnostics={session.diagnostics}
          />
        )}

        {activeTab === 'what-works' && (
          <WhatWorksView
            days={days}
            events={events}
            settings={settings}
            onUpdateSettings={updateSettings}
          />
        )}

        {activeTab === 'notes' && (
          <NotesView
            notes={notes}
            events={events}
            onAddNote={handleAddNote}
            onDeleteNote={handleDeleteNote}
            onExportData={handleExportData}
            onClearData={handleClearData}
          />
        )}
      </main>

      {/* Quiet bottom whisper toast */}
      {session.whisper && (
        <div className="whisper-toast" role="status" aria-live="polite">
          <span>{session.whisper.message}</span>
          {session.whisper.undoEventId && (
            <button
              type="button"
              className="whisper-undo"
              onClick={() =>
                handleUndoAutoCatchAsFalseAlarm(session.whisper!.undoEventId!)
              }
            >
              False alarm
            </button>
          )}
        </div>
      )}

      {/* Stage 2 Calm 60-Second Competing-Response Pause Sheet */}
      <PauseSheet
        open={pauseSheetState.open}
        isPreview={pauseSheetState.isPreview}
        handInZone={Boolean(session.frameGeometry?.handInZone)}
        sessionRunning={session.status === 'running'}
        soundEnabled={settings.soundEnabled}
        pinnedResponses={settings.pinnedResponses}
        onAutoCatch={handlePauseAutoCatch}
        onGraceRecovery={handlePauseGraceRecovery}
        onFalseAlarm={handlePauseFalseAlarm}
      />
    </div>
  );
}

export default App;

import type {
  AwarenessEvent,
  CompetingResponse,
  DaySummary,
  NoteEntry,
  StillSettings,
} from '../types';

const KEYS = {
  settings: 'still:settings:v1',
  days: 'still:days:v1',
  events: 'still:events:v1',
  notes: 'still:notes:v1',
  theme: 'still:theme',
} as const;

export const COMPETING_RESPONSES: CompetingResponse[] = [
  {
    id: 'palms-flat',
    title: 'Rest palms flat',
    instruction:
      'Place both palms gently flat on your lap or desk, fingers lightly spread. Let your shoulders drop a centimeter.',
    durationHint: '60 seconds',
    why: 'Incompatible with plucking and discharges fine-motor tension through broad palm contact.',
  },
  {
    id: 'thumb-index-press',
    title: 'Soft thumb & index press',
    instruction:
      'Touch the pads of your thumb and index finger together in your lap with steady, gentle pressure — notice the warmth until the urge crests.',
    durationHint: '60 seconds',
    why: 'Gives the exact fingertips seeking sensory feedback a calm, non-harmful tactile signal.',
  },
  {
    id: 'clasp-and-breathe',
    title: 'Interlace & soften the jaw',
    instruction:
      'Loosely interlace your fingers below chest height. Unclench your jaw and exhale slightly longer than you inhale.',
    durationHint: '60 seconds',
    why: 'Shifts attention from micro-searching to a slower parasympathetic rhythm.',
  },
  {
    id: 'smooth-brow-palm',
    title: 'Cool fingertip reset',
    instruction:
      'If an eyebrow feels itchy or tight, press the flat back of your cool wrist gently over the brow for five seconds, then lower both hands.',
    durationHint: '60 seconds',
    why: 'Addresses sensory discomfort without isolating or pinching individual hairs.',
  },
  {
    id: 'five-min-walk',
    title: 'Step away for water',
    instruction:
      'Stand up, take a slow sip of water, or walk around the room for five minutes. Still will welcome you back when you return.',
    durationHint: '5 minutes',
    why: 'Breaks trance-like reading or screen posture where unconscious hand drift thrives.',
  },
];

export const ENVIRONMENT_ANCHORS = [
  {
    id: 'keep-hands-occupied',
    title: 'Give the idle hand a quiet anchor',
    detail: 'Hold a smooth stone, pen, or warm mug while reading long pages.',
  },
  {
    id: 'hydrate-brows',
    title: 'Soothe dry skin or tight brows early',
    detail: 'A dab of light balm or moisturizer removes the tactile snag that triggers searching.',
  },
  {
    id: 'soften-lighting',
    title: 'Soften harsh overhead light',
    detail: 'Warm ambient light reduces eye strain and brow tension during evening focus.',
  },
  {
    id: 'five-min-walk-anchor',
    title: 'Take a 5-minute walk when restlessness spikes',
    detail: 'Short movement resets nervous-system restlessness faster than willpower alone.',
  },
  {
    id: 'glasses-fit',
    title: 'Notice glasses or posture drift',
    detail: 'Leaning your chin into your hand brings fingertips millimeters from your brow.',
  },
];

export const CONTEXT_TAGS = [
  'Reading',
  'Deep focus',
  'Evening',
  'Tired',
  'Restless',
  'Dry skin',
  'After a walk',
];

export const DEFAULT_SETTINGS: StillSettings = {
  stage1Enabled: true,
  stage2Enabled: true,
  soundEnabled: true,
  stage1DwellSec: 1.2,
  stage2DwellSec: 2.6,
  zoneScale: 1.0,
  previewMode: 'silhouette',
  pinnedResponses: ['palms-flat', 'thumb-index-press'],
  checkedAnchors: [],
};

export function getLocalDateKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors in restricted private browsing
  }
}

export function loadSettings(): StillSettings {
  const saved = readJson<Partial<StillSettings>>(KEYS.settings, {});
  return { ...DEFAULT_SETTINGS, ...saved };
}

export function saveSettings(settings: StillSettings): void {
  writeJson(KEYS.settings, settings);
}

export function loadDays(): Record<string, DaySummary> {
  return readJson<Record<string, DaySummary>>(KEYS.days, {});
}

export function saveDays(days: Record<string, DaySummary>): void {
  writeJson(KEYS.days, days);
}

export function getEmptyDay(dateKey: string): DaySummary {
  return {
    dateKey,
    calmSeconds: 0,
    urgesRedirected: 0,
    graceRecoveries: 0,
    falseAlarms: 0,
  };
}

export function loadEvents(): AwarenessEvent[] {
  return readJson<AwarenessEvent[]>(KEYS.events, []);
}

export function saveEvents(events: AwarenessEvent[]): void {
  // Keep latest 500 events locally
  writeJson(KEYS.events, events.slice(0, 500));
}

export function loadNotes(): NoteEntry[] {
  return readJson<NoteEntry[]>(KEYS.notes, []);
}

export function saveNotes(notes: NoteEntry[]): void {
  writeJson(KEYS.notes, notes.slice(0, 300));
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  if (mins > 0) {
    return `${mins}m ${String(secs).padStart(2, '0')}s`;
  }
  return `${secs}s`;
}

export function formatShortDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return `${s}s`;
}

export function clearAllLocalData(): void {
  try {
    localStorage.removeItem(KEYS.days);
    localStorage.removeItem(KEYS.events);
    localStorage.removeItem(KEYS.notes);
  } catch {
    // ignore
  }
}

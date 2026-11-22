export type ThemeMode = 'light' | 'dark';
export type TabId = 'today' | 'what-works' | 'notes';
export type PreviewMode = 'silhouette' | 'camera';
export type DelegateMode = 'GPU' | 'CPU' | null;

export interface StillSettings {
  stage1Enabled: boolean;
  stage2Enabled: boolean;
  soundEnabled: boolean;
  stage1DwellSec: number; // default 1.2s
  stage2DwellSec: number; // default 2.6s
  zoneScale: number; // multiplier on eye-width normalized halo, default 1.0 (maps to ~0.26 * eyeSpan)
  previewMode: PreviewMode;
  pinnedResponses: string[];
  checkedAnchors: string[];
}

export type AwarenessEventKind =
  | 'redirect-stage1'
  | 'redirect-stage2'
  | 'grace'
  | 'false-alarm'
  | 'welcome-back-calm';

export interface AwarenessEvent {
  id: string;
  timestamp: number;
  dateKey: string; // YYYY-MM-DD local
  kind: AwarenessEventKind;
  note?: string;
  tag?: string;
  responseId?: string;
}

export interface DaySummary {
  dateKey: string;
  calmSeconds: number;
  urgesRedirected: number;
  graceRecoveries: number;
  falseAlarms: number;
}

export interface NoteEntry {
  id: string;
  timestamp: number;
  dateKey: string;
  text: string;
  tags: string[];
}

export interface CompetingResponse {
  id: string;
  title: string;
  instruction: string;
  durationHint: string;
  why: string;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface FrameGeometry {
  videoWidth: number;
  videoHeight: number;
  facePresent: boolean;
  usingOcclusionCache: boolean;
  faceOval: Point2D[];
  leftBrow: Point2D[];
  rightBrow: Point2D[];
  leftEye: Point2D[];
  rightEye: Point2D[];
  eyeSpan: number; // aspect-corrected isotropic span
  haloRadius: number; // aspect-corrected isotropic radius
  fingertips: Array<Point2D & { inZone: boolean; handIndex: number }>;
  handInZone: boolean;
  closestRatio: number | null; // closest fingertip dist / haloRadius (< 1 means inside)
}

export type EngineStatus =
  | 'idle'
  | 'requesting-camera'
  | 'loading-models'
  | 'running'
  | 'error';

export interface VisionDiagnostics {
  delegate: DelegateMode;
  fps: number;
  faceState: 'detected' | 'cached' | 'away';
  handsCount: number;
  modelsCached: boolean;
  wakeLockActive: boolean;
}

export interface Stage1AutoCatch {
  startedAt: number;
  handClearedAt: number | null;
  remainingSec: number;
}

export interface WelcomeBackPrompt {
  awayMinutes: number;
  reason: 'stepped-away' | 'tab-returned';
}

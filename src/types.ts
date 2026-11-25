export type ThemeMode = 'light' | 'dark';
export type TabId = 'today' | 'progress' | 'what-works' | 'notes' | 'settings';
export type PreviewMode = 'silhouette' | 'camera';
export type DelegateMode = 'GPU' | 'CPU' | null;
export type DetectionZoneId = 'left-brow' | 'right-brow' | 'lashes' | 'hairline';
export type PiPKind = 'none' | 'document' | 'video';

export interface StillSettings {
  userName: string;
  stage1Enabled: boolean;
  stage2Enabled: boolean;
  soundEnabled: boolean;
  stage2RepeatChime: boolean;
  autoPipOnTabSwitch: boolean;
  stage1DwellSec: number; // default 1.2s
  stage2DwellSec: number; // default 2.6s
  zoneScale: number; // multiplier on eye-width normalized halo, default 1.0
  activeZones: DetectionZoneId[];
  pinchFilterEnabled: boolean; // optional thumb-index/middle pinch filter to reduce casual scratch false alarms
  smartFalseAlarmGuard: boolean; // high-recall precision guard for ear touches & drinking from a glass
  selectedCameraId: string; // '' = automatic front-facing camera selection
  previewMode: PreviewMode;
  pinnedResponses: string[];
  checkedAnchors: string[];
}

export interface CameraDeviceOption {
  deviceId: string;
  label: string;
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

export interface ZoneGeometry {
  id: DetectionZoneId;
  points: Point2D[];
  closed: boolean;
  radius: number; // aspect-corrected isotropic radius
}

export interface FrameGeometry {
  videoWidth: number;
  videoHeight: number;
  facePresent: boolean;
  usingOcclusionCache: boolean;
  sideAngle: boolean;
  topDownAngle: boolean;
  faceOval: Point2D[];
  leftEye: Point2D[];
  rightEye: Point2D[];
  activeZones: ZoneGeometry[];
  eyeSpan: number; // yaw-invariant normalized face scale
  haloRadius: number; // primary brow isotropic radius
  fingertips: Array<Point2D & { inZone: boolean; handIndex: number; pinching: boolean }>;
  handInZone: boolean;
  filteredReason: 'ear' | 'drinking' | 'foreground' | 'below-brow' | null;
  closestRatio: number | null; // closest fingertip dist / zoneRadius (< 1 means inside)
}

export type EngineStatus =
  | 'idle'
  | 'requesting-camera'
  | 'loading-models'
  | 'choosing-camera'
  | 'running'
  | 'error';

export interface VisionDiagnostics {
  delegate: DelegateMode;
  fps: number;
  faceState: 'detected' | 'cached' | 'away';
  sideAngle: boolean;
  topDownAngle?: boolean;
  cameraState: 'live' | 'muted' | 'ended';
  cameraStalled: boolean;
  cameraLabel?: string;
  detectCount: number;
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

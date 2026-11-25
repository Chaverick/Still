import { useEffect, useRef } from 'react';
import { ZONE_OPTIONS } from '../lib/storage';
import type {
  CameraDeviceOption,
  DetectionZoneId,
  FrameGeometry,
  Point2D,
  PreviewMode,
  StillSettings,
  VisionDiagnostics,
} from '../types';

interface CalibrationDrawerProps {
  expanded: boolean;
  onToggleExpand: () => void;
  settings: StillSettings;
  availableCameras: CameraDeviceOption[];
  onUpdateSettings: (patch: Partial<StillSettings>) => void;
  onSelectCamera: (deviceId: string) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  frameGeometry: FrameGeometry | null;
  dwellSec: number;
  sessionRunning: boolean;
  diagnostics: VisionDiagnostics;
}

function drawMirroredPoly(
  ctx: CanvasRenderingContext2D,
  pts: Point2D[],
  w: number,
  h: number,
  closed = true
) {
  if (pts.length < 2) return;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const x = (1 - pts[i].x) * w;
    const y = pts[i].y * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  if (closed) ctx.closePath();
}

export function CalibrationDrawer({
  expanded,
  onToggleExpand,
  settings,
  availableCameras,
  onUpdateSettings,
  onSelectCamera,
  videoRef,
  frameGeometry,
  dwellSec,
  sessionRunning,
  diagnostics,
}: CalibrationDrawerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Render mirrored Silhouette or Camera calibration preview onto canvas
  useEffect(() => {
    if (!expanded) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const styles = getComputedStyle(document.documentElement);
    const bg = styles.getPropertyValue('--surface-canvas').trim() || '#F4F1EA';
    const inkMuted = styles.getPropertyValue('--ink-muted').trim() || '#8A867E';
    const accent = styles.getPropertyValue('--accent').trim() || '#C96442';
    const sage = styles.getPropertyValue('--sage').trim() || '#5A7D65';

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const video = videoRef.current;
    const showCamera =
      settings.previewMode === 'camera' &&
      sessionRunning &&
      video &&
      video.readyState >= 2 &&
      video.videoWidth > 0;

    if (showCamera && video) {
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      const vAspect = video.videoWidth / video.videoHeight;
      const cAspect = w / h;
      let drawW = w;
      let drawH = h;
      let dx = 0;
      let dy = 0;
      if (vAspect > cAspect) {
        drawW = h * vAspect;
        dx = (w - drawW) / 2;
      } else {
        drawH = w / vAspect;
        dy = (h - drawH) / 2;
      }
      ctx.drawImage(video, dx, dy, drawW, drawH);
      ctx.restore();
      ctx.fillStyle = 'rgba(26, 25, 23, 0.14)';
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
    }

    if (!sessionRunning || !frameGeometry) {
      ctx.save();
      ctx.strokeStyle = inkMuted;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, 58, 74, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(w / 2 - 22, h / 2 - 12, 16, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(w / 2 + 22, h / 2 - 12, 16, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const vAspect = frameGeometry.videoWidth / Math.max(1, frameGeometry.videoHeight);
    const cAspect = w / h;
    let mapW = w;
    let mapH = h;
    let offsetX = 0;
    let offsetY = 0;
    if (showCamera) {
      if (vAspect > cAspect) {
        mapW = h * vAspect;
        offsetX = (w - mapW) / 2;
      } else {
        mapH = w / vAspect;
        offsetY = (h - mapH) / 2;
      }
    }

    const mapPts = (pts: Point2D[]): Point2D[] =>
      pts.map((p) => ({
        x: 1 - (offsetX + (1 - p.x) * mapW) / w,
        y: (offsetY + p.y * mapH) / h,
      }));

    if (frameGeometry.facePresent) {
      const oval = mapPts(frameGeometry.faceOval);
      const leftEye = mapPts(frameGeometry.leftEye);
      const rightEye = mapPts(frameGeometry.rightEye);

      // Face oval outline
      ctx.save();
      drawMirroredPoly(ctx, oval, w, h, true);
      ctx.strokeStyle = showCamera ? 'rgba(255,255,255,0.35)' : inkMuted;
      ctx.globalAlpha = frameGeometry.usingOcclusionCache ? 0.25 : 0.4;
      ctx.lineWidth = 1.5;
      if (frameGeometry.usingOcclusionCache) ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.restore();

      // Subtle eye curves in silhouette mode
      if (!showCamera) {
        ctx.save();
        ctx.strokeStyle = inkMuted;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1.25;
        drawMirroredPoly(ctx, leftEye, w, h, true);
        ctx.stroke();
        drawMirroredPoly(ctx, rightEye, w, h, true);
        ctx.stroke();
        ctx.restore();
      }

      // Draw every active detection zone with its exact isotropic halo radius
      for (const zone of frameGeometry.activeZones) {
        const pts = mapPts(zone.points);
        if (pts.length < 2) continue;
        const haloPx = zone.radius * mapH;
        ctx.save();
        drawMirroredPoly(ctx, pts, w, h, zone.closed);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(10, haloPx * 2);
        ctx.strokeStyle = frameGeometry.handInZone ? accent : sage;
        ctx.globalAlpha = frameGeometry.handInZone ? 0.24 : 0.15;
        ctx.stroke();

        ctx.lineWidth = 2;
        ctx.globalAlpha = frameGeometry.handInZone ? 0.92 : 0.65;
        ctx.stroke();
        ctx.restore();
      }
    }

    // Fingertip markers
    for (const tip of frameGeometry.fingertips) {
      const fx = offsetX + (1 - tip.x) * mapW;
      const fy = offsetY + tip.y * mapH;
      ctx.save();
      ctx.beginPath();
      ctx.arc(fx, fy, tip.inZone ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = tip.inZone ? accent : showCamera ? '#FAF9F5' : inkMuted;
      ctx.globalAlpha = tip.inZone ? 0.95 : 0.72;
      ctx.fill();
      if (tip.inZone) {
        ctx.beginPath();
        ctx.arc(fx, fy, 13, 0, Math.PI * 2);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.45;
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [expanded, frameGeometry, sessionRunning, settings.previewMode, videoRef]);

  const maxBar = Math.max(settings.stage2DwellSec, settings.stage1DwellSec + 0.5);
  const dwellPct = Math.min(100, (dwellSec / maxBar) * 100);
  const stage1MarkerPct = Math.min(95, (settings.stage1DwellSec / maxBar) * 100);

  const setPreviewMode = (previewMode: PreviewMode) => {
    onUpdateSettings({ previewMode });
  };

  const toggleZone = (id: DetectionZoneId) => {
    const exists = settings.activeZones.includes(id);
    if (exists && settings.activeZones.length <= 1) {
      // Keep at least one detection zone enabled
      return;
    }
    const next = exists
      ? settings.activeZones.filter((z) => z !== id)
      : [...settings.activeZones, id];
    onUpdateSettings({ activeZones: next });
  };

  return (
    <section className="calibration-section" aria-label="Calibration and preview">
      <button
        type="button"
        id="btn-toggle-calibration"
        className="calibration-toggle"
        aria-expanded={expanded}
        onClick={onToggleExpand}
      >
        <div className="calibration-toggle-left">
          <span className="calibration-toggle-title">Calibration, zones &amp; preview</span>
          <span className="calibration-toggle-meta">
            {sessionRunning
              ? `${diagnostics.fps.toFixed(1)} FPS · Local${diagnostics.delegate ? ` · ${diagnostics.delegate}` : ''}${diagnostics.wakeLockActive ? ' · Wake Lock' : ''}`
              : diagnostics.modelsCached
                ? '100% local · Offline models ready'
                : '100% local · On-device vision'}
          </span>
        </div>
        <span className={`chevron ${expanded ? 'chevron--open' : ''}`} aria-hidden="true">
          ▾
        </span>
      </button>

      {expanded && (
        <div className="calibration-body">
          <div className="preview-toolbar">
            <div className="segmented" role="group" aria-label="Preview mode">
              <button
                type="button"
                className={`segmented-btn ${settings.previewMode === 'silhouette' ? 'segmented-btn--active' : ''}`}
                onClick={() => setPreviewMode('silhouette')}
              >
                Silhouette
              </button>
              <button
                type="button"
                className={`segmented-btn ${settings.previewMode === 'camera' ? 'segmented-btn--active' : ''}`}
                onClick={() => setPreviewMode('camera')}
              >
                Camera
              </button>
            </div>
            <span className="preview-status-pill">
              {!sessionRunning
                ? 'Start session to calibrate'
                : diagnostics.cameraState !== 'live'
                  ? 'Camera paused by OS'
                  : frameGeometry?.filteredReason === 'ear'
                    ? 'Ignoring ear touch'
                    : frameGeometry?.filteredReason === 'drinking'
                      ? 'Ignoring drink / glass'
                      : frameGeometry?.filteredReason === 'below-brow'
                        ? 'Ignoring below-brow overlap'
                        : frameGeometry?.filteredReason === 'foreground'
                          ? 'Hand in foreground (ignored)'
                          : diagnostics.faceState === 'detected'
                            ? `${diagnostics.topDownAngle ? 'Top-down · tuned' : diagnostics.sideAngle ? 'Side angle · boosted' : 'Face locked'} · ${diagnostics.handsCount} ${diagnostics.handsCount === 1 ? 'hand' : 'hands'}`
                            : diagnostics.faceState === 'cached'
                              ? 'Occlusion cache active (up to 5s)'
                              : 'Face out of frame'}
            </span>
          </div>

          {/* Camera picker (auto picks front-facing desk camera over side laptop camera) */}
          {availableCameras.length > 0 && (
            <div className="camera-picker-row">
              <div className="slider-head">
                <label htmlFor="select-cal-camera" className="slider-label">
                  Camera
                </label>
                {sessionRunning && availableCameras.length >= 2 ? (
                  <button
                    type="button"
                    className="text-link-btn"
                    onClick={() => onSelectCamera('')}
                  >
                    Re-scan front camera
                  </button>
                ) : (
                  <span className="slider-value">
                    {diagnostics.cameraLabel || 'Auto front-facing'}
                  </span>
                )}
              </div>
              <select
                id="select-cal-camera"
                className="editorial-select"
                value={settings.selectedCameraId}
                onChange={(e) => onSelectCamera(e.target.value)}
              >
                <option value="">Automatic (pick camera straight in front of face)</option>
                {availableCameras.map((cam) => (
                  <option key={cam.deviceId} value={cam.deviceId}>
                    {cam.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="preview-frame">
            <canvas
              ref={canvasRef}
              width={560}
              height={320}
              className="preview-canvas"
              aria-label={
                settings.previewMode === 'silhouette'
                  ? 'Abstract detection zone silhouette preview'
                  : 'Mirrored camera preview with detection zone overlay'
              }
            />
          </div>

          {/* Live dwell bar */}
          <div className="dwell-meter-block">
            <div className="dwell-meter-labels">
              <span>Active zone proximity dwell</span>
              <span className="tabular">{dwellSec.toFixed(1)}s</span>
            </div>
            <div className="dwell-track">
              <div className="dwell-fill" style={{ width: `${dwellPct}%` }} />
              <div
                className="dwell-marker"
                style={{ left: `${stage1MarkerPct}%` }}
                title={`Stage 1 (${settings.stage1DwellSec.toFixed(1)}s)`}
              />
            </div>
            <div className="dwell-scale-hints">
              <span>0s</span>
              <span>Stage 1 · {settings.stage1DwellSec.toFixed(1)}s</span>
              <span>Stage 2 · {settings.stage2DwellSec.toFixed(1)}s</span>
            </div>
          </div>

          {/* Custom Zone Presets */}
          <div className="zone-presets-block">
            <div className="slider-head">
              <span className="slider-label">Watched zones</span>
              <span className="slider-value">Choose 1 or more</span>
            </div>
            <div className="tag-row" role="group" aria-label="Detection zones">
              {ZONE_OPTIONS.map((z) => {
                const active = settings.activeZones.includes(z.id);
                return (
                  <button
                    key={z.id}
                    type="button"
                    id={`zone-chip-${z.id}`}
                    aria-pressed={active}
                    className={`tag-chip ${active ? 'tag-chip--selected' : ''}`}
                    onClick={() => toggleZone(z.id)}
                  >
                    {z.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Calibration Sliders */}
          <div className="sliders-grid">
            <label className="slider-row" htmlFor="slider-stage1-dwell">
              <div className="slider-head">
                <span className="slider-label">Stage 1 dwell (glow &amp; chime)</span>
                <span className="slider-value tabular">
                  {settings.stage1DwellSec.toFixed(1)}s
                </span>
              </div>
              <input
                id="slider-stage1-dwell"
                type="range"
                min={0.6}
                max={2.5}
                step={0.1}
                value={settings.stage1DwellSec}
                onChange={(e) => {
                  const next1 = parseFloat(e.target.value);
                  const next2 = Math.max(
                    settings.stage2DwellSec,
                    Number((next1 + 0.6).toFixed(1))
                  );
                  onUpdateSettings({ stage1DwellSec: next1, stage2DwellSec: next2 });
                }}
              />
            </label>

            <label className="slider-row" htmlFor="slider-stage2-dwell">
              <div className="slider-head">
                <span className="slider-label">Stage 2 dwell (60s pause sheet)</span>
                <span className="slider-value tabular">
                  {settings.stage2DwellSec.toFixed(1)}s
                </span>
              </div>
              <input
                id="slider-stage2-dwell"
                type="range"
                min={1.4}
                max={4.5}
                step={0.1}
                value={settings.stage2DwellSec}
                onChange={(e) => {
                  const next2 = parseFloat(e.target.value);
                  const next1 = Math.min(
                    settings.stage1DwellSec,
                    Number((next2 - 0.6).toFixed(1))
                  );
                  onUpdateSettings({
                    stage1DwellSec: Math.max(0.6, next1),
                    stage2DwellSec: next2,
                  });
                }}
              />
            </label>

            <label className="slider-row" htmlFor="slider-zone-scale">
              <div className="slider-head">
                <span className="slider-label">Halo radius (eye-width normalized)</span>
                <span className="slider-value tabular">
                  {settings.zoneScale < 0.85
                    ? 'Tight'
                    : settings.zoneScale > 1.2
                      ? 'Generous'
                      : 'Balanced'}{' '}
                  · {Math.round(settings.zoneScale * 100)}%
                </span>
              </div>
              <input
                id="slider-zone-scale"
                type="range"
                min={0.65}
                max={1.55}
                step={0.05}
                value={settings.zoneScale}
                onChange={(e) =>
                  onUpdateSettings({ zoneScale: parseFloat(e.target.value) })
                }
              />
            </label>
          </div>

          {/* High-Recall Ear-Touch & Drinking Precision Guard */}
          <div className="pinch-filter-row">
            <div className="toggle-copy">
              <span className="slider-label">
                Ignore ear touches, drinking &amp; top-down overlaps (recommended)
              </span>
              <span className="toggle-desc">
                Uses hand-to-face depth scale, ear &amp; eye-line boundaries, sipping cues, and
                top-down camera angle compensation to cut false alarms while keeping full eyebrow
                recall.
              </span>
            </div>
            <button
              type="button"
              id="toggle-smart-guard"
              role="switch"
              aria-checked={settings.smartFalseAlarmGuard}
              aria-label="Toggle ear-touch and drinking false-alarm guard"
              className={`switch ${settings.smartFalseAlarmGuard ? 'switch--on' : ''}`}
              onClick={() =>
                onUpdateSettings({ smartFalseAlarmGuard: !settings.smartFalseAlarmGuard })
              }
            >
              <span className="switch-thumb" />
            </button>
          </div>

          {/* Pinch-Aware Filter Toggle */}
          <div className="pinch-filter-row">
            <div className="toggle-copy">
              <span className="slider-label">Pinch-posture filter (reduces false alarms)</span>
              <span className="toggle-desc">
                Only alert when thumb &amp; index/middle fingertips are pinched close together —
                ignores open-palm resting or quick glasses adjustments.
              </span>
            </div>
            <button
              type="button"
              id="toggle-pinch-filter"
              role="switch"
              aria-checked={settings.pinchFilterEnabled}
              aria-label="Toggle pinch-posture false alarm filter"
              className={`switch ${settings.pinchFilterEnabled ? 'switch--on' : ''}`}
              onClick={() =>
                onUpdateSettings({ pinchFilterEnabled: !settings.pinchFilterEnabled })
              }
            >
              <span className="switch-thumb" />
            </button>
          </div>

          <div className="diagnostics-foot">
            <span>Zero cloud calls · Video never leaves this device</span>
            <span>
              {diagnostics.modelsCached ? 'Cached for offline use' : 'Bundled locally'}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

import { useEffect, useRef } from 'react';
import type {
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
  onUpdateSettings: (patch: Partial<StillSettings>) => void;
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
  onUpdateSettings,
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
      // Cover-fit video into canvas
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
      // Subtle editorial warm scrim over camera feed
      ctx.fillStyle = 'rgba(26, 25, 23, 0.14)';
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
    }

    if (!sessionRunning || !frameGeometry) {
      // Calm resting placeholder illustration
      ctx.save();
      ctx.strokeStyle = inkMuted;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, 58, 74, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Gentle brow arcs
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

    // Compute coordinate mapping matching cover-fit when in camera mode,
    // or full frame when in silhouette mode
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
      const leftBrow = mapPts(frameGeometry.leftBrow);
      const rightBrow = mapPts(frameGeometry.rightBrow);
      const leftEye = mapPts(frameGeometry.leftEye);
      const rightEye = mapPts(frameGeometry.rightEye);

      // Face oval outline (subtle in silhouette, very light in camera)
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

      // Eyebrow halo zones (thick translucent warm stroke scaled by haloRadius)
      const haloPx = frameGeometry.haloRadius * mapH;
      const drawBrowHalo = (browPts: Point2D[]) => {
        if (browPts.length < 2) return;
        ctx.save();
        drawMirroredPoly(ctx, browPts, w, h, true);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(12, haloPx * 2);
        ctx.strokeStyle = frameGeometry.handInZone ? accent : sage;
        ctx.globalAlpha = frameGeometry.handInZone ? 0.26 : 0.16;
        ctx.stroke();

        // Crisp inner brow contour
        ctx.lineWidth = 2;
        ctx.globalAlpha = frameGeometry.handInZone ? 0.92 : 0.65;
        ctx.stroke();
        ctx.restore();
      };

      drawBrowHalo(leftBrow);
      drawBrowHalo(rightBrow);
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
          <span className="calibration-toggle-title">Calibration &amp; preview</span>
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
                : diagnostics.faceState === 'detected'
                  ? `Face locked · ${diagnostics.handsCount} ${diagnostics.handsCount === 1 ? 'hand' : 'hands'}`
                  : diagnostics.faceState === 'cached'
                    ? 'Occlusion cache active (1.5s)'
                    : 'Face out of frame'}
            </span>
          </div>

          <div className="preview-frame">
            <canvas
              ref={canvasRef}
              width={560}
              height={320}
              className="preview-canvas"
              aria-label={
                settings.previewMode === 'silhouette'
                  ? 'Abstract eyebrow halo silhouette preview'
                  : 'Mirrored camera preview with eyebrow halo overlay'
              }
            />
          </div>

          {/* Live dwell bar */}
          <div className="dwell-meter-block">
            <div className="dwell-meter-labels">
              <span>Eyebrow proximity dwell</span>
              <span className="tabular">{dwellSec.toFixed(1)}s</span>
            </div>
            <div className="dwell-track">
              <div
                className="dwell-fill"
                style={{ width: `${dwellPct}%` }}
              />
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
                  const next2 = Math.max(settings.stage2DwellSec, Number((next1 + 0.6).toFixed(1)));
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
                  const next1 = Math.min(settings.stage1DwellSec, Number((next2 - 0.6).toFixed(1)));
                  onUpdateSettings({ stage1DwellSec: Math.max(0.6, next1), stage2DwellSec: next2 });
                }}
              />
            </label>

            <label className="slider-row" htmlFor="slider-zone-scale">
              <div className="slider-head">
                <span className="slider-label">Eyebrow halo zone (eye-width normalized)</span>
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

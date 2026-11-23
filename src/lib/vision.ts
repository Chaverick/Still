import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import type {
  DelegateMode,
  DetectionZoneId,
  FrameGeometry,
  Point2D,
  ZoneGeometry,
} from '../types';

const OCCLUSION_CACHE_MS = 1500;
// When a hand is actively visible in frame (e.g. side-angle iPad where the raising hand blocks the face),
// hold the cached eyebrow zone up to 5s so Stage 2 (2.6s) still fires cleanly!
const OCCLUSION_CACHE_WITH_HAND_MS = 5000;
const BASE_HALO_RATIO = 0.25; // fraction of yaw-invariant face scale at zoneScale = 1.0
const PINCH_RATIO_THRESHOLD = 0.62; // thumb-to-index/middle distance relative to palm size

// Standard MediaPipe 468-point Face Mesh landmark indices
const FACE_OVAL_IDX = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162,
  21, 54, 103, 67, 109,
];

// Subject's right brow (image left) & subject's left brow (image right)
const RIGHT_BROW_IDX = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
const LEFT_BROW_IDX = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];
const RIGHT_EYE_IDX = [33, 160, 158, 133, 153, 144];
const LEFT_EYE_IDX = [362, 385, 387, 263, 373, 380];
// Upper forehead perimeter arc used to project the hairline/scalp zone
const FOREHEAD_ARC_IDX = [21, 54, 103, 67, 109, 10, 338, 297, 332, 284, 251];

// Outer eye corners + vertical forehead-to-chin anchors (vertical height is invariant to side-angle yaw!)
const OUTER_EYE_LEFT_IMG = 33;
const OUTER_EYE_RIGHT_IMG = 263;
const FOREHEAD_TOP = 10;
const CHIN_BOTTOM = 152;

// Thumb, index, middle, ring tips + upper/mid finger joints for side-angle & curled-finger robustness
const TRACKED_HAND_INDICES = [4, 8, 12, 16, 7, 6, 3, 11];

interface CachedFace {
  timestamp: number;
  faceOval: Point2D[];
  leftBrow: Point2D[];
  rightBrow: Point2D[];
  leftEye: Point2D[];
  rightEye: Point2D[];
  hairline: Point2D[];
  eyeSpan: number; // yaw-invariant face scale
  sideAngle: boolean;
}

export interface DetectOptions {
  zoneScale: number;
  activeZones: DetectionZoneId[];
  pinchFilterEnabled: boolean;
}

function resolveLocalUrl(relativePath: string): string {
  const base = window.location.href.split('#')[0].split('?')[0];
  const dir = base.endsWith('/') ? base : base.slice(0, base.lastIndexOf('/') + 1);
  return new URL(relativePath, dir).href;
}

function pickPoints(landmarks: NormalizedLandmark[], indices: number[]): Point2D[] {
  const out: Point2D[] = [];
  for (const idx of indices) {
    const lm = landmarks[idx];
    if (lm) out.push({ x: lm.x, y: lm.y });
  }
  return out;
}

function distIso(a: Point2D, b: Point2D, aspect: number): number {
  const dx = (a.x - b.x) * aspect;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/**
 * Minimum isotropic distance from point p to an open or closed polyline.
 */
function distPointToPolylineIso(
  p: Point2D,
  poly: Point2D[],
  aspect: number,
  closed: boolean
): number {
  if (poly.length === 0) return Infinity;
  if (poly.length === 1) return distIso(p, poly[0], aspect);

  let minD = Infinity;
  const px = p.x * aspect;
  const py = p.y;
  const segCount = closed ? poly.length : poly.length - 1;

  for (let i = 0; i < segCount; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ax = a.x * aspect;
    const ay = a.y;
    const bx = b.x * aspect;
    const by = b.y;

    const abx = bx - ax;
    const aby = by - ay;
    const lenSq = abx * abx + aby * aby;
    let t = 0;
    if (lenSq > 1e-8) {
      t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
    }
    const cx = ax + t * abx;
    const cy = ay + t * aby;
    const d = Math.hypot(px - cx, py - cy);
    if (d < minD) minD = d;
  }
  return minD;
}

/**
 * Scale-invariant hand pinch check: true when thumb tip (4) is close to
 * index tip (8) or middle tip (12) relative to palm length (wrist 0 -> middle MCP 9).
 */
function isHandPinching(hand: NormalizedLandmark[], aspect: number): boolean {
  const wrist = hand[0];
  const midMcp = hand[9];
  const thumbTip = hand[4];
  const indexTip = hand[8];
  const middleTip = hand[12];
  if (!wrist || !midMcp || !thumbTip || !indexTip) return true;

  const palmLen = Math.max(0.03, distIso(wrist, midMcp, aspect));
  const thumbIndex = distIso(thumbTip, indexTip, aspect) / palmLen;
  const thumbMiddle = middleTip
    ? distIso(thumbTip, middleTip, aspect) / palmLen
    : Infinity;

  return Math.min(thumbIndex, thumbMiddle) <= PINCH_RATIO_THRESHOLD;
}

export class LocalVisionEngine {
  private faceLandmarker: FaceLandmarker | null = null;
  private handLandmarker: HandLandmarker | null = null;
  private delegate: DelegateMode = null;
  private cachedFace: CachedFace | null = null;
  private lastVideoTs = 0;
  private consecutiveGpuErrors = 0;
  private initializing: Promise<void> | null = null;

  get activeDelegate(): DelegateMode {
    return this.delegate;
  }

  get isReady(): boolean {
    return this.faceLandmarker !== null && this.handLandmarker !== null;
  }

  async init(): Promise<DelegateMode> {
    if (this.isReady) return this.delegate;
    if (this.initializing) {
      await this.initializing;
      return this.delegate;
    }

    this.initializing = this.loadWithFallback();
    try {
      await this.initializing;
      return this.delegate;
    } finally {
      this.initializing = null;
    }
  }

  private async loadWithFallback(forceCpu = false): Promise<void> {
    this.closeModels();

    const wasmRoot = resolveLocalUrl('wasm').replace(/\/$/, '');
    const faceModelUrl = resolveLocalUrl('models/face_landmarker.task');
    const handModelUrl = resolveLocalUrl('models/hand_landmarker.task');

    const vision = await FilesetResolver.forVisionTasks(wasmRoot);

    const tryDelegate = async (delegate: 'GPU' | 'CPU'): Promise<void> => {
      // Slightly more permissive thresholds (0.30 face / 0.25 hand) so 3/4 side-angle setups
      // (like an iPad placed to the right of your laptop) stay locked reliably.
      const face = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: faceModelUrl,
          delegate,
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.3,
        minFacePresenceConfidence: 0.3,
        minTrackingConfidence: 0.3,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });

      try {
        const hand = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: handModelUrl,
            delegate,
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.25,
          minHandPresenceConfidence: 0.25,
          minTrackingConfidence: 0.25,
        });

        this.faceLandmarker = face;
        this.handLandmarker = hand;
        this.delegate = delegate;
        this.consecutiveGpuErrors = 0;
      } catch (err) {
        face.close();
        throw err;
      }
    };

    if (!forceCpu) {
      try {
        await tryDelegate('GPU');
        return;
      } catch {
        // Silent graceful fallback to CPU delegate
      }
    }

    await tryDelegate('CPU');
  }

  /**
   * Run one 4-FPS inference step on the live <video> element.
   */
  detectFrame(
    video: HTMLVideoElement,
    options: DetectOptions,
    nowMs: number = performance.now()
  ): FrameGeometry | null {
    if (!this.faceLandmarker || !this.handLandmarker) return null;
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }

    // MediaPipe VIDEO mode requires strictly monotonically increasing integer timestamps
    const ts = Math.max(Math.round(nowMs), this.lastVideoTs + 1);
    this.lastVideoTs = ts;

    const aspect = video.videoWidth / video.videoHeight;

    let faceResult;
    let handResult;
    try {
      faceResult = this.faceLandmarker.detectForVideo(video, ts);
      handResult = this.handLandmarker.detectForVideo(video, ts);
      this.consecutiveGpuErrors = 0;
    } catch {
      this.consecutiveGpuErrors += 1;
      if (this.delegate === 'GPU' && this.consecutiveGpuErrors >= 3 && !this.initializing) {
        this.initializing = this.loadWithFallback(true).finally(() => {
          this.initializing = null;
        });
      }
      return null;
    }

    const hands = handResult.landmarks ?? [];
    const faceLandmarks = faceResult.faceLandmarks?.[0];
    let usingOcclusionCache = false;
    let activeFace: CachedFace | null = null;

    if (faceLandmarks && faceLandmarks.length > 380) {
      const leftOuter = faceLandmarks[OUTER_EYE_LEFT_IMG];
      const rightOuter = faceLandmarks[OUTER_EYE_RIGHT_IMG];
      const foreheadTop = faceLandmarks[FOREHEAD_TOP];
      const chinBottom = faceLandmarks[CHIN_BOTTOM];

      const rawEyeSpan = distIso(leftOuter, rightOuter, aspect);
      const faceHeight = distIso(foreheadTop, chinBottom, aspect);
      // Front-on: rawEyeSpan ≈ 0.68 * faceHeight.
      // At a 40°–60° side angle (e.g. iPad to your right), rawEyeSpan foreshortens by cos(yaw),
      // while vertical faceHeight stays full-scale! Taking max prevents the brow halo from shrinking.
      const heightEquivSpan = faceHeight * 0.68;
      const robustScale = Math.max(0.05, rawEyeSpan, heightEquivSpan);
      const sideAngle = heightEquivSpan > 0.04 && rawEyeSpan / heightEquivSpan < 0.82;

      const forehead = pickPoints(faceLandmarks, FOREHEAD_ARC_IDX);
      const liftY = robustScale * 0.16;
      const hairline = forehead.map((p) => ({
        x: p.x,
        y: Math.max(0.01, p.y - liftY),
      }));

      activeFace = {
        timestamp: nowMs,
        faceOval: pickPoints(faceLandmarks, FACE_OVAL_IDX),
        leftBrow: pickPoints(faceLandmarks, LEFT_BROW_IDX),
        rightBrow: pickPoints(faceLandmarks, RIGHT_BROW_IDX),
        leftEye: pickPoints(faceLandmarks, LEFT_EYE_IDX),
        rightEye: pickPoints(faceLandmarks, RIGHT_EYE_IDX),
        hairline,
        eyeSpan: robustScale,
        sideAngle,
      };
      this.cachedFace = activeFace;
    } else if (this.cachedFace) {
      // If a hand is currently visible in frame (blocking the face at a side angle),
      // hold the occlusion cache up to 5s so Stage 2 dwell completes reliably;
      // otherwise expire after 1.5s when stepping away.
      const maxCacheMs =
        hands.length > 0 ? OCCLUSION_CACHE_WITH_HAND_MS : OCCLUSION_CACHE_MS;
      if (nowMs - this.cachedFace.timestamp <= maxCacheMs) {
        activeFace = this.cachedFace;
        usingOcclusionCache = true;
      } else {
        this.cachedFace = null;
      }
    }

    // Give a gentle +15% halo boost automatically when sitting at a noticeable side angle
    const sideBoost = activeFace?.sideAngle ? 1.15 : 1.0;
    const haloRadius = activeFace
      ? activeFace.eyeSpan * BASE_HALO_RATIO * options.zoneScale * sideBoost
      : 0;

    // Build active zone polylines according to user's selected presets
    const activeZones: ZoneGeometry[] = [];
    const selected =
      options.activeZones.length > 0
        ? options.activeZones
        : (['left-brow', 'right-brow'] as DetectionZoneId[]);

    if (activeFace && haloRadius > 0) {
      if (selected.includes('left-brow')) {
        activeZones.push({
          id: 'left-brow',
          points: activeFace.leftBrow,
          closed: true,
          radius: haloRadius,
        });
      }
      if (selected.includes('right-brow')) {
        activeZones.push({
          id: 'right-brow',
          points: activeFace.rightBrow,
          closed: true,
          radius: haloRadius,
        });
      }
      if (selected.includes('lashes')) {
        activeZones.push(
          {
            id: 'lashes',
            points: activeFace.leftEye,
            closed: true,
            radius: haloRadius * 0.78,
          },
          {
            id: 'lashes',
            points: activeFace.rightEye,
            closed: true,
            radius: haloRadius * 0.78,
          }
        );
      }
      if (selected.includes('hairline')) {
        activeZones.push({
          id: 'hairline',
          points: activeFace.hairline,
          closed: false,
          radius: haloRadius * 1.15,
        });
      }
    }

    const fingertips: FrameGeometry['fingertips'] = [];
    let handInZone = false;
    let closestRatio: number | null = null;

    for (let h = 0; h < hands.length; h++) {
      const hand = hands[h];
      const pinching = isHandPinching(hand, aspect);
      const passesPinch = !options.pinchFilterEnabled || pinching;

      for (const idx of TRACKED_HAND_INDICES) {
        const pt = hand[idx];
        if (!pt) continue;

        let inZone = false;
        if (activeZones.length > 0) {
          for (const zone of activeZones) {
            const d = distPointToPolylineIso(pt, zone.points, aspect, zone.closed);
            const ratio = d / zone.radius;
            if (closestRatio === null || ratio < closestRatio) {
              closestRatio = ratio;
            }
            if (d <= zone.radius && passesPinch) {
              inZone = true;
              handInZone = true;
            }
          }
        }

        if (idx === 4 || idx === 8 || idx === 12 || idx === 16 || inZone) {
          fingertips.push({
            x: pt.x,
            y: pt.y,
            inZone,
            handIndex: h,
            pinching,
          });
        }
      }
    }

    return {
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      facePresent: activeFace !== null,
      usingOcclusionCache,
      sideAngle: Boolean(activeFace?.sideAngle),
      faceOval: activeFace?.faceOval ?? [],
      leftEye: activeFace?.leftEye ?? [],
      rightEye: activeFace?.rightEye ?? [],
      activeZones,
      eyeSpan: activeFace?.eyeSpan ?? 0,
      haloRadius,
      fingertips,
      handInZone,
      closestRatio,
    };
  }

  resetCache(): void {
    this.cachedFace = null;
  }

  private closeModels(): void {
    try {
      this.faceLandmarker?.close();
    } catch {
      // ignore
    }
    try {
      this.handLandmarker?.close();
    } catch {
      // ignore
    }
    this.faceLandmarker = null;
    this.handLandmarker = null;
  }

  dispose(): void {
    this.closeModels();
    this.cachedFace = null;
  }
}

export async function checkModelsCached(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const cacheNames = await caches.keys();
    for (const name of cacheNames) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      const hasFace = keys.some((r) => r.url.includes('face_landmarker.task'));
      const hasHand = keys.some((r) => r.url.includes('hand_landmarker.task'));
      if (hasFace && hasHand) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

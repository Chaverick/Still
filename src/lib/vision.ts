import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import type { DelegateMode, FrameGeometry, Point2D } from '../types';

const OCCLUSION_CACHE_MS = 1500;
const BASE_HALO_RATIO = 0.24; // fraction of outer-eye-to-outer-eye span at zoneScale = 1.0

// Standard MediaPipe 468-point Face Mesh landmark indices
const FACE_OVAL_IDX = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162,
  21, 54, 103, 67, 109,
];

const RIGHT_BROW_IDX = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
const LEFT_BROW_IDX = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];
const RIGHT_EYE_IDX = [33, 160, 158, 133, 153, 144];
const LEFT_EYE_IDX = [362, 385, 387, 263, 373, 380];

// Outer eye corners for stable distance normalization (invariant to blinking)
const OUTER_EYE_LEFT_IMG = 33;
const OUTER_EYE_RIGHT_IMG = 263;

// Thumb, index, middle, ring tips + upper joints for pinch angle robustness
const TRACKED_HAND_INDICES = [4, 8, 12, 16, 7, 3];

interface CachedFace {
  timestamp: number;
  faceOval: Point2D[];
  leftBrow: Point2D[];
  rightBrow: Point2D[];
  leftEye: Point2D[];
  rightEye: Point2D[];
  eyeSpan: number;
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
 * Minimum isotropic distance from point p to a closed/open polyline of points.
 */
function distPointToPolylineIso(p: Point2D, poly: Point2D[], aspect: number): number {
  if (poly.length === 0) return Infinity;
  let minD = Infinity;
  const px = p.x * aspect;
  const py = p.y;

  for (let i = 0; i < poly.length; i++) {
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
      // Create sequentially so iPadOS Safari WebGL context initializes cleanly
      const face = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: faceModelUrl,
          delegate,
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.45,
        minFacePresenceConfidence: 0.45,
        minTrackingConfidence: 0.45,
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
          minHandDetectionConfidence: 0.4,
          minHandPresenceConfidence: 0.4,
          minTrackingConfidence: 0.4,
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
        // Silent graceful fallback to CPU delegate (common on older iPadOS / WebGL limits)
      }
    }

    await tryDelegate('CPU');
  }

  /**
   * Run one 4-FPS inference step on the live <video> element.
   */
  detectFrame(
    video: HTMLVideoElement,
    zoneScale: number,
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
        // Runtime GPU failure fallback -> CPU seamlessly
        this.initializing = this.loadWithFallback(true).finally(() => {
          this.initializing = null;
        });
      }
      return null;
    }

    const faceLandmarks = faceResult.faceLandmarks?.[0];
    let usingOcclusionCache = false;
    let activeFace: CachedFace | null = null;

    if (faceLandmarks && faceLandmarks.length > 380) {
      const leftOuter = faceLandmarks[OUTER_EYE_LEFT_IMG];
      const rightOuter = faceLandmarks[OUTER_EYE_RIGHT_IMG];
      const eyeSpan = Math.max(0.05, distIso(leftOuter, rightOuter, aspect));

      activeFace = {
        timestamp: nowMs,
        faceOval: pickPoints(faceLandmarks, FACE_OVAL_IDX),
        leftBrow: pickPoints(faceLandmarks, LEFT_BROW_IDX),
        rightBrow: pickPoints(faceLandmarks, RIGHT_BROW_IDX),
        leftEye: pickPoints(faceLandmarks, LEFT_EYE_IDX),
        rightEye: pickPoints(faceLandmarks, RIGHT_EYE_IDX),
        eyeSpan,
      };
      this.cachedFace = activeFace;
    } else if (this.cachedFace && nowMs - this.cachedFace.timestamp <= OCCLUSION_CACHE_MS) {
      activeFace = this.cachedFace;
      usingOcclusionCache = true;
    } else {
      this.cachedFace = null;
    }

    const haloRadius = activeFace
      ? activeFace.eyeSpan * BASE_HALO_RATIO * zoneScale
      : 0;

    const fingertips: FrameGeometry['fingertips'] = [];
    let handInZone = false;
    let closestRatio: number | null = null;

    const hands = handResult.landmarks ?? [];
    for (let h = 0; h < hands.length; h++) {
      const hand = hands[h];
      for (const idx of TRACKED_HAND_INDICES) {
        const pt = hand[idx];
        if (!pt) continue;

        let inZone = false;
        if (activeFace && haloRadius > 0) {
          const dLeft = distPointToPolylineIso(pt, activeFace.leftBrow, aspect);
          const dRight = distPointToPolylineIso(pt, activeFace.rightBrow, aspect);
          const minD = Math.min(dLeft, dRight);
          const ratio = minD / haloRadius;
          if (closestRatio === null || ratio < closestRatio) {
            closestRatio = ratio;
          }
          if (minD <= haloRadius) {
            inZone = true;
            handInZone = true;
          }
        }

        // Only expose the 4 main fingertips visually for clean calibration dots,
        // while still using DIP/IP for zone contact above
        if (idx === 4 || idx === 8 || idx === 12 || idx === 16 || inZone) {
          fingertips.push({
            x: pt.x,
            y: pt.y,
            inZone,
            handIndex: h,
          });
        }
      }
    }

    return {
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      facePresent: activeFace !== null,
      usingOcclusionCache,
      faceOval: activeFace?.faceOval ?? [],
      leftBrow: activeFace?.leftBrow ?? [],
      rightBrow: activeFace?.rightBrow ?? [],
      leftEye: activeFace?.leftEye ?? [],
      rightEye: activeFace?.rightEye ?? [],
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

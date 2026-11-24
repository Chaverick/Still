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
const NOSE_BRIDGE = 6;

// Lateral ear-edge boundaries & outer brow corners for Ear-Touch vs. Eyebrow separation
const RIGHT_EAR_EDGE_IDX = [234, 127, 93]; // image-left ear / tragus boundary
const LEFT_EAR_EDGE_IDX = [454, 356, 323]; // image-right ear / tragus boundary
const RIGHT_OUTER_BROW = 70; // image-left outer brow tail
const LEFT_OUTER_BROW = 300; // image-right outer brow tail
const UPPER_LIP = 13;
const LOWER_LIP = 14;

// Thumb, index, middle, ring tips + upper/mid finger joints for side-angle & curled-finger robustness
const TRACKED_HAND_INDICES = [4, 8, 12, 16, 7, 6, 3, 11];
// Primary plucking fingertips get full halo recall; secondary joints require tighter core contact
const PRIMARY_TIP_INDICES = new Set([4, 8, 12]);
// Lower hand/ring/pinky landmarks used to detect holding a glass/cup at mouth level
const DRINKING_LOWER_HAND_INDICES = [0, 9, 13, 16, 17, 20];

interface CachedFace {
  timestamp: number;
  faceOval: Point2D[];
  leftBrow: Point2D[];
  rightBrow: Point2D[];
  leftEye: Point2D[];
  rightEye: Point2D[];
  hairline: Point2D[];
  rightEarEdge: Point2D[];
  leftEarEdge: Point2D[];
  rightOuterBrow: Point2D;
  leftOuterBrow: Point2D;
  mouthCenter: Point2D;
  eyeSpan: number; // yaw-invariant face scale
  sideAngle: boolean;
}

export interface DetectOptions {
  zoneScale: number;
  activeZones: DetectionZoneId[];
  pinchFilterEnabled: boolean;
  smartFalseAlarmGuard: boolean;
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
 * Computes hand posture metrics for both pinch detection and perspective depth estimation.
 * At the face plane, handSize / eyeSpan is typically ~0.70–1.25.
 * Holding a glass/cup 12–20cm closer to the webcam pushes handSize / eyeSpan > ~1.50.
 */
function analyzeHandMetrics(
  hand: NormalizedLandmark[],
  aspect: number
): { pinching: boolean; pinchRatio: number; handSize: number } {
  const wrist = hand[0];
  const indexMcp = hand[5];
  const midMcp = hand[9];
  const pinkyMcp = hand[17];
  const thumbTip = hand[4];
  const indexTip = hand[8];
  const middleTip = hand[12];
  if (!wrist || !midMcp || !thumbTip || !indexTip) {
    return { pinching: true, pinchRatio: 0.4, handSize: 0.08 };
  }

  const palmLen = Math.max(0.03, distIso(wrist, midMcp, aspect));
  const knuckleSpan =
    indexMcp && pinkyMcp ? distIso(indexMcp, pinkyMcp, aspect) : 0;
  const handSize = Math.max(palmLen, knuckleSpan * 1.15);

  const thumbIndex = distIso(thumbTip, indexTip, aspect) / palmLen;
  const thumbMiddle = middleTip
    ? distIso(thumbTip, middleTip, aspect) / palmLen
    : Infinity;
  const pinchRatio = Math.min(thumbIndex, thumbMiddle);

  return {
    pinching: pinchRatio <= PINCH_RATIO_THRESHOLD,
    pinchRatio,
    handSize,
  };
}

function extractSipScore(
  categories: Array<{ categoryName: string; score: number }> | undefined
): number {
  if (!categories || categories.length === 0) return 0;
  let mouthPucker = 0;
  let mouthFunnel = 0;
  let jawOpen = 0;
  for (const c of categories) {
    switch (c.categoryName) {
      case 'mouthPucker':
        mouthPucker = c.score;
        break;
      case 'mouthFunnel':
        mouthFunnel = c.score;
        break;
      case 'jawOpen':
        jawOpen = c.score;
        break;
    }
  }
  return Math.max(mouthPucker, mouthFunnel, jawOpen * 0.85);
}

export class LocalVisionEngine {
  private faceLandmarker: FaceLandmarker | null = null;
  private handLandmarker: HandLandmarker | null = null;
  private delegate: DelegateMode = null;
  private cachedFace: CachedFace | null = null;
  private lastVideoTs = 0;
  private lastSipMouthMs = 0;
  private lastDrinkingMs = 0;
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
        outputFaceBlendshapes: true,
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
    const mouthSipScore = extractSipScore(faceResult.faceBlendshapes?.[0]?.categories);
    if (mouthSipScore >= 0.2) {
      this.lastSipMouthMs = nowMs;
    }

    let usingOcclusionCache = false;
    let activeFace: CachedFace | null = null;

    if (faceLandmarks && faceLandmarks.length > 455) {
      const leftOuter = faceLandmarks[OUTER_EYE_LEFT_IMG];
      const rightOuter = faceLandmarks[OUTER_EYE_RIGHT_IMG];
      const foreheadTop = faceLandmarks[FOREHEAD_TOP];
      const chinBottom = faceLandmarks[CHIN_BOTTOM];
      const rOuterBrow = faceLandmarks[RIGHT_OUTER_BROW] ?? leftOuter;
      const lOuterBrow = faceLandmarks[LEFT_OUTER_BROW] ?? rightOuter;
      const upperLip = faceLandmarks[UPPER_LIP] ?? chinBottom;
      const lowerLip = faceLandmarks[LOWER_LIP] ?? chinBottom;

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
        rightEarEdge: pickPoints(faceLandmarks, RIGHT_EAR_EDGE_IDX),
        leftEarEdge: pickPoints(faceLandmarks, LEFT_EAR_EDGE_IDX),
        rightOuterBrow: { x: rOuterBrow.x, y: rOuterBrow.y },
        leftOuterBrow: { x: lOuterBrow.x, y: lOuterBrow.y },
        mouthCenter: {
          x: (upperLip.x + lowerLip.x) * 0.5,
          y: (upperLip.y + lowerLip.y) * 0.5,
        },
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
    let filteredReason: 'ear' | 'drinking' | 'foreground' | null = null;
    let closestRatio: number | null = null;

    const guardOn = options.smartFalseAlarmGuard;

    for (let h = 0; h < hands.length; h++) {
      const hand = hands[h];
      const { pinching, pinchRatio, handSize } = analyzeHandMetrics(hand, aspect);
      const passesPinch = !options.pinchFilterEnabled || pinching;

      // 1. Evaluate raw brow/zone proximity (full recall for primary fingertips)
      let handClosestRatio: number | null = null;
      let handRawHit = false;
      let handEarFiltered = false;
      const perPointHits = new Map<number, boolean>();

      for (const idx of TRACKED_HAND_INDICES) {
        const pt = hand[idx];
        if (!pt) continue;

        let ptHit = false;
        if (activeZones.length > 0 && activeFace) {
          const radiusScale = guardOn && !PRIMARY_TIP_INDICES.has(idx) ? 0.68 : 1.0;

          for (const zone of activeZones) {
            const d = distPointToPolylineIso(pt, zone.points, aspect, zone.closed);
            const effRadius = zone.radius * radiusScale;
            const ratio = d / zone.radius;
            if (closestRatio === null || ratio < closestRatio) {
              closestRatio = ratio;
            }
            if (handClosestRatio === null || ratio < handClosestRatio) {
              handClosestRatio = ratio;
            }

            if (d <= effRadius && passesPinch) {
              // Smart Ear-Touch Guard: ignore points strictly lateral outside the outer brow corner
              // that are closer to the ear/tragus boundary than to the eyebrow itself.
              if (guardOn && (zone.id === 'left-brow' || zone.id === 'right-brow')) {
                const lateralPad = activeFace.eyeSpan * 0.03;
                const outsideRightBrow =
                  pt.x < activeFace.rightOuterBrow.x - lateralPad &&
                  pt.y >= activeFace.rightOuterBrow.y - activeFace.eyeSpan * 0.04;
                const outsideLeftBrow =
                  pt.x > activeFace.leftOuterBrow.x + lateralPad &&
                  pt.y >= activeFace.leftOuterBrow.y - activeFace.eyeSpan * 0.04;

                if (outsideRightBrow || outsideLeftBrow) {
                  const earPoly = outsideRightBrow
                    ? activeFace.rightEarEdge
                    : activeFace.leftEarEdge;
                  const earDist = distPointToPolylineIso(pt, earPoly, aspect, false);
                  if (earDist < d * 0.95) {
                    handEarFiltered = true;
                    continue;
                  }
                }
              }

              ptHit = true;
              handRawHit = true;
            }
          }
        }
        perPointHits.set(idx, ptHit);
      }

      // 2. Smart Drinking-From-Glass & Foreground-Depth Guard
      let handSuppressedReason: 'drinking' | 'foreground' | null = null;
      if (guardOn && activeFace) {
        const handScaleRatio = handSize / Math.max(0.05, activeFace.eyeSpan);
        const isOpenCupGrip = pinchRatio > 0.52;
        const recentSip = nowMs - this.lastSipMouthMs <= 3500;
        const mouthBand = activeFace.eyeSpan * 0.58;

        let mouthClusterCount = 0;
        for (const lIdx of DRINKING_LOWER_HAND_INDICES) {
          const lPt = hand[lIdx];
          if (lPt && distIso(lPt, activeFace.mouthCenter, aspect) <= mouthBand) {
            mouthClusterCount += 1;
          }
        }

        const palmPt = hand[9] ?? hand[0];
        const palmToMouth = palmPt
          ? distIso(palmPt, activeFace.mouthCenter, aspect)
          : Infinity;
        let palmToBrow = Infinity;
        for (const zone of activeZones) {
          if (palmPt) {
            palmToBrow = Math.min(
              palmToBrow,
              distPointToPolylineIso(palmPt, zone.points, aspect, zone.closed)
            );
          }
        }
        const closerToMouthThanBrow = palmToMouth < palmToBrow * 1.15;

        const isDrinkingPosture =
          mouthClusterCount >= 2 &&
          isOpenCupGrip &&
          (recentSip || closerToMouthThanBrow);

        if (isDrinkingPosture) {
          this.lastDrinkingMs = nowMs;
        }

        if (handRawHit) {
          const deepBrowCore = handClosestRatio !== null && handClosestRatio <= 0.52;
          const withinSipWindow = nowMs - this.lastDrinkingMs <= 2800;

          if (isDrinkingPosture || (withinSipWindow && isOpenCupGrip && !deepBrowCore)) {
            handSuppressedReason = 'drinking';
          } else if (
            handScaleRatio >= 1.8 ||
            (handScaleRatio >= 1.5 && (!pinching || !deepBrowCore))
          ) {
            handSuppressedReason = 'foreground';
          }
        }
      }

      const handAccepted = handRawHit && handSuppressedReason === null;
      if (handAccepted) {
        handInZone = true;
      } else if (handSuppressedReason && !handInZone) {
        filteredReason = handSuppressedReason;
      } else if (handEarFiltered && !handRawHit && !handInZone && filteredReason === null) {
        filteredReason = 'ear';
      }

      for (const idx of TRACKED_HAND_INDICES) {
        const pt = hand[idx];
        if (!pt) continue;
        const inZone = handAccepted && Boolean(perPointHits.get(idx));
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
      filteredReason,
      closestRatio,
    };
  }

  /**
   * Evaluates how directly front-facing and centered the user's face appears in a candidate camera.
   * Used when multiple cameras exist (e.g. side MacBook webcam + front Logitech desk webcam)
   * to automatically pick the camera directly in front of the user's face.
   */
  evaluateFrontFacingScore(
    video: HTMLVideoElement,
    nowMs: number = performance.now()
  ): {
    faceFound: boolean;
    frontScore: number;
    yawSymmetry: number;
    sideAngle: boolean;
  } {
    if (!this.faceLandmarker) {
      return { faceFound: false, frontScore: -1, yawSymmetry: 0, sideAngle: true };
    }
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      return { faceFound: false, frontScore: -1, yawSymmetry: 0, sideAngle: true };
    }

    const ts = Math.max(Math.round(nowMs), this.lastVideoTs + 1);
    this.lastVideoTs = ts;

    let faceResult;
    try {
      faceResult = this.faceLandmarker.detectForVideo(video, ts);
    } catch {
      return { faceFound: false, frontScore: -1, yawSymmetry: 0, sideAngle: true };
    }

    const lms = faceResult.faceLandmarks?.[0];
    if (!lms || lms.length <= 455) {
      return { faceFound: false, frontScore: -1, yawSymmetry: 0, sideAngle: true };
    }

    const aspect = video.videoWidth / video.videoHeight;
    const leftOuter = lms[OUTER_EYE_LEFT_IMG];
    const rightOuter = lms[OUTER_EYE_RIGHT_IMG];
    const foreheadTop = lms[FOREHEAD_TOP];
    const chinBottom = lms[CHIN_BOTTOM];
    const noseTip = lms[1] ?? lms[NOSE_BRIDGE];
    const rightEdge = lms[234];
    const leftEdge = lms[454];

    const rawEyeSpan = distIso(leftOuter, rightOuter, aspect);
    const faceHeight = Math.max(0.05, distIso(foreheadTop, chinBottom, aspect));
    const heightEquivSpan = faceHeight * 0.68;
    const frontRatio = Math.min(1.05, rawEyeSpan / Math.max(0.04, heightEquivSpan));
    const sideAngle = rawEyeSpan / Math.max(0.04, heightEquivSpan) < 0.82;

    const distToLeftImg = Math.abs(noseTip.x - rightEdge.x);
    const distToRightImg = Math.abs(leftEdge.x - noseTip.x);
    const yawSymmetry = Math.max(
      0,
      1 - Math.abs(distToLeftImg - distToRightImg) / Math.max(0.01, distToLeftImg + distToRightImg)
    );

    const centerOffset = Math.hypot(noseTip.x - 0.5, noseTip.y - 0.46);
    const centerScore = Math.max(0, 1 - centerOffset * 1.45);

    const sizeScore =
      rawEyeSpan >= 0.09 && rawEyeSpan <= 0.42
        ? 1
        : Math.max(0.2, 1 - Math.abs(rawEyeSpan - 0.22) * 2.2);

    const frontScore =
      yawSymmetry * 52 + frontRatio * 28 + centerScore * 14 + sizeScore * 6;

    return {
      faceFound: true,
      frontScore: Math.round(frontScore * 10) / 10,
      yawSymmetry: Math.round(yawSymmetry * 100) / 100,
      sideAngle,
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

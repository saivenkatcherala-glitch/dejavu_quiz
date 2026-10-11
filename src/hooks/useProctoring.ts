import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { ViolationType, Severity } from '@/lib/types';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// Load TF.js + COCO-SSD from CDN (no npm install needed)
let cocoSsdPromise: Promise<any> | null = null;
async function getCocoSsd(): Promise<any> {
  if (!cocoSsdPromise) {
    cocoSsdPromise = new Promise((resolve, reject) => {
      // Load TF.js
      const tfScript = document.createElement('script');
      tfScript.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js';
      tfScript.onload = () => {
        // Then load COCO-SSD
        const cocoScript = document.createElement('script');
        cocoScript.src = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js';
        cocoScript.onload = async () => {
          try {
            const model = await (window as any).cocoSsd.load({ base: 'mobilenet_v2' });
            resolve(model);
          } catch (e) { reject(e); }
        };
        cocoScript.onerror = reject;
        document.head.appendChild(cocoScript);
      };
      tfScript.onerror = reject;
      document.head.appendChild(tfScript);
    });
  }
  return cocoSsdPromise;
}

// Load MediaPipe FaceLandmarker via npm package (handles eye gaze + head pose)
let faceLandmarkerPromise: Promise<FaceLandmarker> | null = null;
async function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = (async () => {
      const filesetResolver = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );
      const landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
      console.log('✅ MediaPipe FaceLandmarker loaded successfully');
      return landmarker;
    })();
  }
  return faceLandmarkerPromise;
}

const DEBOUNCE_MS = 8000; // 8 seconds between same-type violations

interface UseProctor {
  violationCount: number;
  cameraActive: boolean;
}

export function useProctoring(
  attemptId: string,
  teamId: string,
  enabled: boolean,
  onWarning: (message: string) => void,
  onPhoneDetected?: (count: number) => void,
  externalVideoRef?: React.RefObject<HTMLVideoElement | null>
): UseProctor {
  const [violationCount, setViolationCount] = useState(0);
  const [cameraActive, setCameraActive] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const phoneDetectionCount = useRef(0);
  const lastViolation = useRef<Map<string, number>>(new Map());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const faceCheckInterval = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // =====================================================
  // Record violation (with debounce)
  // =====================================================

  const recordViolation = useCallback(async (
    type: ViolationType,
    severity: Severity = 'low',
    metadata: Record<string, unknown> = {}
  ) => {
    if (!attemptId || !teamId || !enabled) return;

    const now = Date.now();
    const lastTime = lastViolation.current.get(type) || 0;

    if (now - lastTime < DEBOUNCE_MS) return; // Debounce
    lastViolation.current.set(type, now);

    try {
      await supabase.from('violations').insert({
        attempt_id: attemptId,
        team_id: teamId,
        type,
        severity,
        timestamp: new Date().toISOString(),
        metadata,
      });

      // Update violation count on attempt
      setViolationCount(prev => prev + 1);
      await supabase
        .from('quiz_attempts')
        .update({ violation_count: violationCount + 1 })
        .eq('id', attemptId);
    } catch (err) {
      console.error('Failed to record violation:', err);
    }
  }, [attemptId, teamId, enabled, violationCount]);

  // =====================================================
  // Tab switch / Visibility change
  // =====================================================

  useEffect(() => {
    if (!enabled) return;

    const handleVisibility = () => {
      if (document.hidden) {
        recordViolation('TAB_SWITCH', 'medium', { event: 'visibility_hidden' });
        onWarning('⚠ Tab switch detected! Please stay on the quiz tab.');
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [enabled, recordViolation, onWarning]);

  // =====================================================
  // Window blur / focus
  // =====================================================

  useEffect(() => {
    if (!enabled) return;

    const handleBlur = () => {
      recordViolation('WINDOW_BLUR', 'medium');
      onWarning('⚠ Window focus lost! Please stay on the quiz window.');
    };

    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [enabled, recordViolation, onWarning]);

  // =====================================================
  // Fullscreen exit
  // =====================================================

  useEffect(() => {
    if (!enabled) return;

    const handleFullscreen = () => {
      if (!document.fullscreenElement) {
        recordViolation('FULLSCREEN_EXIT', 'medium');
        onWarning('⚠ Fullscreen mode exited! Please return to fullscreen.');
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreen);
    return () => document.removeEventListener('fullscreenchange', handleFullscreen);
  }, [enabled, recordViolation, onWarning]);

  // =====================================================
  // Copy / Paste / Right-click
  // =====================================================

  useEffect(() => {
    if (!enabled) return;

    const handleCopy = (e: Event) => {
      e.preventDefault();
      recordViolation('COPY_ATTEMPT', 'low');
      onWarning('⚠ Copy is not allowed during the quiz.');
    };

    const handlePaste = (e: Event) => {
      e.preventDefault();
      recordViolation('PASTE_ATTEMPT', 'low');
      onWarning('⚠ Paste is not allowed during the quiz.');
    };

    const handleContextMenu = (e: Event) => {
      e.preventDefault();
      recordViolation('RIGHT_CLICK', 'low');
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Block Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+P, PrintScreen
      if (
        (e.ctrlKey || e.metaKey) && 
        (e.key === 'c' || e.key === 'v' || e.key === 'x' || e.key === 'p' || e.key === 'C' || e.key === 'V' || e.key === 'X' || e.key === 'P')
      ) {
        e.preventDefault();
        recordViolation('COPY_ATTEMPT', 'low');
        onWarning('⚠ Keyboard shortcuts are disabled during the quiz.');
      }
      if (e.key === 'PrintScreen') {
        e.preventDefault();
        recordViolation('COPY_ATTEMPT', 'high', { reason: 'screenshot_attempt' });
        onWarning('⚠ Screenshots are strictly prohibited!');
      }
    };

    document.addEventListener('copy', handleCopy);
    document.addEventListener('paste', handlePaste);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('copy', handleCopy);
      document.removeEventListener('paste', handlePaste);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, recordViolation, onWarning]);

  // =====================================================
  // Network disconnect
  // =====================================================

  useEffect(() => {
    if (!enabled) return;

    const handleOffline = () => {
      recordViolation('NETWORK_DISCONNECT', 'medium');
    };

    window.addEventListener('offline', handleOffline);
    return () => window.removeEventListener('offline', handleOffline);
  }, [enabled, recordViolation]);

  // Keep external video element synced if it mounts after camera starts
  useEffect(() => {
    if (externalVideoRef?.current && streamRef.current && externalVideoRef.current.srcObject !== streamRef.current) {
      externalVideoRef.current.srcObject = streamRef.current;
      externalVideoRef.current.muted = true;
      externalVideoRef.current.playsInline = true;
      externalVideoRef.current.play().catch(() => {});
      videoRef.current = externalVideoRef.current;
    }
  }, [externalVideoRef, cameraActive]);

  useEffect(() => {
    if (!enabled || !attemptId) return;

    let cancelled = false;

    async function initFaceDetection() {
      try {
        // Standard 640x480 resolution (100% compatible with laptop webcams without driver crash or shutting down)
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            width: { ideal: 640, max: 1280 }, 
            height: { ideal: 480, max: 720 },
            facingMode: 'user'
          }, 
          audio: false 
        });

        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;

        // Use the DOM-attached video element if provided, otherwise create in-memory
        if (externalVideoRef?.current) {
          externalVideoRef.current.srcObject = stream;
          externalVideoRef.current.muted = true;
          externalVideoRef.current.playsInline = true;
          await externalVideoRef.current.play().catch(() => {});
          videoRef.current = externalVideoRef.current;
        } else {
          const video = document.createElement('video');
          video.width = 640;
          video.height = 480;
          video.srcObject = stream;
          video.muted = true;
          video.playsInline = true;
          await video.play().catch(() => {});
          videoRef.current = video;
        }

        setCameraActive(true);

        // Try to load COCO-SSD for phone detection (non-blocking)
        let detector: any = null;
        getCocoSsd().then(m => { detector = m; }).catch(() => { /* silently skip if fails */ });

        // Load MediaPipe FaceLandmarker for eye gaze + head pose tracking (non-blocking)
        let faceTracker: FaceLandmarker | null = null;
        getFaceLandmarker().then(m => { faceTracker = m; console.log('✅ FaceTracker ready'); }).catch((e) => { console.error('❌ FaceLandmarker failed:', e); });

        // Setup counters
        let noFaceCounter = 0;
        let missingPersonCounter = 0;
        const NO_FACE_THRESHOLD = 6; // 15 seconds before reporting camera covered/disabled

        // Temporal fusion counters - relaxed and softened
        let gazeDownCounter = 0;
        let headTurnCounter = 0;
        let eyeGazeSideCounter = 0;
        const TEMPORAL_THRESHOLD = 4; // Must persist for 4 consecutive cycles (~10 seconds)
        const startTime = Date.now();

        faceCheckInterval.current = setInterval(async () => {
          // 1. Auto-resume if video was paused by browser tab management
          if (videoRef.current?.paused) {
            videoRef.current.play().catch(() => {});
          }

          // 2. Check if video track is still live or was muted/ended by laptop OS
          const activeTrack = streamRef.current?.getVideoTracks()?.[0];
          if (activeTrack && (!activeTrack.enabled || activeTrack.readyState === 'ended')) {
            setCameraActive(false);
            try {
              const newStream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
                audio: false
              });
              streamRef.current = newStream;
              if (videoRef.current) {
                videoRef.current.srcObject = newStream;
                videoRef.current.play().catch(() => {});
              }
              if (externalVideoRef?.current) {
                externalVideoRef.current.srcObject = newStream;
                externalVideoRef.current.play().catch(() => {});
              }
              setCameraActive(true);
            } catch {}
            return;
          }

          if (!videoRef.current || videoRef.current.readyState < 2) {
            return;
          }

          const vWidth = videoRef.current.videoWidth || 640;
          const vHeight = videoRef.current.videoHeight || 480;

          const canvas = document.createElement('canvas');
          canvas.width = vWidth;
          canvas.height = vHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(videoRef.current, 0, 0, vWidth, vHeight);
            const imageData = ctx.getImageData(0, 0, vWidth, vHeight);
            const data = imageData.data;

            let totalBrightness = 0;
            let samePixelCount = 0;
            const firstR = data[0], firstG = data[1], firstB = data[2];

            for (let i = 0; i < data.length; i += 4 * 100) {
              totalBrightness += data[i] + data[i + 1] + data[i + 2];
              if (data[i] === firstR && data[i + 1] === firstG && data[i + 2] === firstB) {
                samePixelCount++;
              }
            }

            const avgBrightness = totalBrightness / (data.length / (4 * 100));
            const sampleCount = Math.floor(data.length / (4 * 100));

            // Only check black/solid frame after 10-second startup grace period
            const isStartupPeriod = Date.now() - startTime < 10000;
            if (!isStartupPeriod) {
              if (avgBrightness < 6) {
                noFaceCounter++;
                if (noFaceCounter >= NO_FACE_THRESHOLD) {
                  recordViolation('CAMERA_DISABLED', 'high', { reason: 'black_frame' });
                  onWarning('Camera appears to be covered or disabled!');
                  noFaceCounter = 0;
                }
              } else if (samePixelCount > sampleCount * 0.98) {
                noFaceCounter++;
                if (noFaceCounter >= NO_FACE_THRESHOLD) {
                  recordViolation('CAMERA_DISABLED', 'medium', { reason: 'camera_covered_solid' });
                  onWarning('Camera appears to be covered or disabled!');
                  noFaceCounter = 0;
                }
              } else {
                noFaceCounter = 0;
              }
            }

            // Mobile phone detection using COCO-SSD (if model loaded)
            if (detector && canvas) {
              try {
                const predictions = await detector.detect(canvas);
                const phoneDetected = predictions.some((p: any) =>
                  ['cell phone', 'remote'].includes(p.class) && p.score > 0.45
                );
                
                // Check for missing person (walked away)
                const personCount = predictions.filter((p: any) => p.class === 'person' && p.score > 0.5).length;
                if (personCount === 0) {
                  missingPersonCounter++;
                  if (missingPersonCounter >= 4) { // 10 seconds missing
                    recordViolation('CAMERA_DISABLED', 'high', { reason: 'walked_away' });
                    onWarning('⚠ No person detected in camera! Please return to your seat.');
                    missingPersonCounter = 0;
                  }
                } else {
                  missingPersonCounter = 0;
                }

                if (phoneDetected) {
                  phoneDetectionCount.current += 1;
                  recordViolation('COPY_ATTEMPT', 'high', { reason: 'mobile_phone_detected' });
                  onWarning('Mobile phone detected in camera! Please remove it immediately.');
                  if (onPhoneDetected) {
                    onPhoneDetected(phoneDetectionCount.current);
                  }
                }
              } catch (e) {
                console.error("COCO-SSD Detection error:", e);
              }
            }

            // --- Eye Gaze + Head Pose via MediaPipe FaceLandmarker ---
            if (faceTracker && videoRef.current && !videoRef.current.paused) {
              try {
                const nowMs = performance.now();
                const result = faceTracker.detectForVideo(videoRef.current, nowMs);
                
                if (result && result.faceBlendshapes && result.faceBlendshapes.length > 0) {
                  const blendshapes = result.faceBlendshapes[0].categories;
                  
                  const getScore = (name: string) => {
                    const shape = blendshapes.find((b: any) => b.categoryName === name);
                    return shape ? shape.score : 0;
                  };
                  
                  // Eye gaze scores
                  const eyeLookDownLeft = getScore('eyeLookDownLeft');
                  const eyeLookDownRight = getScore('eyeLookDownRight');
                  const eyeLookOutLeft = getScore('eyeLookOutLeft');
                  const eyeLookOutRight = getScore('eyeLookOutRight');
                  const eyeLookInLeft = getScore('eyeLookInLeft');
                  const eyeLookInRight = getScore('eyeLookInRight');
                  
                  // === 1. Eye Gaze Down (looking away at lap/phone) ===
                  // Normal reading on laptop screen is 0.25 - 0.45. Only looking down toward lap exceeds 0.65.
                  const eyeDownAvg = (eyeLookDownLeft + eyeLookDownRight) / 2;
                  if (eyeDownAvg > 0.65) {
                    gazeDownCounter++;
                    if (gazeDownCounter >= TEMPORAL_THRESHOLD) {
                      recordViolation('NO_FACE', 'low', { reason: 'eye_gaze_down', score: eyeDownAvg });
                      onWarning('⚠ Please keep your eyes focused on the screen.');
                      gazeDownCounter = 0;
                    }
                  } else {
                    gazeDownCounter = 0;
                  }
                  
                  // === 2. Eye Gaze Sideways (looking far left/right off-screen) ===
                  // Normal reading across screen is 0.35 - 0.50. Looking off-screen exceeds 0.65.
                  const lookingLeft = (eyeLookOutLeft + eyeLookInRight) / 2;
                  const lookingRight = (eyeLookOutRight + eyeLookInLeft) / 2;
                  
                  if (lookingLeft > 0.65 || lookingRight > 0.65) {
                    eyeGazeSideCounter++;
                    if (eyeGazeSideCounter >= TEMPORAL_THRESHOLD) {
                      const direction = lookingLeft > lookingRight ? 'left' : 'right';
                      recordViolation('NO_FACE', 'low', { reason: 'eye_gaze_sideways', direction, score: Math.max(lookingLeft, lookingRight) });
                      onWarning('⚠ Please keep your attention on the quiz screen.');
                      eyeGazeSideCounter = 0;
                    }
                  } else {
                    eyeGazeSideCounter = 0;
                  }
                  
                  // === 3. Head Turn Detection (significant turn > 45 deg) ===
                  if (result.faceLandmarks && result.faceLandmarks.length > 0) {
                    const landmarks = result.faceLandmarks[0];
                    const noseTip = landmarks[1];
                    const leftCheek = landmarks[234];
                    const rightCheek = landmarks[454];
                    
                    if (noseTip && leftCheek && rightCheek) {
                      const faceWidth = Math.abs(rightCheek.x - leftCheek.x);
                      const noseToLeft = Math.abs(noseTip.x - leftCheek.x);
                      const noseToRight = Math.abs(noseTip.x - rightCheek.x);
                      const turnRatio = Math.min(noseToLeft, noseToRight) / (faceWidth || 0.001);
                      
                      if (turnRatio < 0.10) {
                        headTurnCounter++;
                        if (headTurnCounter >= TEMPORAL_THRESHOLD) {
                          const direction = noseToLeft < noseToRight ? 'right' : 'left';
                          recordViolation('NO_FACE', 'low', { reason: 'head_turn', direction, turnRatio });
                          onWarning('⚠ Head turn detected! Please face the screen directly.');
                          headTurnCounter = 0;
                        }
                      } else {
                        headTurnCounter = 0;
                      }
                    }
                  }
                  
                } else {
                  // No face detected by MediaPipe
                  gazeDownCounter = 0;
                  eyeGazeSideCounter = 0;
                  headTurnCounter = 0;
                }
              } catch (e) {
                console.error("FaceLandmarker error:", e);
              }
            }
          }
        }, 2500);
      } catch (err) {
        recordViolation('CAMERA_DISABLED', 'high', { reason: 'permission_denied' });
        onWarning('Camera access was denied!');
      }
    }

    initFaceDetection();

    return () => {
      cancelled = true;
      clearInterval(faceCheckInterval.current);
      setCameraActive(false);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  }, [enabled, attemptId]);

  return { violationCount, cameraActive };
}

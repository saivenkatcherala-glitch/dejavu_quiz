import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { ViolationType, Severity } from '@/lib/types';

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

// Load Blazeface for head pose / gaze tracking
let blazefacePromise: Promise<any> | null = null;
async function getBlazeface(): Promise<any> {
  if (!blazefacePromise) {
    blazefacePromise = new Promise((resolve, reject) => {
      if (!(window as any).tf) {
        reject(new Error('TF not loaded'));
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/blazeface@0.0.7/dist/blazeface.min.js';
      script.onload = async () => {
        try {
          const model = await (window as any).blazeface.load();
          resolve(model);
        } catch (e) { reject(e); }
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  return blazefacePromise;
}

const DEBOUNCE_MS = 5000; // 5 seconds between same-type violations

interface UseProctor {
  violationCount: number;
}

export function useProctoring(
  attemptId: string,
  teamId: string,
  enabled: boolean,
  onWarning: (message: string) => void,
  onPhoneDetected?: (count: number) => void
): UseProctor {
  const [violationCount, setViolationCount] = useState(0);
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

  // =====================================================
  // Face detection using simple camera check
  // (MediaPipe face detection with fallback)
  // =====================================================

  useEffect(() => {
    if (!enabled || !attemptId) return;

    let cancelled = false;

    async function initFaceDetection() {
      try {
        // Request higher resolution feed (HD) to catch objects further away
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: { ideal: 1280 }, height: { ideal: 720 } }, 
          audio: false 
        });

        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        // Create a hidden video element for face detection
        const video = document.createElement('video');
        video.width = 1280;
        video.height = 720;
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();
        videoRef.current = video;

        // Try to load COCO-SSD for phone detection (non-blocking)
        let detector: any = null;
        getCocoSsd().then(m => { detector = m; }).catch(() => { /* silently skip if fails */ });

        // Try to load Blazeface for gaze/head pose tracking (non-blocking)
        let faceDetector: any = null;
        getBlazeface().then(m => { faceDetector = m; }).catch(() => { /* silently skip if fails */ });

        // Simple face detection using Canvas + basic checks
        let noFaceCounter = 0;
        let missingPersonCounter = 0;
        const NO_FACE_THRESHOLD = 3;

        faceCheckInterval.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.paused) {
            noFaceCounter++;
            if (noFaceCounter >= NO_FACE_THRESHOLD) {
              recordViolation('CAMERA_DISABLED', 'high');
              onWarning('Camera appears to be disabled!');
              noFaceCounter = 0;
            }
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

            if (avgBrightness < 10) {
              noFaceCounter++;
              if (noFaceCounter >= NO_FACE_THRESHOLD) {
                recordViolation('CAMERA_DISABLED', 'high', { reason: 'black_frame' });
                onWarning('Camera appears to be covered or disabled!');
                noFaceCounter = 0;
              }
            } else if (samePixelCount > sampleCount * 0.95) {
              noFaceCounter++;
              if (noFaceCounter >= NO_FACE_THRESHOLD) {
                recordViolation('CAMERA_DISABLED', 'medium', { reason: 'camera_covered_solid' });
                onWarning('Camera appears to be covered or disabled!');
                noFaceCounter = 0;
              }
            } else {
              noFaceCounter = 0;
            }

            // Mobile phone detection using COCO-SSD (if model loaded)
            if (detector && canvas) {
              try {
                const predictions = await detector.detect(canvas);
                const phoneDetected = predictions.some((p: any) =>
                  ['cell phone', 'remote', 'book'].includes(p.class) && p.score > 0.35
                );
                
                // Check for missing person (walked away)
                const personCount = predictions.filter((p: any) => p.class === 'person' && p.score > 0.5).length;
                if (personCount === 0) {
                  missingPersonCounter++;
                  if (missingPersonCounter >= 3) { // 6 seconds missing
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

            // Gaze / Head Pose tracking using Blazeface (if model loaded)
            if (faceDetector && videoRef.current) {
              try {
                const faces = await faceDetector.estimateFaces(videoRef.current, false);
                if (faces.length > 0) {
                  // Landmarks: [rightEye, leftEye, nose, mouth, rightEar, leftEar]
                  const rightEye = face.landmarks[0];
                  const leftEye = face.landmarks[1];
                  const nose = face.landmarks[2];
                  const mouth = face.landmarks[3];
                  
                  const faceHeight = face.bottomRight[1] - face.topLeft[1];
                  const noseMouthDist = mouth[1] - nose[1];
                  
                  // 1. Looking Down (Pitch)
                  if (noseMouthDist < faceHeight * 0.07) {
                    recordViolation('CAMERA_DISABLED', 'medium', { reason: 'suspicious_gaze_down' });
                    onWarning('⚠ Please look up at the screen. Looking down at your lap is not permitted.');
                  }
                  
                  // 2. Looking Left/Right (Yaw)
                  // When a person turns their head, their nose visually moves toward one of their eyes.
                  const eyeDistX = Math.abs(rightEye[0] - leftEye[0]);
                  const noseToRightEyeX = Math.abs(nose[0] - rightEye[0]);
                  const noseToLeftEyeX = Math.abs(nose[0] - leftEye[0]);
                  
                  // If the nose is horizontally very close to either eye (less than 20% of the distance between eyes)
                  if (noseToRightEyeX < eyeDistX * 0.2 || noseToLeftEyeX < eyeDistX * 0.2) {
                    recordViolation('CAMERA_DISABLED', 'medium', { reason: 'suspicious_head_turn' });
                    onWarning('⚠ Please face the screen. Looking away from the quiz is not permitted.');
                  }
                }
              } catch (e) {
                console.error("Blazeface Detection error:", e);
              }
            }
          }
        }, 2000);
      } catch (err) {
        recordViolation('CAMERA_DISABLED', 'high', { reason: 'permission_denied' });
        onWarning('Camera access was denied!');
      }
    }

    initFaceDetection();

    return () => {
      cancelled = true;
      clearInterval(faceCheckInterval.current);
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  }, [enabled, attemptId]);

  return { violationCount };
}

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { ViolationType, Severity } from '@/lib/types';

const DEBOUNCE_MS = 5000; // 5 seconds between same-type violations

interface UseProctor {
  violationCount: number;
}

export function useProctoring(
  attemptId: string,
  teamId: string,
  enabled: boolean,
  onWarning: (message: string) => void
): UseProctor {
  const [violationCount, setViolationCount] = useState(0);
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

    document.addEventListener('copy', handleCopy);
    document.addEventListener('paste', handlePaste);
    document.addEventListener('contextmenu', handleContextMenu);

    return () => {
      document.removeEventListener('copy', handleCopy);
      document.removeEventListener('paste', handlePaste);
      document.removeEventListener('contextmenu', handleContextMenu);
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
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });

        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        // Create a hidden video element for face detection
        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();
        videoRef.current = video;

        // Simple face detection using Canvas + basic checks
        // For production, integrate MediaPipe FaceDetection
        // This provides camera-enabled status detection

        let noFaceCounter = 0;
        const NO_FACE_THRESHOLD = 3; // 3 checks = ~15 seconds of no face

        faceCheckInterval.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.paused) {
            noFaceCounter++;
            if (noFaceCounter >= NO_FACE_THRESHOLD) {
              recordViolation('CAMERA_DISABLED', 'high');
              onWarning('⚠ Camera appears to be disabled!');
              noFaceCounter = 0;
            }
            return;
          }

          // Check if video is actually streaming
          const canvas = document.createElement('canvas');
          canvas.width = 320;
          canvas.height = 240;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(videoRef.current, 0, 0, 320, 240);
            const imageData = ctx.getImageData(0, 0, 320, 240);
            const data = imageData.data;

            // Check if the image is all black/frozen (camera covered or disabled)
            let totalBrightness = 0;
            let samePixelCount = 0;
            const firstR = data[0], firstG = data[1], firstB = data[2];

            for (let i = 0; i < data.length; i += 4 * 100) { // Sample every 100th pixel
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
                onWarning('⚠ Camera appears to be covered or disabled!');
                noFaceCounter = 0;
              }
            } else if (samePixelCount > sampleCount * 0.95) {
              noFaceCounter++;
              if (noFaceCounter >= NO_FACE_THRESHOLD) {
                recordViolation('CAMERA_DISABLED', 'medium', { reason: 'frozen_frame' });
                noFaceCounter = 0;
              }
            } else {
              noFaceCounter = 0;
            }
          }
        }, 5000); // Check every 5 seconds
      } catch (err) {
        recordViolation('CAMERA_DISABLED', 'high', { reason: 'permission_denied' });
        onWarning('⚠ Camera access was denied!');
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

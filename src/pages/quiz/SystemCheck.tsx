import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeamSession } from '@/contexts/TeamSessionContext';
import { Button, Card } from '@/components/ui';
import { Camera, Monitor, Wifi, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

interface Check {
  name: string;
  icon: React.ReactNode;
  status: 'pending' | 'running' | 'pass' | 'fail' | 'warn';
  message: string;
}

export default function SystemCheck() {
  const { session } = useTeamSession();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [checks, setChecks] = useState<Check[]>([
    { name: 'Camera Access', icon: <Camera className="w-5 h-5" />, status: 'pending', message: 'Waiting...' },
    { name: 'Fullscreen Support', icon: <Monitor className="w-5 h-5" />, status: 'pending', message: 'Waiting...' },
    { name: 'Network Connection', icon: <Wifi className="w-5 h-5" />, status: 'pending', message: 'Waiting...' },
  ]);
  const [allPassed, setAllPassed] = useState(false);

  useEffect(() => {
    if (!session) {
      navigate('/quiz/login');
      return;
    }
    runChecks();
    return () => {
      // Cleanup camera on unmount
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  function updateCheck(index: number, update: Partial<Check>) {
    setChecks(prev => {
      const next = [...prev];
      next[index] = { ...next[index], ...update };
      return next;
    });
  }

  async function runChecks() {
    // 1. Camera check
    updateCheck(0, { status: 'running', message: 'Requesting camera...' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      updateCheck(0, { status: 'pass', message: 'Camera is working' });
    } catch (err) {
      updateCheck(0, { status: 'fail', message: 'Camera access denied. Please enable camera permissions.' });
    }

    // 2. Fullscreen check
    updateCheck(1, { status: 'running', message: 'Checking...' });
    if (typeof document.documentElement.requestFullscreen === 'function') {
      updateCheck(1, { status: 'pass', message: 'Fullscreen is supported' });
    } else {
      updateCheck(1, { status: 'warn', message: 'Fullscreen may not be fully supported' });
    }

    // 3. Network check
    updateCheck(2, { status: 'running', message: 'Checking...' });
    if (navigator.onLine) {
      updateCheck(2, { status: 'pass', message: 'Connected to the internet' });
    } else {
      updateCheck(2, { status: 'fail', message: 'No internet connection detected' });
    }

    // Check if all passed
    setChecks(prev => {
      const passed = prev.every(c => c.status === 'pass' || c.status === 'warn');
      setAllPassed(passed);
      return prev;
    });

    // Use timeout to ensure state is settled
    setTimeout(() => {
      setChecks(prev => {
        const passed = prev.every(c => c.status === 'pass' || c.status === 'warn');
        setAllPassed(passed);
        return prev;
      });
    }, 200);
  }

  function handleContinue() {
    // Don't stop camera stream - it'll be reused in the quiz
    navigate('/quiz/instructions');
  }

  const statusIcon = (status: Check['status']) => {
    switch (status) {
      case 'pass': return <CheckCircle className="w-5 h-5 text-emerald-500" />;
      case 'fail': return <XCircle className="w-5 h-5 text-red-500" />;
      case 'warn': return <AlertTriangle className="w-5 h-5 text-amber-500" />;
      default: return <div className="w-5 h-5 border-2 border-gray-300 border-t-indigo-600 rounded-full animate-spin" />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">System Check</h1>
          <p className="text-gray-500 mt-2">Let's make sure everything works before the quiz</p>
        </div>

        <Card>
          {/* Camera Preview */}
          <div className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden mb-6">
            <video ref={videoRef} className="w-full h-full object-cover" autoPlay muted playsInline />
            {checks[0].status !== 'pass' && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80">
                <Camera className="w-12 h-12 text-gray-500" />
              </div>
            )}
          </div>

          {/* Checks */}
          <div className="space-y-3 mb-6">
            {checks.map((check, i) => (
              <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="text-gray-600">{check.icon}</div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{check.name}</p>
                  <p className={`text-xs ${check.status === 'fail' ? 'text-red-600' : 'text-gray-500'}`}>
                    {check.message}
                  </p>
                </div>
                {statusIcon(check.status)}
              </div>
            ))}
          </div>

          <Button onClick={handleContinue} className="w-full" size="lg" disabled={!allPassed}>
            Continue to Instructions
          </Button>

          {!allPassed && checks.some(c => c.status === 'fail') && (
            <p className="text-center text-sm text-red-600 mt-3">
              Please resolve the failed checks before continuing.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

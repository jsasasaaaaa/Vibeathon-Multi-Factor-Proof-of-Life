
import React, { useRef, useEffect, useState } from 'react';
import { GestureRecognizer, FilesetResolver } from '@mediapipe/tasks-vision';

interface CameraFeedProps {
  onFrame: (base64Frame: string) => void;
  onGestureDetected: (gesture: string) => void;
  isActive: boolean;
}

const CameraFeed: React.FC<CameraFeedProps> = ({ onFrame, onGestureDetected, isActive }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [gestureRecognizer, setGestureRecognizer] = useState<GestureRecognizer | null>(null);
  const [isRecognizerLoading, setIsRecognizerLoading] = useState(false);

  useEffect(() => {
    const initMediaPipe = async () => {
      if (gestureRecognizer || isRecognizerLoading) return;
      setIsRecognizerLoading(true);
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        const recognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });
        setGestureRecognizer(recognizer);
      } catch (err) {
        console.warn("MediaPipe GPU delegate failed or unsupported, falling back to CPU.", err);
        // The "INFO: Created TensorFlow Lite XNNPACK delegate for CPU" message is standard behavior
        // when falling back to CPU or when GPU is not explicitly used by the system.
      } finally {
        setIsRecognizerLoading(false);
      }
    };
    initMediaPipe();
  }, [gestureRecognizer, isRecognizerLoading]);

  useEffect(() => {
    let interval: number;

    const stopCamera = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };

    const startCamera = async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, frameRate: 15 },
          audio: false
        });
        streamRef.current = mediaStream;
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }

        interval = window.setInterval(() => {
          if (canvasRef.current && videoRef.current && isActive && streamRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx && gestureRecognizer) {
              canvasRef.current.width = videoRef.current.videoWidth;
              canvasRef.current.height = videoRef.current.videoHeight;
              ctx.drawImage(videoRef.current, 0, 0);

              // 1. Local Gesture Recognition
              const nowInMs = Date.now();
              const results = gestureRecognizer.recognizeForVideo(videoRef.current, nowInMs);
              if (results.gestures && results.gestures.length > 0) {
                const topGesture = results.gestures[0][0].categoryName;
                onGestureDetected(topGesture);
              } else {
                onGestureDetected('None');
              }

              // 2. Send Frame to Gemini for Liveness/Micro-emotions
              const base64 = canvasRef.current.toDataURL('image/jpeg', 0.6).split(',')[1];
              onFrame(base64);
            }
          }
        }, 500); 
      } catch (err) {
        console.error('Error accessing camera:', err);
      }
    };

    if (isActive) {
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      if (interval) clearInterval(interval);
      stopCamera();
    };
  }, [isActive, gestureRecognizer]);

  return (
    <div className="relative w-full aspect-video bg-slate-900 rounded-2xl overflow-hidden border-2 border-slate-800 shadow-2xl">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`w-full h-full object-cover transform ${isActive ? 'scale-x-[-1]' : 'opacity-0'} transition-opacity duration-500`}
      />
      <canvas ref={canvasRef} className="hidden" />
      
      {!isActive && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 backdrop-blur-sm animate-in fade-in duration-500">
          <div className="text-center space-y-3">
            <div className="w-12 h-12 rounded-full border-2 border-slate-800 border-t-indigo-500 animate-spin mx-auto mb-4 opacity-20" />
            <p className="text-slate-500 text-sm font-semibold tracking-widest uppercase">Biometric Hub Locked</p>
          </div>
        </div>
      )}
      
      {isActive && (
        <div className="absolute top-4 right-4 flex items-center gap-2 animate-in slide-in-from-top-2">
          <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
          <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-[0.2em] drop-shadow-md">Audit Active</span>
        </div>
      )}

      <div className="absolute inset-0 border-[20px] border-white/5 pointer-events-none rounded-2xl" />
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
    </div>
  );
};

export default CameraFeed;

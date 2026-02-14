
import React, { useState, useCallback, useRef } from 'react';
import { VerificationStatus, BIO_CHALLENGES } from './types.ts';
import CameraFeed from './components/CameraFeed.tsx';
import { startVerificationSession } from './services/geminiService.ts';
import { ShieldCheck, UserCheck, RefreshCw, LogIn, Fingerprint, Lock, ShieldAlert, Sparkles, Target, CheckCircle2 } from 'lucide-react';

const App: React.FC = () => {
  const [status, setStatus] = useState<VerificationStatus>(VerificationStatus.IDLE);
  const [currentChallenge, setCurrentChallenge] = useState<typeof BIO_CHALLENGES[0] | null>(null);
  const [detectedGesture, setDetectedGesture] = useState<string>('None');
  const [aiFeedback, setAiFeedback] = useState<string>('Ready to secure your session.');
  const [token, setToken] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  
  const sessionRef = useRef<any>(null);
  const lastUpdateRef = useRef<number>(0);
  const isFinalizingRef = useRef<boolean>(false);

  const handleStatusUpdate = (msg: string) => {
    setAiFeedback(msg);
  };

  const handleVerificationComplete = (passed: boolean, reason?: string) => {
    if (isFinalizingRef.current) return;
    isFinalizingRef.current = true;

    if (passed) {
      const newToken = `POL-${Math.random().toString(36).substring(2, 15).toUpperCase()}`;
      setToken(newToken);
      setStatus(VerificationStatus.SUCCESS);
      setAiFeedback('Verification Successful. Proof-of-life confirmed.');
    } else {
      setStatus(VerificationStatus.FAILED);
      setErrorReason(reason || 'AI could not verify humanity or challenge completion.');
      setAiFeedback('Verification failed.');
    }
    
    // Decisively close the session and release camera access
    if (sessionRef.current) {
      Promise.resolve(sessionRef.current).then((s: any) => {
        if (s && typeof s.close === 'function') {
          try { 
            s.close(); 
          } catch(e) {
            console.warn("Error closing session:", e);
          }
        }
      });
      sessionRef.current = null;
    }
  };

  const startVerification = async () => {
    isFinalizingRef.current = false;
    const randomChallenge = BIO_CHALLENGES[Math.floor(Math.random() * BIO_CHALLENGES.length)];
    setCurrentChallenge(randomChallenge);
    
    setStatus(VerificationStatus.PREPARING);
    setToken(null);
    setErrorReason(null);
    setAiFeedback('Calibrating biometric sensors...');

    try {
      // Return the promise directly to sessionRef.current
      const sessionPromise = startVerificationSession(randomChallenge.instruction, {
        onStatusUpdate: handleStatusUpdate,
        onVerificationComplete: handleVerificationComplete,
        onTranscription: (text) => setAiFeedback(text)
      });
      sessionRef.current = sessionPromise;
      setStatus(VerificationStatus.CHALLENGING);
    } catch (err) {
      console.error(err);
      setStatus(VerificationStatus.FAILED);
      setErrorReason('Failed to initialize AI verification session.');
    }
  };

  const handleGestureDetected = useCallback((gesture: string) => {
    if (status !== VerificationStatus.CHALLENGING || isFinalizingRef.current) return;

    setDetectedGesture(gesture);
    
    if (currentChallenge && gesture === currentChallenge.gestureLabel) {
      const now = Date.now();
      if (now - lastUpdateRef.current > 3000) {
        lastUpdateRef.current = now;
        // Use Promise.resolve for safe session interaction to fix ".then is not a function"
        Promise.resolve(sessionRef.current).then((session: any) => {
          if (session && typeof session.sendRealtimeInput === 'function') {
            session.sendRealtimeInput({
              text: `SYSTEM_SIGNAL: Gesture "${gesture}" detected by local MediaPipe. Please confirm proof of life and finish the verification.`
            });
          }
        });
      }
    }
  }, [status, currentChallenge]);

  const sendFrameToAi = useCallback((base64: string) => {
    if (isFinalizingRef.current) return;

    if (sessionRef.current && (status === VerificationStatus.CHALLENGING || status === VerificationStatus.PREPARING)) {
      // Use Promise.resolve for safe session interaction to fix ".then is not a function"
      Promise.resolve(sessionRef.current).then((session: any) => {
        try {
          if (session && typeof session.sendRealtimeInput === 'function') {
            session.sendRealtimeInput({
              media: { data: base64, mimeType: 'image/jpeg' }
            });
          }
        } catch (e) {
          // Expected during session teardown
        }
      });
    }
  }, [status]);

  const reset = () => {
    isFinalizingRef.current = false;
    if (sessionRef.current) {
        Promise.resolve(sessionRef.current).then((s: any) => {
          if (s && typeof s.close === 'function') {
            try { s.close(); } catch(e) {}
          }
        });
        sessionRef.current = null;
    }
    setStatus(VerificationStatus.IDLE);
    setCurrentChallenge(null);
    setDetectedGesture('None');
    setToken(null);
    setErrorReason(null);
    setAiFeedback('Ready to secure your session.');
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-8 bg-slate-950 text-slate-100 selection:bg-indigo-500/30">
      <div className="max-w-2xl w-full">
        {/* Header */}
        <div className="text-center mb-10 space-y-2">
          <div className="inline-flex items-center justify-center p-3 bg-indigo-500/10 rounded-2xl mb-4 border border-indigo-500/20 shadow-lg shadow-indigo-500/5">
            <ShieldCheck className="w-8 h-8 text-indigo-400" />
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl gradient-text">
            BioGuard MFA
          </h1>
          <p className="text-slate-500 text-lg font-medium">
            Next-Gen Biometric Liveness Audit
          </p>
        </div>

        {/* Main Interface */}
        <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl relative overflow-hidden ring-1 ring-white/5">
          
          <div className="absolute top-0 inset-x-0 h-1 flex z-10">
            <div className={`h-full transition-all duration-700 ease-in-out ${
              status === VerificationStatus.SUCCESS ? 'bg-emerald-500 w-full' :
              status === VerificationStatus.FAILED ? 'bg-red-500 w-full' :
              status === VerificationStatus.CHALLENGING ? 'bg-indigo-500 w-2/3 animate-pulse' :
              status === VerificationStatus.PREPARING ? 'bg-indigo-500 w-1/3' : 'bg-slate-800 w-0'
            }`} />
          </div>

          <div className="space-y-8">
            <div className="relative group">
              {status === VerificationStatus.SUCCESS ? (
                <div className="w-full aspect-video bg-emerald-500/5 border-2 border-emerald-500/30 rounded-2xl flex flex-col items-center justify-center text-center p-6 animate-in fade-in zoom-in duration-500">
                  <div className="relative mb-6">
                    <div className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.5)] ring-4 ring-emerald-500/20">
                      <CheckCircle2 className="w-10 h-10 text-white" />
                    </div>
                    <div className="absolute -top-2 -right-2 w-6 h-6 bg-slate-950 rounded-full border-2 border-emerald-500 flex items-center justify-center">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                    </div>
                  </div>
                  <h3 className="text-2xl font-bold text-emerald-400 mb-2">Verification Successful</h3>
                  <p className="text-slate-400 mb-8 max-w-xs mx-auto font-medium">Access granted. Your identity has been biometrically sealed.</p>
                  
                  <div className="w-full bg-slate-950/80 border border-slate-800 p-5 rounded-2xl flex items-center justify-between group-hover:border-emerald-500/40 transition-all shadow-lg ring-1 ring-white/5">
                    <div className="flex flex-col items-start">
                      <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold mb-2">Proof of Life Token</span>
                      <code className="text-emerald-400 font-mono text-lg tracking-wider">{token}</code>
                    </div>
                    <div className="p-3 bg-emerald-500/10 rounded-xl">
                      <Lock className="w-5 h-5 text-emerald-500" />
                    </div>
                  </div>
                </div>
              ) : status === VerificationStatus.FAILED ? (
                <div className="w-full aspect-video bg-red-500/5 border-2 border-red-500/20 rounded-2xl flex flex-col items-center justify-center text-center p-6 animate-in fade-in zoom-in duration-500">
                  <div className="w-20 h-20 bg-red-500 rounded-full flex items-center justify-center mb-6 shadow-xl shadow-red-500/40 ring-4 ring-red-500/20">
                    <ShieldAlert className="w-10 h-10 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold text-red-400 mb-2">Biometric Mismatch</h3>
                  <p className="text-slate-400 mb-6 max-w-sm mx-auto font-medium">{errorReason}</p>
                  <button 
                    onClick={reset}
                    className="flex items-center gap-3 text-sm font-bold text-white bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 px-8 py-3 rounded-full transition-all"
                  >
                    <RefreshCw className="w-4 h-4" /> Restart Audit
                  </button>
                </div>
              ) : (
                <div className="relative group transition-transform duration-500">
                  <CameraFeed 
                    isActive={(status === VerificationStatus.CHALLENGING || status === VerificationStatus.PREPARING) && !isFinalizingRef.current} 
                    onFrame={sendFrameToAi} 
                    onGestureDetected={handleGestureDetected}
                  />
                  {status === VerificationStatus.CHALLENGING && (
                    <div className="absolute bottom-6 right-6 bg-slate-950/90 backdrop-blur-md border border-white/10 px-4 py-2 rounded-xl flex items-center gap-3 shadow-2xl ring-1 ring-white/10 transition-all scale-100 animate-in fade-in slide-in-from-bottom-2">
                       <div className={`p-1 rounded-full ${detectedGesture === currentChallenge?.gestureLabel ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.6)]' : 'bg-slate-700'}`}>
                         <Target className={`w-3.5 h-3.5 text-white`} />
                       </div>
                       <div className="flex flex-col">
                         <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Local Sensor</span>
                         <span className={`text-xs font-bold ${detectedGesture === currentChallenge?.gestureLabel ? 'text-emerald-400' : 'text-slate-300'}`}>
                           {detectedGesture}
                         </span>
                       </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className={`p-6 rounded-3xl transition-all duration-500 border-2 ${
              status === VerificationStatus.CHALLENGING ? 'bg-indigo-500/5 border-indigo-500/30 shadow-[0_0_40px_rgba(99,102,241,0.05)]' : 'bg-slate-800/20 border-white/5'
            }`}>
              <div className="flex items-start gap-5">
                <div className={`p-3.5 rounded-2xl shrink-0 transition-all duration-300 ${
                   status === VerificationStatus.CHALLENGING ? 'bg-indigo-600 shadow-xl shadow-indigo-600/40 ring-4 ring-indigo-500/20' : 'bg-slate-700'
                }`}>
                  {status === VerificationStatus.CHALLENGING ? <Sparkles className="w-5 h-5 text-white animate-pulse" /> : <Fingerprint className="w-5 h-5 text-slate-500" />}
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.3em] mb-3">
                    {currentChallenge ? 'Required Physical Action' : 'Biometric Link Status'}
                  </h4>
                  <p className={`text-2xl font-bold leading-tight tracking-tight mb-4 ${currentChallenge ? 'text-white' : 'text-slate-400'}`}>
                    {currentChallenge?.instruction || aiFeedback}
                  </p>
                  
                  {currentChallenge && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        <span>Gesture Completion</span>
                        <span className={detectedGesture === currentChallenge.gestureLabel ? 'text-emerald-400' : ''}>
                          {detectedGesture === currentChallenge.gestureLabel ? 'Verified locally' : 'Awaiting sensor input'}
                        </span>
                      </div>
                      <div className="h-2 w-full bg-slate-800/50 rounded-full overflow-hidden p-0.5 border border-white/5 shadow-inner">
                        <div className={`h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-700 ease-out shadow-[0_0_8px_rgba(16,185,129,0.5)] ${detectedGesture === currentChallenge.gestureLabel ? 'w-full' : 'w-0'}`} />
                      </div>
                      <div className="flex items-center gap-2 px-3 py-2 bg-slate-950/40 rounded-xl border border-white/5">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse shadow-[0_0_4px_rgba(99,102,241,0.8)]" />
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                          AI Feed: <span className="text-slate-300 lowercase font-medium ml-1">{aiFeedback}</span>
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              {status === VerificationStatus.IDLE && (
                <button
                  onClick={startVerification}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-5 rounded-2xl shadow-2xl shadow-indigo-600/40 transition-all flex items-center justify-center gap-4 active:scale-[0.97] group relative overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
                  <LogIn className="w-6 h-6 transition-transform group-hover:translate-x-1" />
                  Initiate Secure Login
                </button>
              )}
              
              {status === VerificationStatus.SUCCESS && (
                <button
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-5 rounded-2xl shadow-xl border border-white/5 transition-all flex items-center justify-center gap-4 active:scale-95"
                  onClick={reset}
                >
                  <RefreshCw className="w-5 h-5" /> Start New Verification
                </button>
              )}

              {(status === VerificationStatus.CHALLENGING || status === VerificationStatus.PREPARING) && (
                <button
                  onClick={reset}
                  className="flex-1 bg-slate-900/50 hover:bg-red-500/10 text-slate-500 hover:text-red-400 font-bold py-5 rounded-2xl transition-all flex items-center justify-center gap-4 active:scale-95 border border-white/5 group"
                >
                  <ShieldAlert className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                  Abort Audit
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Security Info */}
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-6 text-slate-600 text-[10px] uppercase font-bold tracking-[0.2em] opacity-60">
          <div className="flex flex-col items-center gap-2 text-center">
            <Fingerprint className="w-4 h-4 mb-1 text-emerald-500" />
            MediaPipe Gesture Core
          </div>
          <div className="flex flex-col items-center gap-2 text-center border-x border-white/5">
            <Target className="w-4 h-4 mb-1 text-indigo-500" />
            Gemini Flash Liveness
          </div>
          <div className="flex flex-col items-center gap-2 text-center">
            <Lock className="w-4 h-4 mb-1 text-slate-400" />
            Encrypted Session Token
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;

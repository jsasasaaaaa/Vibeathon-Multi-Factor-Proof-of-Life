
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { decode, decodeAudioData } from '../utils/audio.ts';

const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-12-2025';

export interface GeminiSessionCallbacks {
  onStatusUpdate: (status: string) => void;
  onVerificationComplete: (passed: boolean, reason?: string) => void;
  onTranscription?: (text: string) => void;
}

export const startVerificationSession = async (
  challenge: string,
  callbacks: GeminiSessionCallbacks
) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

  let nextStartTime = 0;
  const outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  const outputNode = outputAudioContext.createGain();
  outputNode.connect(outputAudioContext.destination);
  const sources = new Set<AudioBufferSourceNode>();

  let fullOutputTranscription = '';

  const sessionPromise = ai.live.connect({
    model: MODEL_NAME,
    config: {
      responseModalities: [Modality.AUDIO],
      outputAudioTranscription: {},
      systemInstruction: `You are a high-security Biometric Liveness Auditor.
      
      ROLE:
      - Monitor the user attempting the gesture: "${challenge}".
      - A local computer vision module is also checking the gesture.
      - Your primary mission is "Proof of Life": detect deepfakes, static masks, or video injections via micro-emotions, blink frequency, and natural movement.
      
      ON SUCCESS:
      - When you are satisfied the user is a real human and the gesture is correct, you MUST say: "Identity verified. Verification was successful. You are confirmed as a human user."
      - Immediately after that spoken sentence, you MUST output the keyword: VERIFICATION_PASSED.
      
      ON FAILURE:
      - If you detect suspicious activity (lack of micro-movements, unnatural eyes, etc.), say "Verification Failed: [Reason]" followed by the keyword: VERIFICATION_FAILED.
      
      Maintain a professional and alert tone.`,
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
      },
    },
    callbacks: {
      onopen: () => {
        callbacks.onStatusUpdate('Biometric link secured. Awaiting gesture...');
      },
      onmessage: async (message: LiveServerMessage) => {
        if (message.serverContent?.outputTranscription) {
          const newText = message.serverContent.outputTranscription.text;
          fullOutputTranscription += newText;
          callbacks.onTranscription?.(fullOutputTranscription);
          
          const upperText = fullOutputTranscription.toUpperCase();
          if (upperText.includes('VERIFICATION_PASSED')) {
            // Slight delay to allow the audio to finish playing the success message
            setTimeout(() => {
              callbacks.onVerificationComplete(true);
            }, 1000);
          } else if (upperText.includes('VERIFICATION_FAILED')) {
            const parts = fullOutputTranscription.split(/VERIFICATION_FAILED/i);
            const reason = parts[1]?.replace(':', '').trim() || "Biometric anomaly.";
            callbacks.onVerificationComplete(false, reason);
          }
        }

        if (message.serverContent?.turnComplete) {
          fullOutputTranscription = '';
        }

        const base64EncodedAudioString = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
        if (base64EncodedAudioString) {
          nextStartTime = Math.max(nextStartTime, outputAudioContext.currentTime);
          const audioBuffer = await decodeAudioData(
            decode(base64EncodedAudioString),
            outputAudioContext,
            24000,
            1
          );
          const source = outputAudioContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(outputNode);
          source.addEventListener('ended', () => {
            sources.delete(source);
          });
          source.start(nextStartTime);
          nextStartTime = nextStartTime + audioBuffer.duration;
          sources.add(source);
        }
      },
      onerror: (e) => {
        console.error('Gemini error:', e);
        callbacks.onStatusUpdate('Biometric link lost.');
      },
      onclose: () => {
        callbacks.onStatusUpdate('Session terminated.');
        outputAudioContext.close();
      },
    },
  });

  return sessionPromise;
};

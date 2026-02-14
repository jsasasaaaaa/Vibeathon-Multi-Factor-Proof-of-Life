
export enum VerificationStatus {
  IDLE = 'IDLE',
  PREPARING = 'PREPARING',
  CHALLENGING = 'CHALLENGING',
  ANALYZING = 'ANALYZING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED'
}

export interface VerificationChallenge {
  id: string;
  instruction: string;
  gestureLabel: string;
}

export const BIO_CHALLENGES: VerificationChallenge[] = [
  { id: 'open_hand', instruction: 'Show your open palm to the camera.', gestureLabel: 'Open_Palm' },
  { id: 'victory', instruction: 'Show a peace sign (Victory gesture).', gestureLabel: 'Victory' },
  { id: 'thumbs_up', instruction: 'Give a thumbs up to the camera.', gestureLabel: 'Thumbs_Up' },
  { id: 'pointing_up', instruction: 'Point upward with your index finger.', gestureLabel: 'Pointing_Up' },
  { id: 'fist', instruction: 'Make a closed fist and show it to the camera.', gestureLabel: 'Closed_Fist' }
];

export interface VerificationResult {
  passed: boolean;
  token?: string;
  reason?: string;
  humanityScore: number;
}

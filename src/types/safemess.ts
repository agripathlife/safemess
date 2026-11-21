export type VoicePreset = 'deep' | 'cartoon' | 'robot';

export type SessionMode = 'voice' | 'video' | 'chat' | 'emergency';

export interface TrustedContact {
  peerId: string;
  displayName: string;
  relationLabel?: string;
  publicKeyJwk: JsonWebKey;
  fingerprint: string;
  addedAt: number;
}

export interface SafeMessIdentity {
  peerId: string;
  displayName: string;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  fingerprint: string;
  createdAt: number;
}

export interface PinCredential {
  saltB64: string;
  hashB64: string;
  biometricCredentialId?: string;
}

export interface SafeMessVault {
  version: number;
  identity: SafeMessIdentity;
  contacts: TrustedContact[];
  pin?: PinCredential;
  updatedAt: number;
}

export interface QrPairingPayload {
  v: 1;
  peerId: string;
  displayName: string;
  publicKeyJwk: JsonWebKey;
  fingerprint: string;
}

export interface AsymmetricChatMessage {
  id: string;
  direction: 'outgoing' | 'incoming';
  senderName: string;
  text: string | null;
  hiddenAfterSend: boolean;
  countdownSeconds: number;
  timestamp: number;
}

export interface IncomingCallInvite {
  ticketId: string;
  callerPeerId: string;
  callerName: string;
  callerFingerprint: string;
  mode: SessionMode;
  verifiedContact: TrustedContact;
  fromQueue?: boolean;
}

export interface ActiveSession {
  ticketId: string;
  contact: TrustedContact;
  mode: 'voice' | 'video' | 'chat';
  isInitiator: boolean;
  ticketBurned: boolean;
}

import type {SessionMode} from '../types/safemess';

export type SignalingEvent =
  | {type: 'connected'}
  | {type: 'disconnected'}
  | {type: 'registered'; peerId: string}
  | {type: 'presence:state'; states: Record<string, boolean>}
  | {type: 'presence:update'; peerId: string; online: boolean}
  | {
      type: 'call:incoming';
      ticketId: string;
      callerPeerId: string;
      callerName: string;
      callerFingerprint: string;
      mode: SessionMode;
      fromQueue?: boolean;
    }
  | {
      type: 'ticket:issued';
      ticketId: string;
      targetPeerId: string;
      mode: SessionMode;
      targetOnline: boolean;
      queuedEmergency?: boolean;
    }
  | {type: 'ticket:unavailable'; targetPeerId: string; mode: SessionMode}
  | {
      type: 'ticket:accepted';
      ticketId: string;
      peerId: string;
      mode: SessionMode;
      burned: boolean;
    }
  | {
      type: 'ticket:burned';
      ticketId: string;
      peerId: string;
      mode: SessionMode;
    }
  | {type: 'ticket:rejected'; ticketId: string}
  | {type: 'ticket:invalid'; ticketId: string}
  | {type: 'rtc:signal'; ticketId: string; fromPeerId: string; signal: unknown}
  | {type: 'session:ended'; ticketId?: string; byPeerId: string};

export class SafeMessSignalingClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private disposed = false;
  private identity: {peerId: string; displayName: string; fingerprint: string} | null = null;
  private subscribedIds: string[] = [];
  private listeners = new Set<(event: SignalingEvent) => void>();

  connect(identity: {peerId: string; displayName: string; fingerprint: string}): void {
    this.identity = identity;
    this.disposed = false;
    this.openSocket();
  }

  private openSocket(): void {
    if (this.disposed || !this.identity) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      this.emit({type: 'connected'});
      if (this.identity) {
        this.send({
          type: 'register',
          peerId: this.identity.peerId,
          displayName: this.identity.displayName,
          fingerprint: this.identity.fingerprint,
        });
      }
      if (this.subscribedIds.length > 0) {
        this.send({
          type: 'presence:subscribe',
          contactPeerIds: this.subscribedIds,
        });
      }
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as SignalingEvent;
        this.emit(msg);
      } catch {
        // ignore malformed packets
      }
    };

    ws.onclose = () => {
      this.emit({type: 'disconnected'});
      this.ws = null;
      if (!this.disposed) {
        this.reconnectTimer = window.setTimeout(() => {
          this.openSocket();
        }, 2500);
      }
    };
  }

  subscribePresence(contactPeerIds: string[]): void {
    this.subscribedIds = contactPeerIds;
    this.send({
      type: 'presence:subscribe',
      contactPeerIds,
    });
  }

  requestTicket(targetPeerId: string, mode: SessionMode): void {
    this.send({
      type: 'ticket:request',
      targetPeerId,
      mode,
    });
  }

  acceptTicket(ticketId: string): void {
    this.send({
      type: 'ticket:accept',
      ticketId,
    });
  }

  rejectTicket(ticketId: string): void {
    this.send({
      type: 'ticket:reject',
      ticketId,
    });
  }

  sendRtcSignal(ticketId: string, targetPeerId: string, signal: unknown): void {
    this.send({
      type: 'rtc:signal',
      ticketId,
      targetPeerId,
      signal,
    });
  }

  endSession(ticketId: string, targetPeerId: string): void {
    this.send({
      type: 'session:end',
      ticketId,
      targetPeerId,
    });
  }

  onEvent(listener: (event: SignalingEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: SignalingEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  disconnect(): void {
    this.disposed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.listeners.clear();
  }
}

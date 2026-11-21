import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import {WebSocketServer, WebSocket} from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

interface PeerConnection {
  ws: WebSocket;
  peerId: string;
  displayName: string;
  fingerprint: string;
  subscribedContacts: Set<string>;
}

interface OneTimeTicket {
  ticketId: string;
  callerPeerId: string;
  calleePeerId: string;
  mode: 'voice' | 'video' | 'chat' | 'emergency';
  createdAt: number;
  used: boolean;
}

interface ActiveSession {
  ticketId: string;
  peerA: string;
  peerB: string;
  createdAt: number;
}

interface EmergencyAlert {
  ticketId: string;
  callerPeerId: string;
  callerName: string;
  callerFingerprint: string;
  createdAt: number;
}

const peers = new Map<string, PeerConnection>();
const tickets = new Map<string, OneTimeTicket>();
const activeSessions = new Map<string, ActiveSession>();
const emergencyQueue = new Map<string, EmergencyAlert[]>();

const TICKET_TTL_MS = 60_000;
const EMERGENCY_TTL_MS = 5 * 60_000;

function isValidString(val: unknown, maxLen = 128): val is string {
  return typeof val === 'string' && val.trim().length > 0 && val.length <= maxLen;
}

function sendJson(ws: WebSocket | undefined, payload: Record<string, unknown>) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastPresenceToSubscribers(targetPeerId: string, online: boolean) {
  for (const conn of peers.values()) {
    if (conn.subscribedContacts.has(targetPeerId)) {
      sendJson(conn.ws, {
        type: 'presence:update',
        peerId: targetPeerId,
        online,
      });
    }
  }
}

// Periodically purge expired one-time tickets and expired emergency alerts
setInterval(() => {
  const now = Date.now();
  for (const [id, ticket] of tickets.entries()) {
    if (now - ticket.createdAt > TICKET_TTL_MS || ticket.used) {
      tickets.delete(id);
    }
  }
  for (const [peerId, alerts] of emergencyQueue.entries()) {
    const valid = alerts.filter((a) => now - a.createdAt <= EMERGENCY_TTL_MS);
    if (valid.length === 0) {
      emergencyQueue.delete(peerId);
    } else {
      emergencyQueue.set(peerId, valid);
    }
  }
}, 15_000).unref();

async function startServer() {
  const app = express();
  app.use(express.json({limit: '128kb'}));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      mode: 'zero-trace-p2p-signaling',
      activePeers: peers.size,
    });
  });

  if (IS_PROD) {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({server: httpServer, path: '/ws'});

  wss.on('connection', (ws) => {
    let boundPeerId: string | null = null;

    ws.on('message', (raw) => {
      if (raw.toString().length > 65_536) {
        return;
      }

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = msg.type;
      if (typeof type !== 'string') return;

      if (type === 'register') {
        const peerId = msg.peerId;
        const displayName = msg.displayName;
        const fingerprint = msg.fingerprint;
        if (
          !isValidString(peerId, 128) ||
          !isValidString(displayName, 100) ||
          !isValidString(fingerprint, 64)
        ) {
          sendJson(ws, {type: 'error', message: 'Invalid peer identity payload'});
          return;
        }

        // Replace stale socket if same peerId reconnects
        const previous = peers.get(peerId);
        if (previous && previous.ws !== ws) {
          try {
            previous.ws.close(4001, 'Replaced by newer session');
          } catch {
            // ignore
          }
        }

        boundPeerId = peerId;
        peers.set(peerId, {
          ws,
          peerId,
          displayName: displayName.trim(),
          fingerprint: fingerprint.trim(),
          subscribedContacts: new Set<string>(),
        });

        sendJson(ws, {type: 'registered', peerId});
        broadcastPresenceToSubscribers(peerId, true);

        // Deliver any queued high-priority emergency rings
        const pendingAlerts = emergencyQueue.get(peerId);
        if (pendingAlerts && pendingAlerts.length > 0) {
          const now = Date.now();
          for (const alert of pendingAlerts) {
            if (now - alert.createdAt <= EMERGENCY_TTL_MS) {
              sendJson(ws, {
                type: 'call:incoming',
                ticketId: alert.ticketId,
                callerPeerId: alert.callerPeerId,
                callerName: alert.callerName,
                callerFingerprint: alert.callerFingerprint,
                mode: 'emergency',
                fromQueue: true,
              });
            }
          }
          emergencyQueue.delete(peerId);
        }
        return;
      }

      if (!boundPeerId) {
        sendJson(ws, {type: 'error', message: 'Unregistered socket'});
        return;
      }

      const self = peers.get(boundPeerId);
      if (!self) return;

      if (type === 'presence:subscribe') {
        const contactPeerIds = msg.contactPeerIds;
        if (!Array.isArray(contactPeerIds) || contactPeerIds.length > 100) return;

        self.subscribedContacts.clear();
        const states: Record<string, boolean> = {};
        for (const id of contactPeerIds) {
          if (isValidString(id, 128)) {
            self.subscribedContacts.add(id);
            states[id] = peers.has(id);
          }
        }
        sendJson(ws, {type: 'presence:state', states});
        return;
      }

      if (type === 'ticket:request') {
        const targetPeerId = msg.targetPeerId;
        const mode = msg.mode;
        if (
          !isValidString(targetPeerId, 128) ||
          (mode !== 'voice' && mode !== 'video' && mode !== 'chat' && mode !== 'emergency')
        ) {
          return;
        }
        if (targetPeerId === boundPeerId) return;

        const ticketId = crypto.randomUUID();
        const ticket: OneTimeTicket = {
          ticketId,
          callerPeerId: boundPeerId,
          calleePeerId: targetPeerId,
          mode,
          createdAt: Date.now(),
          used: false,
        };
        tickets.set(ticketId, ticket);

        const targetConn = peers.get(targetPeerId);
        if (targetConn) {
          sendJson(targetConn.ws, {
            type: 'call:incoming',
            ticketId,
            callerPeerId: boundPeerId,
            callerName: self.displayName,
            callerFingerprint: self.fingerprint,
            mode,
          });
          sendJson(ws, {
            type: 'ticket:issued',
            ticketId,
            targetPeerId,
            mode,
            targetOnline: true,
          });
        } else if (mode === 'emergency') {
          const list = emergencyQueue.get(targetPeerId) ?? [];
          list.push({
            ticketId,
            callerPeerId: boundPeerId,
            callerName: self.displayName,
            callerFingerprint: self.fingerprint,
            createdAt: Date.now(),
          });
          emergencyQueue.set(targetPeerId, list);
          sendJson(ws, {
            type: 'ticket:issued',
            ticketId,
            targetPeerId,
            mode,
            targetOnline: false,
            queuedEmergency: true,
          });
        } else {
          tickets.delete(ticketId);
          sendJson(ws, {
            type: 'ticket:unavailable',
            targetPeerId,
            mode,
          });
        }
        return;
      }

      if (type === 'ticket:accept') {
        const ticketId = msg.ticketId;
        if (!isValidString(ticketId, 128)) return;

        const ticket = tickets.get(ticketId);
        if (!ticket || ticket.used || ticket.calleePeerId !== boundPeerId) {
          sendJson(ws, {type: 'ticket:invalid', ticketId});
          return;
        }

        // Burn one-time ticket immediately upon acceptance
        ticket.used = true;
        tickets.delete(ticketId);

        activeSessions.set(ticketId, {
          ticketId,
          peerA: ticket.callerPeerId,
          peerB: ticket.calleePeerId,
          createdAt: Date.now(),
        });

        const callerConn = peers.get(ticket.callerPeerId);
        sendJson(callerConn?.ws, {
          type: 'ticket:accepted',
          ticketId,
          peerId: boundPeerId,
          mode: ticket.mode,
          burned: true,
        });
        sendJson(ws, {
          type: 'ticket:burned',
          ticketId,
          peerId: ticket.callerPeerId,
          mode: ticket.mode,
        });
        return;
      }

      if (type === 'ticket:reject') {
        const ticketId = msg.ticketId;
        if (!isValidString(ticketId, 128)) return;
        const ticket = tickets.get(ticketId);
        if (ticket && (ticket.calleePeerId === boundPeerId || ticket.callerPeerId === boundPeerId)) {
          tickets.delete(ticketId);
          const otherId =
            ticket.callerPeerId === boundPeerId ? ticket.calleePeerId : ticket.callerPeerId;
          sendJson(peers.get(otherId)?.ws, {
            type: 'ticket:rejected',
            ticketId,
          });
        }
        return;
      }

      if (type === 'rtc:signal') {
        const ticketId = msg.ticketId;
        const targetPeerId = msg.targetPeerId;
        const signal = msg.signal;
        if (!isValidString(ticketId, 128) || !isValidString(targetPeerId, 128) || !signal) {
          return;
        }

        const session = activeSessions.get(ticketId);
        if (!session) return;
        const isParticipant =
          (session.peerA === boundPeerId && session.peerB === targetPeerId) ||
          (session.peerB === boundPeerId && session.peerA === targetPeerId);
        if (!isParticipant) return;

        const targetConn = peers.get(targetPeerId);
        sendJson(targetConn?.ws, {
          type: 'rtc:signal',
          ticketId,
          fromPeerId: boundPeerId,
          signal,
        });
        return;
      }

      if (type === 'session:end') {
        const ticketId = msg.ticketId;
        const targetPeerId = msg.targetPeerId;
        if (isValidString(ticketId, 128)) {
          const session = activeSessions.get(ticketId);
          if (session && (session.peerA === boundPeerId || session.peerB === boundPeerId)) {
            activeSessions.delete(ticketId);
            const otherPeerId = session.peerA === boundPeerId ? session.peerB : session.peerA;
            sendJson(peers.get(otherPeerId)?.ws, {
              type: 'session:ended',
              ticketId,
              byPeerId: boundPeerId,
            });
          }
          tickets.delete(ticketId);
        } else if (isValidString(targetPeerId, 128)) {
          sendJson(peers.get(targetPeerId)?.ws, {
            type: 'session:ended',
            byPeerId: boundPeerId,
          });
        }
      }
    });

    ws.on('close', () => {
      if (boundPeerId) {
        const current = peers.get(boundPeerId);
        if (current && current.ws === ws) {
          peers.delete(boundPeerId);
          broadcastPresenceToSubscribers(boundPeerId, false);
        }
      }
    });
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`SafeMess server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start SafeMess server:', err);
  process.exit(1);
});

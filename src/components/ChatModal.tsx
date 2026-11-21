import {useEffect, useRef, useState, type FormEvent} from 'react';
import {CheckCheck, Send, ShieldAlert, ShieldCheck, Trash2} from 'lucide-react';
import {decryptAesGcm, deriveSharedAesKey, encryptAesGcm} from '../lib/crypto';
import type {SafeMessSignalingClient, SignalingEvent} from '../lib/signaling';
import type {
  ActiveSession,
  AsymmetricChatMessage,
  SafeMessIdentity,
} from '../types/safemess';

interface ChatModalProps {
  session: ActiveSession;
  identity: SafeMessIdentity;
  signaling: SafeMessSignalingClient;
  onRamWipeExit: (reason?: string) => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{urls: 'stun:stun.l.google.com:19302'}],
};

export function ChatModal({
  session,
  identity,
  signaling,
  onRamWipeExit,
}: ChatModalProps) {
  const [messages, setMessages] = useState<AsymmetricChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [channelReady, setChannelReady] = useState(false);
  const [aesReady, setAesReady] = useState(false);
  const [privacyShielded, setPrivacyShielded] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const sharedKeyRef = useRef<CryptoKey | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  const contactLabel = session.contact.relationLabel || session.contact.displayName;

  // Screen-capture / tab-blur privacy guard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') setPrivacyShielded(true);
    };
    const onVisibility = () => {
      if (document.hidden) setPrivacyShielded(true);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Scroll to newest incoming/outgoing item
  useEffect(() => {
    listEndRef.current?.scrollIntoView({behavior: 'smooth'});
  }, [messages.length]);

  // 3-second Asymmetric Text countdown: auto-scrub outgoing plaintext in RAM
  useEffect(() => {
    const timer = window.setInterval(() => {
      setMessages((prev) => {
        let changed = false;
        const next = prev.map((m) => {
          if (m.direction === 'outgoing' && !m.hiddenAfterSend) {
            changed = true;
            if (m.countdownSeconds <= 1) {
              return {
                ...m,
                text: null,
                hiddenAfterSend: true,
                countdownSeconds: 0,
              };
            }
            return {
              ...m,
              countdownSeconds: m.countdownSeconds - 1,
            };
          }
          return m;
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const performRamWipe = () => {
    setMessages((prev) => {
      prev.forEach((m) => {
        m.text = null;
      });
      return [];
    });
    setDraft('');
    sharedKeyRef.current = null;
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
  };

  const handleIncomingEncryptedPayload = async (payload: {iv: string; ct: string}) => {
    if (!sharedKeyRef.current) return;
    try {
      const plaintext = await decryptAesGcm(sharedKeyRef.current, payload);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          direction: 'incoming',
          senderName: contactLabel,
          text: plaintext,
          hiddenAfterSend: false,
          countdownSeconds: 0,
          timestamp: Date.now(),
        },
      ]);
    } catch {
      // ignore corrupted or unauthenticated ciphertexts
    }
  };

  useEffect(() => {
    let cancelled = false;

    const setupChannelEvents = (dc: RTCDataChannel) => {
      dcRef.current = dc;
      dc.onopen = () => setChannelReady(true);
      dc.onclose = () => setChannelReady(false);
      dc.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data as string) as {iv: string; ct: string};
          void handleIncomingEncryptedPayload(parsed);
        } catch {
          // ignore
        }
      };
    };

    const init = async () => {
      const derivedKey = await deriveSharedAesKey(
        identity.privateKeyJwk,
        session.contact.publicKeyJwk
      );
      if (cancelled) return;
      sharedKeyRef.current = derivedKey;
      setAesReady(true);

      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcRef.current = pc;

      pc.onicecandidate = (evt) => {
        if (evt.candidate) {
          signaling.sendRtcSignal(session.ticketId, session.contact.peerId, {
            kind: 'ice',
            candidate: evt.candidate.toJSON(),
          });
        }
      };

      pc.ondatachannel = (evt) => {
        setupChannelEvents(evt.channel);
      };

      if (session.isInitiator) {
        const dc = pc.createDataChannel('safemess-e2ee-chat', {ordered: true});
        setupChannelEvents(dc);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        signaling.sendRtcSignal(session.ticketId, session.contact.peerId, {
          kind: 'offer',
          sdp: pc.localDescription,
        });
      }
    };

    void init();

    const unsub = signaling.onEvent((evt: SignalingEvent) => {
      const pc = pcRef.current;
      if (evt.type === 'session:ended' && evt.byPeerId === session.contact.peerId) {
        performRamWipe();
        onRamWipeExit('Phiên nhắn tin đã đóng — Dữ liệu RAM đã được xóa sạch.');
        return;
      }

      if (evt.type !== 'rtc:signal' || evt.ticketId !== session.ticketId) return;
      const sig = evt.signal as
        | {kind: 'offer'; sdp: RTCSessionDescriptionInit}
        | {kind: 'answer'; sdp: RTCSessionDescriptionInit}
        | {kind: 'ice'; candidate: RTCIceCandidateInit}
        | {kind: 'e2ee-msg'; payload: {iv: string; ct: string}};

      if (sig.kind === 'e2ee-msg') {
        void handleIncomingEncryptedPayload(sig.payload);
        return;
      }

      if (!pc) return;
      void (async () => {
        if (sig.kind === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(sig.sdp));
          for (const c of pendingCandidatesRef.current) {
            await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
          }
          pendingCandidatesRef.current = [];
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          signaling.sendRtcSignal(session.ticketId, session.contact.peerId, {
            kind: 'answer',
            sdp: pc.localDescription,
          });
        } else if (sig.kind === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(sig.sdp));
          for (const c of pendingCandidatesRef.current) {
            await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
          }
          pendingCandidatesRef.current = [];
        } else if (sig.kind === 'ice') {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(sig.candidate)).catch(() => {});
          } else {
            pendingCandidatesRef.current.push(sig.candidate);
          }
        }
      })();
    });

    return () => {
      cancelled = true;
      unsub();
      performRamWipe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.ticketId]);

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !sharedKeyRef.current) return;

    const encrypted = await encryptAesGcm(sharedKeyRef.current, text);
    const dc = dcRef.current;

    if (dc && dc.readyState === 'open') {
      dc.send(JSON.stringify(encrypted));
    } else {
      // Encrypted E2EE fallback over ephemeral session relay if DataChannel NAT traversal is still negotiating
      signaling.sendRtcSignal(session.ticketId, session.contact.peerId, {
        kind: 'e2ee-msg',
        payload: encrypted,
      });
    }

    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        direction: 'outgoing',
        senderName: identity.displayName,
        text,
        hiddenAfterSend: false,
        countdownSeconds: 3,
        timestamp: Date.now(),
      },
    ]);
    setDraft('');
  };

  const handleWipeAndClose = () => {
    signaling.endSession(session.ticketId, session.contact.peerId);
    performRamWipe();
    onRamWipeExit('Đã xóa sạch toàn bộ tin nhắn trên RAM và thoát phiên.');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#F5F7FB] flex flex-col"
      role="dialog"
      aria-modal="true"
    >
      {/* Top Bar */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 h-16 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-bold text-slate-900 truncate">
              Chat với {contactLabel}
            </h1>
            <p className="text-xs text-slate-500 font-mono tabular-nums truncate">
              {channelReady
                ? 'P2P DataChannel E2EE'
                : aesReady
                  ? 'Mã hóa AES-256-GCM sẵn sàng'
                  : 'Đang tạo khóa phiên...'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleWipeAndClose}
          className="min-h-[44px] px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
        >
          <Trash2 className="w-4 h-4" />
          <span>Xóa & Thoát</span>
        </button>
      </header>

      {/* Warning Banner */}
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-center text-xs sm:text-sm font-medium text-amber-900">
        Tin nhắn gửi đi tự ẩn sau 3 giây. Toàn bộ nội dung tự hủy sạch khỏi RAM khi đóng khung.
      </div>

      {/* Messages Feed */}
      <main className="relative flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <p className="text-base font-semibold text-slate-700">
                Phiên nhắn tin một chiều đã sẵn sàng
              </p>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                Tin nhắn của bạn sẽ hiển thị đầy đủ trên máy {contactLabel}, và tự động chuyển thành nhãn đã ẩn trên máy bạn sau 3 giây.
              </p>
            </div>
          ) : (
            messages.map((msg) => {
              if (msg.direction === 'incoming') {
                return (
                  <div key={msg.id} className="flex justify-start">
                    <div className="max-w-[85%] sm:max-w-[75%] bg-white border border-slate-200 rounded-3xl rounded-tl-md px-5 py-3.5 shadow-xs space-y-1">
                      <p className="text-xs font-semibold text-blue-700">
                        {msg.senderName}
                        <span aria-hidden="true" className="mx-1.5 text-slate-300">
                          ·
                        </span>
                        <span className="font-normal text-slate-400 tabular-nums">
                          {new Date(msg.timestamp).toLocaleTimeString('vi-VN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </p>
                      <p className="text-base sm:text-lg text-slate-900 leading-relaxed break-words">
                        {msg.text}
                      </p>
                    </div>
                  </div>
                );
              }

              return (
                <div key={msg.id} className="flex justify-end">
                  <div
                    className={`max-w-[85%] sm:max-w-[75%] rounded-3xl rounded-tr-md px-5 py-3.5 space-y-1 transition-colors ${
                      msg.hiddenAfterSend
                        ? 'bg-slate-200/80 text-slate-700 border border-slate-300/70'
                        : 'bg-blue-600 text-white shadow-xs'
                    }`}
                  >
                    {msg.hiddenAfterSend ? (
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <CheckCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                        <span>Đã gửi (Nội dung đã ẩn)</span>
                      </div>
                    ) : (
                      <>
                        <p className="text-base sm:text-lg leading-relaxed break-words">
                          {msg.text}
                        </p>
                        <p className="text-xs text-blue-100 tabular-nums">
                          Tự ẩn sau {msg.countdownSeconds}s...
                        </p>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={listEndRef} />
        </div>

        {/* Anti-Capture Privacy Curtain */}
        {privacyShielded && (
          <div className="fixed inset-0 z-30 bg-slate-950/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center text-white gap-4">
            <ShieldAlert className="w-12 h-12 text-amber-400" />
            <div className="space-y-1 max-w-md">
              <p className="text-lg font-bold">
                Nội dung tin nhắn đã được che để chống chụp màn hình
              </p>
              <p className="text-sm text-slate-300">
                Chạm nút bên dưới để tiếp tục cuộc trò chuyện bảo mật.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPrivacyShielded(false)}
              className="min-h-[48px] px-6 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-sm font-semibold text-white"
            >
              Mở lại khung chat
            </button>
          </div>
        )}
      </main>

      {/* Bottom Composer */}
      <footer className="bg-white border-t border-slate-200 p-3 sm:p-4 shrink-0">
        <form
          onSubmit={(e) => void handleSend(e)}
          className="max-w-3xl mx-auto flex items-center gap-2.5"
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Soạn tin nhắn bảo mật..."
            maxLength={1000}
            className="flex-1 min-w-0 h-12 sm:h-14 px-4 rounded-2xl border border-slate-300 bg-slate-50 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
          />
          <button
            type="submit"
            disabled={!draft.trim() || !aesReady}
            className="min-h-[48px] sm:min-h-[56px] px-5 sm:px-6 rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-base font-bold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="w-5 h-5" />
            <span>Gửi</span>
          </button>
        </form>
      </footer>
    </div>
  );
}

import {useEffect, useRef, useState} from 'react';
import {
  Headphones,
  Mic,
  MicOff,
  PhoneOff,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Video,
  VideoOff,
} from 'lucide-react';
import type {SafeMessSignalingClient, SignalingEvent} from '../lib/signaling';
import {VoiceMaskingEngine} from '../lib/voiceDsp';
import type {
  ActiveSession,
  SafeMessIdentity,
  VoicePreset,
} from '../types/safemess';

interface CallModalProps {
  session: ActiveSession;
  identity: SafeMessIdentity;
  signaling: SafeMessSignalingClient;
  onRamWipeExit: (reason?: string) => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{urls: 'stun:stun.l.google.com:19302'}],
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function CallModal({
  session,
  identity,
  signaling,
  onRamWipeExit,
}: CallModalProps) {
  const [videoEnabled, setVideoEnabled] = useState(session.mode === 'video');
  const [micMuted, setMicMuted] = useState(false);
  const [voicePreset, setVoicePreset] = useState<VoicePreset>('deep');
  const [monitorVoice, setMonitorVoice] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [connectionState, setConnectionState] = useState<string>('Đang bắt tay P2P...');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [privacyShielded, setPrivacyShielded] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  // Dynamic moving watermark coordinates (%)
  const [watermarkPos, setWatermarkPos] = useState({top: 16, left: 12});

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dspRef = useRef<VoiceMaskingEngine | null>(null);
  const rawMicStreamRef = useRef<MediaStream | null>(null);
  const maskedAudioStreamRef = useRef<MediaStream | null>(null);
  const localVideoStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const videoSenderRef = useRef<RTCRtpSender | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  const contactLabel = session.contact.relationLabel || session.contact.displayName;

  // Dynamic moving watermark timer
  useEffect(() => {
    if (!videoEnabled) return;
    const timer = window.setInterval(() => {
      const top = Math.floor(10 + Math.random() * 68);
      const left = Math.floor(8 + Math.random() * 52);
      setWatermarkPos({top, left});
    }, 3400);
    return () => clearInterval(timer);
  }, [videoEnabled]);

  // Screen-capture / PrintScreen & tab-hide privacy shield
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') {
        setPrivacyShielded(true);
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        setPrivacyShielded(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Call duration timer once connected
  useEffect(() => {
    if (connectionState !== 'Đã kết nối P2P (Mã hóa E2EE)') return;
    const id = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [connectionState]);

  const cleanupMediaAndRtc = () => {
    dspRef.current?.stop();
    dspRef.current = null;

    rawMicStreamRef.current?.getTracks().forEach((t) => t.stop());
    rawMicStreamRef.current = null;

    maskedAudioStreamRef.current?.getTracks().forEach((t) => t.stop());
    maskedAudioStreamRef.current = null;

    localVideoStreamRef.current?.getTracks().forEach((t) => t.stop());
    localVideoStreamRef.current = null;

    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    videoSenderRef.current = null;
  };

  // Initialize Always-On Voice Masking DSP + RTCPeerConnection
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
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

      pc.ontrack = (evt) => {
        const stream = evt.streams[0] || new MediaStream([evt.track]);
        if (evt.track.kind === 'audio' && remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
          void remoteAudioRef.current.play().catch(() => {});
        }
        if (evt.track.kind === 'video') {
          setHasRemoteVideo(true);
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = stream;
            void remoteVideoRef.current.play().catch(() => {});
          }
        }
        evt.track.onended = () => {
          if (evt.track.kind === 'video') {
            setHasRemoteVideo(false);
          }
        };
      };

      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'connected') {
          setConnectionState('Đã kết nối P2P (Mã hóa E2EE)');
        } else if (st === 'connecting') {
          setConnectionState('Đang thiết lập kết nối P2P...');
        } else if (st === 'failed' || st === 'disconnected') {
          setConnectionState('Kết nối P2P bị gián đoạn');
        }
      };

      // Acquire microphone & feed through Always-On Voice Masking DSP
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        if (cancelled) {
          micStream.getTracks().forEach((t) => t.stop());
          return;
        }
        rawMicStreamRef.current = micStream;
        const dsp = new VoiceMaskingEngine();
        dspRef.current = dsp;
        const maskedStream = await dsp.start(micStream, 'deep', setMicLevel);
        maskedAudioStreamRef.current = maskedStream;
        maskedStream.getAudioTracks().forEach((track) => {
          pc.addTrack(track, maskedStream);
        });
      } catch {
        setMediaError('Không thể mở micro. Vui lòng cấp quyền micro để truyền thoại bảo mật.');
      }

      // If starting directly in Video mode, attach camera
      if (session.mode === 'video') {
        try {
          const camStream = await navigator.mediaDevices.getUserMedia({
            video: {facingMode: 'user', width: {ideal: 1280}, height: {ideal: 720}},
            audio: false,
          });
          if (cancelled) {
            camStream.getTracks().forEach((t) => t.stop());
            return;
          }
          localVideoStreamRef.current = camStream;
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = camStream;
          }
          const vTrack = camStream.getVideoTracks()[0];
          if (vTrack) {
            videoSenderRef.current = pc.addTrack(vTrack, camStream);
          }
        } catch {
          setMediaError('Không thể mở camera. Phiên vẫn giữ bảo mật thoại.');
          setVideoEnabled(false);
        }
      }

      if (session.isInitiator && !cancelled) {
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
        cleanupMediaAndRtc();
        onRamWipeExit('Người thân đã ngắt gọi — Đã xóa sạch bộ nhớ RAM.');
        return;
      }

      if (evt.type !== 'rtc:signal' || evt.ticketId !== session.ticketId || !pc) return;
      const sig = evt.signal as
        | {kind: 'offer'; sdp: RTCSessionDescriptionInit}
        | {kind: 'answer'; sdp: RTCSessionDescriptionInit}
        | {kind: 'ice'; candidate: RTCIceCandidateInit}
        | {kind: 'video-state'; enabled: boolean};

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
        } else if (sig.kind === 'video-state') {
          setHasRemoteVideo(sig.enabled);
        }
      })();
    });

    return () => {
      cancelled = true;
      unsub();
      cleanupMediaAndRtc();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.ticketId]);

  const handlePresetChange = (preset: VoicePreset) => {
    setVoicePreset(preset);
    dspRef.current?.setPreset(preset);
  };

  const handleToggleMonitor = () => {
    const next = !monitorVoice;
    setMonitorVoice(next);
    dspRef.current?.setLocalMonitor(next);
  };

  const handleToggleMic = () => {
    const next = !micMuted;
    setMicMuted(next);
    rawMicStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
  };

  const renegotiate = async () => {
    const pc = pcRef.current;
    if (!pc) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    signaling.sendRtcSignal(session.ticketId, session.contact.peerId, {
      kind: 'offer',
      sdp: pc.localDescription,
    });
  };

  const handleToggleCamera = async () => {
    const pc = pcRef.current;
    if (!pc) return;

    if (videoEnabled) {
      localVideoStreamRef.current?.getTracks().forEach((t) => t.stop());
      localVideoStreamRef.current = null;
      if (videoSenderRef.current) {
        try {
          pc.removeTrack(videoSenderRef.current);
        } catch {
          // ignore
        }
        videoSenderRef.current = null;
      }
      setVideoEnabled(false);
      signaling.sendRtcSignal(session.ticketId, session.contact.peerId, {
        kind: 'video-state',
        enabled: false,
      });
      await renegotiate();
    } else {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({
          video: {facingMode, width: {ideal: 1280}, height: {ideal: 720}},
          audio: false,
        });
        localVideoStreamRef.current = camStream;
        setVideoEnabled(true);
        window.setTimeout(() => {
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = camStream;
          }
        }, 40);
        const vTrack = camStream.getVideoTracks()[0];
        if (vTrack) {
          videoSenderRef.current = pc.addTrack(vTrack, camStream);
        }
        signaling.sendRtcSignal(session.ticketId, session.contact.peerId, {
          kind: 'video-state',
          enabled: true,
        });
        await renegotiate();
      } catch {
        setMediaError('Không thể bật camera trên thiết bị này.');
      }
    }
  };

  const handleSwitchCamera = async () => {
    if (!videoEnabled || !pcRef.current) return;
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextFacing);

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: nextFacing, width: {ideal: 1280}, height: {ideal: 720}},
        audio: false,
      });
      const newTrack = newStream.getVideoTracks()[0];
      if (newTrack && videoSenderRef.current) {
        await videoSenderRef.current.replaceTrack(newTrack);
      }
      localVideoStreamRef.current?.getTracks().forEach((t) => t.stop());
      localVideoStreamRef.current = newStream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = newStream;
      }
    } catch {
      setMediaError('Thiết bị chỉ có một camera khả dụng.');
    }
  };

  const handleHangup = () => {
    signaling.endSession(session.ticketId, session.contact.peerId);
    cleanupMediaAndRtc();
    onRamWipeExit('Đã ngắt cuộc gọi và xóa sạch bộ nhớ RAM.');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950 text-white flex flex-col justify-between p-4 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      {/* Hidden Remote Audio Element */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      {/* Top Status Bar */}
      <header className="max-w-4xl w-full mx-auto flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-bold tracking-tight truncate">
              {videoEnabled ? 'SafeMess · Video bảo mật P2P' : 'SafeMess · Thoại bảo mật P2P'}
            </h1>
            <p className="text-xs text-slate-400 font-mono tabular-nums truncate">
              {connectionState} · Khóa {session.contact.fingerprint}
            </p>
          </div>
        </div>

        <div className="text-right">
          <span className="text-lg font-mono font-semibold text-emerald-400 tabular-nums">
            {formatDuration(elapsedSeconds)}
          </span>
        </div>
      </header>

      {/* Center Stage: Voice or Video Viewport */}
      <main className="max-w-4xl w-full mx-auto flex-1 flex flex-col items-center justify-center py-5 gap-6">
        {mediaError && (
          <div className="w-full max-w-xl p-3.5 rounded-2xl bg-amber-500/15 border border-amber-400/30 text-sm text-amber-200 text-center">
            {mediaError}
          </div>
        )}

        {videoEnabled ? (
          <div className="relative w-full max-w-3xl aspect-video rounded-3xl overflow-hidden bg-slate-900 border border-slate-800 shadow-2xl">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />

            {!hasRemoteVideo && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400 p-6 text-center">
                <div className="w-20 h-20 rounded-3xl bg-slate-800 text-slate-200 flex items-center justify-center text-2xl font-bold">
                  {contactLabel.slice(0, 2).toUpperCase()}
                </div>
                <p className="text-lg font-semibold text-white">{contactLabel}</p>
                <p className="text-sm text-slate-400">
                  Đang chờ luồng hình ảnh từ thiết bị của {contactLabel}...
                </p>
              </div>
            )}

            {/* Dynamic Moving Watermark Overlay */}
            <div
              style={{
                top: `${watermarkPos.top}%`,
                left: `${watermarkPos.left}%`,
              }}
              className="absolute pointer-events-none select-none transition-all duration-700 ease-out px-3 py-1.5 rounded-lg bg-black/45 backdrop-blur-xs text-[11px] sm:text-xs font-mono text-white/80 tracking-wide"
            >
              SafeMess · ĐANG XEM: {identity.displayName} ({identity.fingerprint})
            </div>

            {/* Local Camera PiP */}
            <div className="absolute bottom-3 right-3 w-28 sm:w-40 aspect-video rounded-2xl overflow-hidden border border-slate-700 bg-slate-950 shadow-lg">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
              />
            </div>

            {/* Anti-Capture Privacy Curtain */}
            {privacyShielded && (
              <div className="absolute inset-0 z-20 bg-black flex flex-col items-center justify-center p-6 text-center gap-4">
                <ShieldAlert className="w-12 h-12 text-amber-400" />
                <div className="space-y-1">
                  <p className="text-lg font-bold text-white">
                    Chế độ chống quay/chụp màn hình đang kích hoạt
                  </p>
                  <p className="text-sm text-slate-300">
                    Hình ảnh đã được làm đen tạm thời khi rời cửa sổ hoặc bấm chụp màn hình.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPrivacyShielded(false)}
                  className="min-h-[44px] px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-sm font-semibold text-white"
                >
                  Tiếp tục xem an toàn
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="w-full max-w-md text-center space-y-6 py-4">
            <div className="relative w-32 h-32 mx-auto">
              <div
                className="absolute inset-0 rounded-full bg-blue-500/20 transition-transform duration-100"
                style={{transform: `scale(${1 + micLevel * 0.45})`}}
              />
              <div className="relative w-32 h-32 rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center text-4xl font-bold text-white shadow-xl">
                {contactLabel.slice(0, 2).toUpperCase()}
              </div>
            </div>

            <div className="space-y-1">
              <h2 className="text-2xl sm:text-3xl font-bold text-white">{contactLabel}</h2>
              <p className="text-sm text-slate-300">
                Thẻ phiên dùng 1 lần đã hủy sau bắt tay · Giọng thật được che hoàn toàn
              </p>
            </div>
          </div>
        )}

        {/* Always-On Voice Masking Selector (No Off Button) */}
        <section
          aria-label="Chọn kiểu giọng nói bảo mật luôn bật"
          className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-5 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs sm:text-sm font-semibold text-slate-300">
              Chọn kiểu giọng nói bảo mật (Luôn bật)
            </p>
            <button
              type="button"
              onClick={handleToggleMonitor}
              className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                monitorVoice
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Headphones className="w-3.5 h-3.5" />
              <span>{monitorVoice ? 'Đang nghe thử giọng' : 'Nghe thử giọng DSP'}</span>
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {(
              [
                {id: 'deep', label: '🐻 Giọng Trầm', hint: 'Mặc định'},
                {id: 'cartoon', label: '🤡 Hoạt Hình', hint: 'Tông cao'},
                {id: 'robot', label: '🤖 Robot', hint: 'Biến điệu'},
              ] as const
            ).map((item) => {
              const active = voicePreset === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handlePresetChange(item.id)}
                  className={`min-h-[54px] px-3 py-2.5 rounded-2xl border text-center transition-all ${
                    active
                      ? 'bg-blue-600 border-blue-400 text-white shadow-sm'
                      : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <div className="text-sm sm:text-[15px] font-bold whitespace-nowrap">
                    {item.label}
                  </div>
                  <div
                    className={`text-[11px] mt-0.5 ${
                      active ? 'text-blue-100' : 'text-slate-500'
                    }`}
                  >
                    {item.hint}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </main>

      {/* Bottom Primary Call Controls */}
      <footer className="max-w-xl w-full mx-auto pt-4 border-t border-slate-800 grid grid-cols-3 gap-3">
        {videoEnabled ? (
          <button
            type="button"
            onClick={() => void handleSwitchCamera()}
            className="min-h-[56px] px-3 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white text-sm sm:text-base font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
          >
            <RefreshCw className="w-5 h-5 shrink-0" />
            <span>Đổi Cam</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleToggleMic}
            className={`min-h-[56px] px-3 py-3 rounded-2xl text-sm sm:text-base font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap ${
              micMuted
                ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                : 'bg-slate-800 hover:bg-slate-700 text-white'
            }`}
          >
            {micMuted ? <MicOff className="w-5 h-5 shrink-0" /> : <Mic className="w-5 h-5 shrink-0" />}
            <span>{micMuted ? 'Đã tắt Mic' : 'Tắt Mic'}</span>
          </button>
        )}

        <button
          type="button"
          onClick={handleHangup}
          className="min-h-[56px] px-3 py-3 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white text-sm sm:text-base font-bold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
        >
          <PhoneOff className="w-5 h-5 shrink-0" />
          <span>Ngắt gọi</span>
        </button>

        <button
          type="button"
          onClick={() => void handleToggleCamera()}
          className="min-h-[56px] px-3 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white text-sm sm:text-base font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
        >
          {videoEnabled ? (
            <>
              <VideoOff className="w-5 h-5 shrink-0" />
              <span>Tắt Camera</span>
            </>
          ) : (
            <>
              <Video className="w-5 h-5 shrink-0" />
              <span>Bật Camera</span>
            </>
          )}
        </button>
      </footer>
    </div>
  );
}

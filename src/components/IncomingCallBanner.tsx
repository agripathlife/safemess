import {useEffect} from 'react';
import {BellRing, MessageSquare, Phone, PhoneOff, ShieldCheck, Video} from 'lucide-react';
import {startRingTone, stopRingTone} from '../lib/voiceDsp';
import type {IncomingCallInvite} from '../types/safemess';

interface IncomingCallBannerProps {
  invite: IncomingCallInvite | null;
  onAccept: (invite: IncomingCallInvite) => void;
  onReject: (invite: IncomingCallInvite) => void;
}

export function IncomingCallBanner({
  invite,
  onAccept,
  onReject,
}: IncomingCallBannerProps) {
  useEffect(() => {
    if (!invite) {
      stopRingTone();
      return;
    }
    startRingTone(invite.mode === 'emergency');
    return () => {
      stopRingTone();
    };
  }, [invite]);

  if (!invite) return null;

  const isEmergency = invite.mode === 'emergency';
  const modeLabel =
    invite.mode === 'emergency'
      ? 'CUỘC GỌI KHẨN CẤP P2P'
      : invite.mode === 'video'
        ? 'Cuộc gọi Video P2P'
        : invite.mode === 'chat'
          ? 'Lời mời Nhắn tin một chiều'
          : 'Cuộc gọi Thoại P2P';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-full max-w-md rounded-3xl border shadow-2xl p-7 space-y-6 ${
          isEmergency
            ? 'bg-rose-950 border-rose-500 text-white'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        <div className="flex items-center gap-4">
          <div
            className={`w-16 h-16 rounded-2xl flex items-center justify-center shrink-0 ${
              isEmergency ? 'bg-rose-600 text-white' : 'bg-blue-600 text-white'
            }`}
          >
            {isEmergency ? (
              <BellRing className="w-8 h-8" />
            ) : invite.mode === 'video' ? (
              <Video className="w-8 h-8" />
            ) : invite.mode === 'chat' ? (
              <MessageSquare className="w-8 h-8" />
            ) : (
              <Phone className="w-8 h-8" />
            )}
          </div>

          <div className="min-w-0">
            <p
              className={`text-xs font-bold tracking-wide ${
                isEmergency ? 'text-rose-200' : 'text-blue-700'
              }`}
            >
              {modeLabel}
            </p>
            <h2 className="text-2xl font-bold truncate mt-0.5">
              {invite.verifiedContact.relationLabel || invite.verifiedContact.displayName}
            </h2>
            <p
              className={`text-xs font-mono tabular-nums mt-1 inline-flex items-center gap-1.5 ${
                isEmergency ? 'text-rose-100' : 'text-slate-600'
              }`}
            >
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>Đã khớp khóa · {invite.verifiedContact.fingerprint}</span>
            </p>
          </div>
        </div>

        <p className={`text-sm leading-relaxed ${isEmergency ? 'text-rose-100' : 'text-slate-600'}`}>
          Mã liên lạc dùng 1 lần đã được cấp cho phiên này và sẽ tự hủy ngay khi bạn chấp nhận kết nối.
        </p>

        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            onClick={() => onReject(invite)}
            className={`min-h-[54px] px-4 py-3 rounded-2xl font-semibold text-base inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap ${
              isEmergency
                ? 'bg-rose-900 hover:bg-rose-800 text-white border border-rose-700'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
            }`}
          >
            <PhoneOff className="w-5 h-5" />
            <span>Từ chối</span>
          </button>

          <button
            type="button"
            onClick={() => onAccept(invite)}
            className="min-h-[54px] px-4 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-base inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
          >
            <Phone className="w-5 h-5" />
            <span>{invite.mode === 'chat' ? 'Mở Chat' : 'Nghe ngay'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

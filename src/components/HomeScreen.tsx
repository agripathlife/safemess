import {
  BellRing,
  Lock,
  LogOut,
  MessageSquare,
  Phone,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  Video,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type {SafeMessIdentity, SessionMode, TrustedContact} from '../types/safemess';
import {BrandMark} from './BrandMark';

interface HomeScreenProps {
  identity: SafeMessIdentity;
  contacts: TrustedContact[];
  presenceMap: Record<string, boolean>;
  wsConnected: boolean;
  driveSyncedAt: number | null;
  pendingStatusMessage: string | null;
  onOpenAddMember: () => void;
  onStartSession: (contact: TrustedContact, mode: SessionMode) => void;
  onRequestRemoveContact: (contact: TrustedContact) => void;
  onLockApp: () => void;
  onSignOut: () => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function HomeScreen({
  identity,
  contacts,
  presenceMap,
  wsConnected,
  driveSyncedAt,
  pendingStatusMessage,
  onOpenAddMember,
  onStartSession,
  onRequestRemoveContact,
  onLockApp,
  onSignOut,
}: HomeScreenProps) {
  return (
    <div className="min-h-screen bg-[#F5F7FB] flex flex-col">
      {/* 3-Zone Top Bar */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4 sm:gap-8">
          {/* Zone 1: Brand */}
          <div className="flex items-center gap-3 shrink-0">
            <BrandMark size="sm" />
            <span className="text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap">
              SafeMess
            </span>
          </div>

          {/* Zone 2: Quiet Live Status */}
          <div className="hidden md:flex items-center gap-3 text-sm text-slate-600 min-w-0">
            {wsConnected ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium whitespace-nowrap">
                <Wifi className="w-4 h-4" />
                <span>P2P Sẵn sàng</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-amber-700 font-medium whitespace-nowrap">
                <WifiOff className="w-4 h-4" />
                <span>Đang kết nối tín hiệu</span>
              </span>
            )}
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
              {identity.fingerprint}
            </span>
          </div>

          {/* Zone 3: Primary Action + Lock/Exit */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onLockApp}
              className="min-h-[44px] min-w-[44px] px-3 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 inline-flex items-center justify-center gap-1.5 text-sm font-medium transition-colors whitespace-nowrap"
              title="Khóa ứng dụng"
              aria-label="Khóa ứng dụng"
            >
              <Lock className="w-4 h-4" />
              <span className="hidden sm:inline">Khóa</span>
            </button>

            <button
              type="button"
              onClick={onSignOut}
              className="min-h-[44px] min-w-[44px] px-3 rounded-xl text-slate-600 hover:text-rose-700 hover:bg-rose-50 inline-flex items-center justify-center gap-1.5 text-sm font-medium transition-colors whitespace-nowrap"
              title="Đăng xuất"
              aria-label="Đăng xuất"
            >
              <LogOut className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onOpenAddMember}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Thêm</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        {/* Identity Summary Strip */}
        <section className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Vòng tròn tin cậy của {identity.displayName}</span>
            </div>
            <p className="text-sm text-slate-600">
              {wsConnected ? 'An toàn — Sẵn sàng gọi và nhắn tin P2P' : 'Đang thiết lập kênh tín hiệu P2P...'}
              {driveSyncedAt ? (
                <>
                  <span aria-hidden="true" className="mx-2 text-slate-300">
                    ·
                  </span>
                  <span>
                    Đồng bộ Drive lúc{' '}
                    {new Date(driveSyncedAt).toLocaleTimeString('vi-VN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </>
              ) : null}
            </p>
          </div>

          <div className="text-xs font-mono text-slate-600 tabular-nums md:hidden">
            Khóa của bạn: {identity.fingerprint}
          </div>
        </section>

        {pendingStatusMessage && (
          <div
            role="status"
            className="p-4 rounded-2xl bg-blue-50 border border-blue-200 text-sm font-medium text-blue-900"
          >
            {pendingStatusMessage}
          </div>
        )}

        {/* Trusted Circle Family Cards */}
        {contacts.length === 0 ? (
          <section className="bg-white rounded-3xl border border-slate-200 p-8 sm:p-12 text-center space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 mx-auto flex items-center justify-center">
              <UserPlus className="w-8 h-8" />
            </div>
            <div className="space-y-2 max-w-md mx-auto">
              <h1 className="text-xl font-bold text-slate-900">
                Chưa có người thân trong Vòng tròn tin cậy
              </h1>
              <p className="text-[15px] text-slate-600 leading-relaxed">
                Quét mã QR một lần duy nhất với Bố, Mẹ hoặc người thân để bắt đầu liên lạc P2P bảo mật. Mọi cuộc gọi từ người lạ sẽ bị chặn hoàn toàn.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenAddMember}
              className="min-h-[52px] px-6 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              <Plus className="w-5 h-5" />
              <span>Thêm thành viên qua mã QR</span>
            </button>
          </section>
        ) : (
          <section
            aria-label="Danh sách thành viên gia đình"
            className="grid grid-cols-1 lg:grid-cols-2 gap-5"
          >
            {contacts.map((contact) => {
              const online = Boolean(presenceMap[contact.peerId]);
              const label = contact.relationLabel || contact.displayName;
              const subName = contact.relationLabel ? contact.displayName : null;

              return (
                <article
                  key={contact.peerId}
                  className="bg-white rounded-3xl border border-slate-200 p-6 flex flex-col justify-between gap-6 shadow-xs"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <div
                        className={`w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold shrink-0 ${
                          online
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {getInitials(label)}
                      </div>

                      <div className="min-w-0">
                        <h2 className="text-xl font-bold text-slate-900 truncate">
                          {label}
                        </h2>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm mt-1">
                          <span
                            className={`font-semibold ${
                              online ? 'text-emerald-700' : 'text-slate-500'
                            }`}
                          >
                            {online ? 'Đang online' : 'Ngoại tuyến'}
                          </span>
                          {subName && (
                            <>
                              <span aria-hidden="true" className="text-slate-300">
                                ·
                              </span>
                              <span className="text-slate-600 truncate">{subName}</span>
                            </>
                          )}
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span className="font-mono text-xs text-slate-500 tabular-nums">
                            {contact.fingerprint}
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onRequestRemoveContact(contact)}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0"
                      title={`Xóa ${label} khỏi Vòng tròn tin cậy`}
                      aria-label={`Xóa ${label}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* 3 Independent One-Touch Action Buttons */}
                  <div className="grid grid-cols-3 gap-2.5">
                    {online ? (
                      <button
                        type="button"
                        onClick={() => onStartSession(contact, 'voice')}
                        className="min-h-[54px] px-3 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white text-sm sm:text-[15px] font-bold inline-flex items-center justify-center gap-1.5 transition-all whitespace-nowrap"
                      >
                        <Phone className="w-4 h-4 shrink-0" />
                        <span>Thoại</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onStartSession(contact, 'emergency')}
                        className="min-h-[54px] px-3 py-3 rounded-2xl bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white text-sm sm:text-[15px] font-bold inline-flex items-center justify-center gap-1.5 transition-all whitespace-nowrap"
                      >
                        <BellRing className="w-4 h-4 shrink-0" />
                        <span>Khẩn</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={!online}
                      onClick={() => onStartSession(contact, 'video')}
                      className="min-h-[54px] px-3 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-100 disabled:text-slate-400 active:scale-[0.98] text-white text-sm sm:text-[15px] font-bold inline-flex items-center justify-center gap-1.5 transition-all whitespace-nowrap"
                    >
                      <Video className="w-4 h-4 shrink-0" />
                      <span>Camera</span>
                    </button>

                    <button
                      type="button"
                      disabled={!online}
                      onClick={() => onStartSession(contact, 'chat')}
                      className="min-h-[54px] px-3 py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-100 disabled:text-slate-400 active:scale-[0.98] text-white text-sm sm:text-[15px] font-bold inline-flex items-center justify-center gap-1.5 transition-all whitespace-nowrap"
                    >
                      <MessageSquare className="w-4 h-4 shrink-0" />
                      <span>Nhắn tin</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </main>
    </div>
  );
}

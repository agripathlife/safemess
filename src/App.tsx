import {useEffect, useRef, useState} from 'react';
import {PhoneOff} from 'lucide-react';
import {AddMemberModal} from './components/AddMemberModal';
import {BiometricLockScreen} from './components/BiometricLockScreen';
import {CallModal} from './components/CallModal';
import {ChatModal} from './components/ChatModal';
import {ConfirmDriveSyncDialog} from './components/ConfirmDriveSyncDialog';
import {HomeScreen} from './components/HomeScreen';
import {IncomingCallBanner} from './components/IncomingCallBanner';
import {WelcomeScreen} from './components/WelcomeScreen';
import {
  getAccessToken,
  googleSignIn,
  initAuth,
  loadVaultFromDrive,
  logout,
  saveVaultToDrive,
} from './lib/authDrive';
import {generateIdentity} from './lib/crypto';
import {SafeMessSignalingClient, type SignalingEvent} from './lib/signaling';
import type {
  ActiveSession,
  IncomingCallInvite,
  PinCredential,
  SafeMessVault,
  SessionMode,
  TrustedContact,
} from './types/safemess';

interface PendingDriveAction {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
  nextContacts: TrustedContact[];
}

interface OutgoingWaitState {
  ticketId: string | null;
  contact: TrustedContact;
  mode: SessionMode;
  queuedEmergency?: boolean;
}

export default function App() {
  const [needsAuth, setNeedsAuth] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [vault, setVault] = useState<SafeMessVault | null>(null);
  const [driveFileId, setDriveFileId] = useState<string | null>(null);
  const [driveSyncedAt, setDriveSyncedAt] = useState<number | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);

  const [wsConnected, setWsConnected] = useState(false);
  const [presenceMap, setPresenceMap] = useState<Record<string, boolean>>({});
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [pendingDriveAction, setPendingDriveAction] = useState<PendingDriveAction | null>(null);
  const [isSyncingDrive, setIsSyncingDrive] = useState(false);

  const [outgoingWait, setOutgoingWait] = useState<OutgoingWaitState | null>(null);
  const [incomingInvite, setIncomingInvite] = useState<IncomingCallInvite | null>(null);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const signalingRef = useRef<SafeMessSignalingClient | null>(null);
  const contactsRef = useRef<TrustedContact[]>([]);
  const outgoingWaitRef = useRef<OutgoingWaitState | null>(null);

  useEffect(() => {
    contactsRef.current = vault?.contacts ?? [];
  }, [vault?.contacts]);

  useEffect(() => {
    outgoingWaitRef.current = outgoingWait;
  }, [outgoingWait]);

  // Monitor auth state
  useEffect(() => {
    const unsub = initAuth(
      () => {
        setNeedsAuth(false);
      },
      () => {
        setNeedsAuth(true);
        setVault(null);
        setDriveFileId(null);
        setIsUnlocked(false);
        setActiveSession(null);
        setIncomingInvite(null);
        setOutgoingWait(null);
        signalingRef.current?.disconnect();
        signalingRef.current = null;
      }
    );
    return () => unsub();
  }, []);

  // Connect P2P signaling once unlocked
  useEffect(() => {
    if (!vault || !isUnlocked) {
      signalingRef.current?.disconnect();
      signalingRef.current = null;
      setWsConnected(false);
      return;
    }

    const client = new SafeMessSignalingClient();
    signalingRef.current = client;

    const unsub = client.onEvent((evt: SignalingEvent) => {
      if (evt.type === 'connected') {
        setWsConnected(true);
      } else if (evt.type === 'disconnected') {
        setWsConnected(false);
      } else if (evt.type === 'registered') {
        client.subscribePresence(contactsRef.current.map((c) => c.peerId));
      } else if (evt.type === 'presence:state') {
        setPresenceMap(evt.states);
      } else if (evt.type === 'presence:update') {
        setPresenceMap((prev) => ({...prev, [evt.peerId]: evt.online}));
      } else if (evt.type === 'call:incoming') {
        // Strict Trusted Circle Verification: reject unknown peers from protocol layer
        const matched = contactsRef.current.find(
          (c) =>
            c.peerId === evt.callerPeerId && c.fingerprint === evt.callerFingerprint
        );
        if (!matched) {
          client.rejectTicket(evt.ticketId);
          return;
        }
        setIncomingInvite({
          ticketId: evt.ticketId,
          callerPeerId: evt.callerPeerId,
          callerName: evt.callerName,
          callerFingerprint: evt.callerFingerprint,
          mode: evt.mode,
          verifiedContact: matched,
          fromQueue: evt.fromQueue,
        });
      } else if (evt.type === 'ticket:issued') {
        setOutgoingWait((prev) => {
          if (!prev || prev.contact.peerId !== evt.targetPeerId) return prev;
          return {
            ...prev,
            ticketId: evt.ticketId,
            queuedEmergency: evt.queuedEmergency,
          };
        });
      } else if (evt.type === 'ticket:unavailable') {
        setOutgoingWait(null);
        setStatusNotice('Người thân hiện đang ngoại tuyến. Hãy dùng nút Khẩn để đánh thức thiết bị.');
      } else if (evt.type === 'ticket:accepted') {
        const wait = outgoingWaitRef.current;
        if (!wait) return;
        const contact =
          contactsRef.current.find((c) => c.peerId === evt.peerId) ?? wait.contact;
        setOutgoingWait(null);
        setActiveSession({
          ticketId: evt.ticketId,
          contact,
          mode: evt.mode === 'emergency' ? 'voice' : evt.mode,
          isInitiator: true,
          ticketBurned: true,
        });
      } else if (evt.type === 'ticket:burned') {
        const contact = contactsRef.current.find((c) => c.peerId === evt.peerId);
        if (!contact) return;
        setIncomingInvite(null);
        setActiveSession({
          ticketId: evt.ticketId,
          contact,
          mode: evt.mode === 'emergency' ? 'voice' : evt.mode,
          isInitiator: false,
          ticketBurned: true,
        });
      } else if (evt.type === 'ticket:rejected') {
        setOutgoingWait(null);
        setStatusNotice('Người thân hiện chưa thể nghe máy.');
      } else if (evt.type === 'ticket:invalid') {
        setIncomingInvite(null);
        setStatusNotice('Mã phiên dùng 1 lần đã hết hạn hoặc đã bị hủy.');
      }
    });

    client.connect({
      peerId: vault.identity.peerId,
      displayName: vault.identity.displayName,
      fingerprint: vault.identity.fingerprint,
    });

    return () => {
      unsub();
      client.disconnect();
      signalingRef.current = null;
    };
  }, [vault?.identity.peerId, isUnlocked]);

  // Keep presence subscription synced whenever contacts list changes
  useEffect(() => {
    if (isUnlocked && signalingRef.current && vault) {
      signalingRef.current.subscribePresence(vault.contacts.map((c) => c.peerId));
    }
  }, [vault?.contacts, isUnlocked]);

  // Auto-dismiss transient status banner
  useEffect(() => {
    if (!statusNotice) return;
    const t = window.setTimeout(() => setStatusNotice(null), 5000);
    return () => clearTimeout(t);
  }, [statusNotice]);

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const {user, accessToken} = await googleSignIn();
      const loaded = await loadVaultFromDrive(accessToken);

      if (loaded.vault) {
        setVault(loaded.vault);
        setDriveFileId(loaded.fileId);
        setDriveSyncedAt(loaded.vault.updatedAt);
      } else {
        const displayName = user.displayName || user.email?.split('@')[0] || 'Thành viên SafeMess';
        const identity = await generateIdentity(user.uid, displayName);
        const initialVault: SafeMessVault = {
          version: 1,
          identity,
          contacts: [],
          updatedAt: Date.now(),
        };
        const newFileId = await saveVaultToDrive(accessToken, initialVault, null);
        setVault(initialVault);
        setDriveFileId(newFileId);
        setDriveSyncedAt(initialVault.updatedAt);
      }

      setNeedsAuth(false);
      setIsUnlocked(false);
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : 'Không thể đăng nhập Google hoặc đồng bộ Google Drive.'
      );
    } finally {
      setIsSigningIn(false);
    }
  };

  const handlePinSetupComplete = async (pin: PinCredential) => {
    if (!vault) return;
    const token = getAccessToken();
    const updated: SafeMessVault = {
      ...vault,
      pin,
      updatedAt: Date.now(),
    };
    if (token) {
      const fileId = await saveVaultToDrive(token, updated, driveFileId);
      setDriveFileId(fileId);
      setDriveSyncedAt(updated.updatedAt);
    }
    setVault(updated);
    setIsUnlocked(true);
  };

  const handleSignOut = async () => {
    signalingRef.current?.disconnect();
    await logout();
    setVault(null);
    setDriveFileId(null);
    setIsUnlocked(false);
    setNeedsAuth(true);
  };

  const handleQueueAddContact = (contact: TrustedContact) => {
    if (!vault) return;
    const nextContacts = [...vault.contacts, contact];
    setPendingDriveAction({
      title: 'Lưu thành viên vào Google Drive?',
      description: `SafeMess sẽ mã hóa và cập nhật danh bạ tin cậy (thêm "${
        contact.relationLabel || contact.displayName
      }" · ${contact.fingerprint}) vào thư mục ẩn trên Google Drive của bạn.`,
      confirmLabel: 'Lưu vào Google Drive',
      destructive: false,
      nextContacts,
    });
  };

  const handleQueueRemoveContact = (contact: TrustedContact) => {
    if (!vault) return;
    const nextContacts = vault.contacts.filter((c) => c.peerId !== contact.peerId);
    setPendingDriveAction({
      title: 'Xóa thành viên khỏi Vòng tròn tin cậy?',
      description: `Bạn có chắc muốn xóa "${
        contact.relationLabel || contact.displayName
      }" và cập nhật thay đổi này lên thư mục ẩn Google Drive? Sau khi xóa, thiết bị này sẽ không thể gọi hoặc nhắn tin cho bạn nữa.`,
      confirmLabel: 'Xóa & Đồng bộ',
      destructive: true,
      nextContacts,
    });
  };

  const handleConfirmDriveMutation = async () => {
    if (!vault || !pendingDriveAction) return;
    const token = getAccessToken();
    if (!token) {
      setPendingDriveAction(null);
      setAuthError('Phiên Google Drive đã hết hạn. Vui lòng đăng nhập lại.');
      await handleSignOut();
      return;
    }

    setIsSyncingDrive(true);
    try {
      const updated: SafeMessVault = {
        ...vault,
        contacts: pendingDriveAction.nextContacts,
        updatedAt: Date.now(),
      };
      const fileId = await saveVaultToDrive(token, updated, driveFileId);
      setVault(updated);
      setDriveFileId(fileId);
      setDriveSyncedAt(updated.updatedAt);
      setStatusNotice('Đã cập nhật Vòng tròn tin cậy lên thư mục ẩn Google Drive.');
    } catch (err) {
      setStatusNotice(
        err instanceof Error ? err.message : 'Không thể đồng bộ Google Drive.'
      );
    } finally {
      setIsSyncingDrive(false);
      setPendingDriveAction(null);
    }
  };

  const handleStartSession = (contact: TrustedContact, mode: SessionMode) => {
    if (!signalingRef.current || !wsConnected) {
      setStatusNotice('Đang kết nối lại máy chủ tín hiệu P2P, vui lòng thử lại sau vài giây.');
      return;
    }
    setOutgoingWait({ticketId: null, contact, mode});
    signalingRef.current.requestTicket(contact.peerId, mode);
  };

  const handleCancelOutgoing = () => {
    if (outgoingWait?.ticketId && signalingRef.current) {
      signalingRef.current.rejectTicket(outgoingWait.ticketId);
    }
    setOutgoingWait(null);
  };

  const handleAcceptInvite = (invite: IncomingCallInvite) => {
    signalingRef.current?.acceptTicket(invite.ticketId);
    setIncomingInvite(null);
  };

  const handleRejectInvite = (invite: IncomingCallInvite) => {
    signalingRef.current?.rejectTicket(invite.ticketId);
    setIncomingInvite(null);
  };

  const handleRamWipeExit = (reason?: string) => {
    setActiveSession(null);
    if (reason) {
      setStatusNotice(reason);
    }
  };

  if (needsAuth || !vault) {
    return (
      <WelcomeScreen
        isSigningIn={isSigningIn}
        errorMessage={authError}
        onGoogleSignIn={() => void handleGoogleSignIn()}
      />
    );
  }

  if (!vault.pin || !isUnlocked) {
    return (
      <BiometricLockScreen
        mode={vault.pin ? 'unlock' : 'setup'}
        displayName={vault.identity.displayName}
        peerId={vault.identity.peerId}
        existingPin={vault.pin}
        onSetupComplete={handlePinSetupComplete}
        onUnlocked={() => setIsUnlocked(true)}
        onSignOut={() => void handleSignOut()}
      />
    );
  }

  return (
    <>
      <HomeScreen
        identity={vault.identity}
        contacts={vault.contacts}
        presenceMap={presenceMap}
        wsConnected={wsConnected}
        driveSyncedAt={driveSyncedAt}
        pendingStatusMessage={statusNotice}
        onOpenAddMember={() => setAddMemberOpen(true)}
        onStartSession={handleStartSession}
        onRequestRemoveContact={handleQueueRemoveContact}
        onLockApp={() => setIsUnlocked(false)}
        onSignOut={() => void handleSignOut()}
      />

      <AddMemberModal
        open={addMemberOpen}
        identity={vault.identity}
        existingContacts={vault.contacts}
        onClose={() => setAddMemberOpen(false)}
        onAddContact={handleQueueAddContact}
      />

      <ConfirmDriveSyncDialog
        open={Boolean(pendingDriveAction)}
        title={pendingDriveAction?.title ?? ''}
        description={pendingDriveAction?.description ?? ''}
        confirmLabel={pendingDriveAction?.confirmLabel ?? 'Xác nhận'}
        destructive={pendingDriveAction?.destructive ?? false}
        isBusy={isSyncingDrive}
        onConfirm={() => void handleConfirmDriveMutation()}
        onCancel={() => setPendingDriveAction(null)}
      />

      {/* Outgoing One-Time Ticket Waiting Modal */}
      {outgoingWait && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm bg-white rounded-3xl border border-slate-200 shadow-xl p-7 text-center space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 mx-auto flex items-center justify-center text-2xl font-bold">
              {(outgoingWait.contact.relationLabel || outgoingWait.contact.displayName)
                .slice(0, 2)
                .toUpperCase()}
            </div>
            <div className="space-y-1.5">
              <h2 className="text-xl font-bold text-slate-900">
                {outgoingWait.mode === 'emergency'
                  ? 'Đang phát tín hiệu Khẩn cấp...'
                  : `Đang gọi ${
                      outgoingWait.contact.relationLabel ||
                      outgoingWait.contact.displayName
                    }...`}
              </h2>
              <p className="text-sm text-slate-600">
                {outgoingWait.queuedEmergency
                  ? 'Thiết bị người thân đang ngoại tuyến. Tín hiệu báo động ưu tiên đã được xếp hàng đánh thức ngay khi họ trực tuyến.'
                  : 'Đã cấp mã liên lạc dùng 1 lần. Đang chờ thiết bị người thân bắt tay P2P.'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleCancelOutgoing}
              className="w-full min-h-[50px] px-4 py-3 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white text-base font-semibold inline-flex items-center justify-center gap-2 transition-colors"
            >
              <PhoneOff className="w-5 h-5" />
              <span>Hủy kết nối</span>
            </button>
          </div>
        </div>
      )}

      <IncomingCallBanner
        invite={incomingInvite}
        onAccept={handleAcceptInvite}
        onReject={handleRejectInvite}
      />

      {activeSession && signalingRef.current && (activeSession.mode === 'voice' || activeSession.mode === 'video') && (
        <CallModal
          session={activeSession}
          identity={vault.identity}
          signaling={signalingRef.current}
          onRamWipeExit={handleRamWipeExit}
        />
      )}

      {activeSession && signalingRef.current && activeSession.mode === 'chat' && (
        <ChatModal
          session={activeSession}
          identity={vault.identity}
          signaling={signalingRef.current}
          onRamWipeExit={handleRamWipeExit}
        />
      )}
    </>
  );
}

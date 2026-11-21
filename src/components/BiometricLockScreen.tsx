import {useEffect, useState} from 'react';
import {Delete, Fingerprint, Lock, LogOut} from 'lucide-react';
import {
  authenticateBiometricPasskey,
  isPlatformBiometricAvailable,
  registerBiometricPasskey,
} from '../lib/biometric';
import {hashPin, verifyPin} from '../lib/crypto';
import type {PinCredential} from '../types/safemess';
import {BrandMark} from './BrandMark';

interface BiometricLockScreenProps {
  mode: 'setup' | 'unlock';
  displayName: string;
  peerId: string;
  existingPin?: PinCredential;
  onSetupComplete: (pin: PinCredential) => Promise<void>;
  onUnlocked: () => void;
  onSignOut: () => void;
}

const PIN_LENGTH = 4;

export function BiometricLockScreen({
  mode,
  displayName,
  peerId,
  existingPin,
  onSetupComplete,
  onUnlocked,
  onSignOut,
}: BiometricLockScreenProps) {
  const [digits, setDigits] = useState('');
  const [firstPin, setFirstPin] = useState<string | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void isPlatformBiometricAvailable().then(setBiometricAvailable);
  }, []);

  const handleDigit = async (digit: string) => {
    if (busy || digits.length >= PIN_LENGTH) return;
    setError(null);
    const next = digits + digit;
    setDigits(next);

    if (next.length === PIN_LENGTH) {
      if (mode === 'setup') {
        if (!firstPin) {
          setFirstPin(next);
          setDigits('');
          return;
        }
        if (next !== firstPin) {
          setError('Mã PIN nhập lại không khớp. Vui lòng tạo lại.');
          setFirstPin(null);
          setDigits('');
          return;
        }
        setBusy(true);
        try {
          const {saltB64, hashB64} = await hashPin(next);
          let biometricCredentialId: string | undefined;
          if (biometricAvailable) {
            try {
              const cred = await registerBiometricPasskey(peerId, displayName);
              if (cred) biometricCredentialId = cred;
            } catch {
              // User skipped or platform biometric unavailable; PIN remains active
            }
          }
          await onSetupComplete({saltB64, hashB64, biometricCredentialId});
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Không thể lưu mã PIN bảo mật.');
          setDigits('');
          setFirstPin(null);
        } finally {
          setBusy(false);
        }
      } else {
        if (!existingPin) {
          onUnlocked();
          return;
        }
        setBusy(true);
        try {
          const ok = await verifyPin(next, existingPin.saltB64, existingPin.hashB64);
          if (ok) {
            onUnlocked();
          } else {
            setError('Mã PIN không chính xác. Vui lòng thử lại.');
            setDigits('');
          }
        } finally {
          setBusy(false);
        }
      }
    }
  };

  const handleBackspace = () => {
    if (busy) return;
    setDigits((prev) => prev.slice(0, -1));
  };

  const handleBiometricUnlock = async () => {
    if (!existingPin?.biometricCredentialId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await authenticateBiometricPasskey(existingPin.biometricCredentialId);
      if (ok) {
        onUnlocked();
      } else {
        setError('Xác thực sinh trắc học chưa thành công. Bạn có thể nhập mã PIN.');
      }
    } catch {
      setError('Không thể xác thực sinh trắc học trên trình duyệt này. Vui lòng nhập mã PIN.');
    } finally {
      setBusy(false);
    }
  };

  const heading =
    mode === 'setup'
      ? firstPin
        ? 'Nhập lại mã PIN 4 số'
        : 'Tạo mã PIN bảo vệ SafeMess'
      : 'Xác nhận danh tính để mở SafeMess';

  const subtitle =
    mode === 'setup'
      ? 'Mã PIN cục bộ (kèm Vân tay / Face ID nếu thiết bị hỗ trợ) bảo vệ ứng dụng mỗi lần mở.'
      : `Tài khoản: ${displayName}`;

  return (
    <div className="min-h-screen bg-[#F5F7FB] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-sm p-7 sm:p-9 space-y-7">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrandMark size="sm" />
            <span className="text-lg font-bold text-slate-900">SafeMess</span>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="min-h-[44px] px-3 rounded-xl text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <LogOut className="w-4 h-4" />
            <span>Đăng xuất</span>
          </button>
        </div>

        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 mx-auto flex items-center justify-center">
            {mode === 'unlock' && existingPin?.biometricCredentialId ? (
              <Fingerprint className="w-9 h-9" />
            ) : (
              <Lock className="w-8 h-8" />
            )}
          </div>
          <h1 className="text-xl font-bold text-slate-900 text-balance">{heading}</h1>
          <p className="text-sm text-slate-600">{subtitle}</p>
        </div>

        {/* 4-dot PIN indicator */}
        <div className="flex items-center justify-center gap-4" aria-label="Tiến trình nhập mã PIN">
          {Array.from({length: PIN_LENGTH}).map((_, i) => {
            const filled = i < digits.length;
            return (
              <div
                key={i}
                className={`w-4 h-4 rounded-full border-2 transition-colors ${
                  filled
                    ? 'bg-blue-600 border-blue-600'
                    : 'bg-slate-100 border-slate-300'
                }`}
              />
            );
          })}
        </div>

        {error && (
          <div
            role="alert"
            className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-800 text-center"
          >
            {error}
          </div>
        )}

        {/* Numeric Keypad */}
        <div className="grid grid-cols-3 gap-3 max-w-[290px] mx-auto">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
            <button
              key={num}
              type="button"
              disabled={busy}
              onClick={() => void handleDigit(num)}
              className="h-14 rounded-2xl bg-slate-50 hover:bg-slate-100 active:scale-[0.97] border border-slate-200/80 text-xl font-semibold text-slate-900 tabular-nums transition-all"
            >
              {num}
            </button>
          ))}

          {mode === 'unlock' && existingPin?.biometricCredentialId && biometricAvailable ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleBiometricUnlock()}
              className="h-14 rounded-2xl bg-blue-50 hover:bg-blue-100 text-blue-700 flex items-center justify-center transition-colors"
              aria-label="Mở khóa bằng vân tay hoặc Face ID"
            >
              <Fingerprint className="w-6 h-6" />
            </button>
          ) : (
            <div />
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => void handleDigit('0')}
            className="h-14 rounded-2xl bg-slate-50 hover:bg-slate-100 active:scale-[0.97] border border-slate-200/80 text-xl font-semibold text-slate-900 tabular-nums transition-all"
          >
            0
          </button>

          <button
            type="button"
            disabled={busy || digits.length === 0}
            onClick={handleBackspace}
            className="h-14 rounded-2xl bg-slate-50 hover:bg-slate-100 disabled:opacity-40 text-slate-700 flex items-center justify-center transition-colors"
            aria-label="Xóa số"
          >
            <Delete className="w-6 h-6" />
          </button>
        </div>

        {mode === 'unlock' && existingPin?.biometricCredentialId && biometricAvailable && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleBiometricUnlock()}
            className="w-full min-h-[48px] px-4 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
          >
            <Fingerprint className="w-5 h-5" />
            <span>Mở khóa bằng Vân tay / Face ID</span>
          </button>
        )}
      </div>
    </div>
  );
}

import {useEffect, useRef, useState, type ChangeEvent} from 'react';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import {Camera, Check, Copy, ImageUp, QrCode, ShieldCheck, X} from 'lucide-react';
import {encodePairingQr, parseAndVerifyPairingQr} from '../lib/crypto';
import type {QrPairingPayload, SafeMessIdentity, TrustedContact} from '../types/safemess';

interface AddMemberModalProps {
  open: boolean;
  identity: SafeMessIdentity;
  existingContacts: TrustedContact[];
  onClose: () => void;
  onAddContact: (contact: TrustedContact) => void;
}

export function AddMemberModal({
  open,
  identity,
  existingContacts,
  onClose,
  onAddContact,
}: AddMemberModalProps) {
  const [tab, setTab] = useState<'my-qr' | 'scan'>('my-qr');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const [cameraActive, setCameraActive] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [verifiedPayload, setVerifiedPayload] = useState<QrPairingPayload | null>(null);
  const [relationLabel, setRelationLabel] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);

  const myPairingJson = encodePairingQr({
    v: 1,
    peerId: identity.peerId,
    displayName: identity.displayName,
    publicKeyJwk: identity.publicKeyJwk,
    fingerprint: identity.fingerprint,
  });

  useEffect(() => {
    if (!open) return;
    void QRCode.toDataURL(myPairingJson, {
      width: 320,
      margin: 2,
      color: {
        dark: '#0F172A',
        light: '#FFFFFF',
      },
    }).then(setQrDataUrl);
  }, [open, myPairingJson]);

  const stopCamera = () => {
    if (scanTimerRef.current !== null) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (!open || tab !== 'scan') {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [open, tab]);

  if (!open) return null;

  const handleDecodedString = async (raw: string) => {
    setScanError(null);
    try {
      const payload = await parseAndVerifyPairingQr(raw);
      if (payload.peerId === identity.peerId) {
        setScanError('Đây là mã QR của chính bạn. Hãy quét mã của người thân.');
        return;
      }
      if (existingContacts.some((c) => c.peerId === payload.peerId)) {
        setScanError(`${payload.displayName} đã có trong Vòng tròn tin cậy của bạn.`);
        return;
      }
      stopCamera();
      setVerifiedPayload(payload);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Không thể xác minh mã QR.');
    }
  };

  const startCameraScanner = async () => {
    setScanError(null);
    setVerifiedPayload(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: 'environment'},
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);

      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
      }, 60);

      scanTimerRef.current = window.setInterval(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.readyState < 2) return;

        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) return;

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', {willReadFrequently: true});
        if (!ctx) return;

        ctx.drawImage(video, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        const code = jsQR(imageData.data, w, h);
        if (code && code.data) {
          void handleDecodedString(code.data);
        }
      }, 220);
    } catch {
      setScanError('Không thể truy cập camera. Bạn có thể tải ảnh mã QR hoặc dán mã ghép nối bên dưới.');
      stopCamera();
    }
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanError(null);

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, img.width, img.height);
        const code = jsQR(data.data, img.width, img.height);
        if (code?.data) {
          void handleDecodedString(code.data);
        } else {
          setScanError('Không tìm thấy mã QR SafeMess hợp lệ trong ảnh đã chọn.');
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(myPairingJson);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked
    }
  };

  const handleConfirmAdd = () => {
    if (!verifiedPayload) return;
    onAddContact({
      peerId: verifiedPayload.peerId,
      displayName: verifiedPayload.displayName,
      relationLabel: relationLabel.trim() || undefined,
      publicKeyJwk: verifiedPayload.publicKeyJwk,
      fingerprint: verifiedPayload.fingerprint,
      addedAt: Date.now(),
    });
    setVerifiedPayload(null);
    setRelationLabel('');
    setManualCode('');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-slate-950/55 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-member-title"
    >
      <div className="w-full max-w-lg bg-white rounded-3xl border border-slate-200 shadow-xl p-6 sm:p-7 space-y-6 my-auto">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h2 id="add-member-title" className="text-lg font-bold text-slate-900">
                Thêm thành viên tin cậy
              </h2>
              <p className="text-xs text-slate-500">
                Xác minh chéo khóa mã hóa 1 lần duy nhất
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2 Tabs */}
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-2xl">
          <button
            type="button"
            onClick={() => setTab('my-qr')}
            className={`min-h-[44px] px-4 py-2 rounded-xl text-sm font-semibold transition-all whitespace-nowrap ${
              tab === 'my-qr'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Mã QR của tôi
          </button>
          <button
            type="button"
            onClick={() => setTab('scan')}
            className={`min-h-[44px] px-4 py-2 rounded-xl text-sm font-semibold transition-all whitespace-nowrap ${
              tab === 'scan'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Quét mã người thân
          </button>
        </div>

        {tab === 'my-qr' ? (
          <div className="space-y-5 text-center">
            <div className="inline-flex p-4 rounded-3xl bg-white border border-slate-200 shadow-xs">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Mã QR danh tính SafeMess của bạn"
                  className="w-56 h-56 sm:w-64 sm:h-64 rounded-xl"
                />
              ) : (
                <div className="w-56 h-56 flex items-center justify-center text-sm text-slate-400">
                  Đang tạo mã QR...
                </div>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-base font-bold text-slate-900">{identity.displayName}</p>
              <p className="text-sm font-mono text-slate-600 tabular-nums">
                Dấu khóa: {identity.fingerprint}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void handleCopyCode()}
              className="w-full min-h-[48px] px-4 py-3 rounded-2xl border border-slate-200 hover:bg-slate-50 text-sm font-semibold text-slate-800 inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span>Đã sao chép mã ghép nối</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Sao chép mã ghép nối (dành cho máy tính)</span>
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {verifiedPayload ? (
              <div className="p-5 rounded-2xl bg-emerald-50/70 border border-emerald-200 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-slate-900">
                      {verifiedPayload.displayName}
                    </p>
                    <p className="text-xs font-mono text-slate-600 tabular-nums mt-0.5">
                      Đã xác minh khóa · {verifiedPayload.fingerprint}
                    </p>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="relation-input"
                    className="block text-sm font-semibold text-slate-800 mb-1.5"
                  >
                    Tên gọi thân mật trong gia đình (tuỳ chọn)
                  </label>
                  <input
                    id="relation-input"
                    type="text"
                    value={relationLabel}
                    onChange={(e) => setRelationLabel(e.target.value)}
                    placeholder="Ví dụ: Bố, Mẹ, Con gái..."
                    maxLength={40}
                    className="w-full h-12 px-4 rounded-xl border border-slate-300 bg-white text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setVerifiedPayload(null)}
                    className="flex-1 min-h-[48px] px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Quét lại
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmAdd}
                    className="flex-1 min-h-[48px] px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-sm font-semibold text-white whitespace-nowrap"
                  >
                    Thêm vào danh bạ
                  </button>
                </div>
              </div>
            ) : (
              <>
                {cameraActive ? (
                  <div className="space-y-3">
                    <div className="relative aspect-[4/3] w-full rounded-2xl overflow-hidden bg-slate-950">
                      <video
                        ref={videoRef}
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 border-2 border-cyan-400/70 m-8 rounded-2xl pointer-events-none" />
                    </div>
                    <canvas ref={canvasRef} className="hidden" />
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Tắt camera quét
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => void startCameraScanner()}
                      className="min-h-[52px] px-4 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                    >
                      <Camera className="w-5 h-5" />
                      <span>Mở Camera quét QR</span>
                    </button>

                    <label className="min-h-[52px] px-4 py-3 rounded-2xl border border-slate-200 hover:bg-slate-50 text-slate-800 text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors whitespace-nowrap">
                      <ImageUp className="w-5 h-5" />
                      <span>Chọn ảnh mã QR</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileUpload}
                        className="sr-only"
                      />
                    </label>
                  </div>
                )}

                <div className="pt-2 border-t border-slate-200 space-y-2.5">
                  <label
                    htmlFor="manual-qr-code"
                    className="block text-xs font-semibold text-slate-600"
                  >
                    Hoặc dán mã ghép nối từ thiết bị người thân
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="manual-qr-code"
                      type="text"
                      value={manualCode}
                      onChange={(e) => setManualCode(e.target.value)}
                      placeholder='{"v":1,"peerId":...}'
                      className="flex-1 min-w-0 h-11 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    <button
                      type="button"
                      disabled={!manualCode.trim()}
                      onClick={() => void handleDecodedString(manualCode)}
                      className="min-h-[44px] px-4 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-sm font-semibold whitespace-nowrap shrink-0"
                    >
                      Xác minh
                    </button>
                  </div>
                </div>
              </>
            )}

            {scanError && (
              <div
                role="alert"
                className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-800"
              >
                {scanError}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

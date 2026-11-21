import {AlertTriangle, CloudUpload, X} from 'lucide-react';

interface ConfirmDriveSyncDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  isBusy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDriveSyncDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  isBusy = false,
  onConfirm,
  onCancel,
}: ConfirmDriveSyncDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drive-confirm-title"
    >
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-xl p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                destructive ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-700'
              }`}
            >
              {destructive ? (
                <AlertTriangle className="w-5 h-5" />
              ) : (
                <CloudUpload className="w-5 h-5" />
              )}
            </div>
            <h2 id="drive-confirm-title" className="text-lg font-bold text-slate-900">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            aria-label="Đóng hộp thoại"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-[15px] leading-relaxed text-slate-600">{description}</p>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            className="min-h-[44px] px-5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isBusy}
            className={`min-h-[44px] px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 ${
              destructive
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isBusy ? 'Đang đồng bộ...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

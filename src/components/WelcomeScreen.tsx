import {KeyRound, ShieldCheck, Smartphone, Volume2} from 'lucide-react';
import {BrandMark} from './BrandMark';

interface WelcomeScreenProps {
  isSigningIn: boolean;
  errorMessage: string | null;
  onGoogleSignIn: () => void;
}

export function WelcomeScreen({
  isSigningIn,
  errorMessage,
  onGoogleSignIn,
}: WelcomeScreenProps) {
  return (
    <div className="min-h-screen bg-[#F5F7FB] flex items-center justify-center p-4 sm:p-8">
      <main className="w-full max-w-4xl bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
        {/* Left Identity & Action Column */}
        <section className="lg:col-span-7 p-8 sm:p-10 flex flex-col justify-between gap-8">
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <BrandMark size="lg" />
              <div>
                <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
                  SafeMess
                </h1>
                <p className="text-sm font-medium text-slate-500 mt-1">
                  Không Máy Chủ · Không Vết Tích · Danh Tính Tuyệt Đối
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 text-balance leading-snug">
                Kết nối P2P khép kín — Bảo vệ gia đình tuyệt đối
              </h2>
              <p className="text-base text-slate-600 leading-relaxed max-w-xl">
                Liên lạc trực tiếp giữa hai thiết bị tin cậy. Âm thanh, hình ảnh và tin nhắn chỉ tồn tại tạm thời trên bộ nhớ RAM và bị xóa sạch ngay khi kết thúc.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {errorMessage && (
              <div
                role="alert"
                className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-800"
              >
                {errorMessage}
              </div>
            )}

            <button
              type="button"
              onClick={onGoogleSignIn}
              disabled={isSigningIn}
              className="gsi-material-button"
            >
              <div className="gsi-material-button-content-wrapper">
                <div className="gsi-material-button-icon" aria-hidden="true">
                  <svg
                    version="1.1"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 48 48"
                    style={{display: 'block'}}
                  >
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                  </svg>
                </div>
                <span className="whitespace-nowrap">
                  {isSigningIn ? 'Đang xác thực & đồng bộ...' : 'Đăng nhập bằng Google'}
                </span>
              </div>
            </button>

            <p className="text-xs text-slate-500 leading-relaxed">
              Không thu thập số điện thoại. Cặp khóa mã hóa và danh bạ tin cậy được đồng bộ riêng tư trong thư mục ẩn của Google Drive cá nhân.
            </p>
          </div>
        </section>

        {/* Right Architectural Safeguards Column */}
        <aside className="lg:col-span-5 bg-slate-50 border-t lg:border-t-0 lg:border-l border-slate-200/80 p-8 sm:p-10 flex flex-col justify-center gap-6">
          <h3 className="text-sm font-semibold text-slate-900">
            Cơ chế bảo vệ mặc định
          </h3>

          <ul className="space-y-5">
            <li className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-blue-600 shrink-0">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Khóa 1 lần qua mã QR
                </p>
                <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">
                  Chặn tuyệt đối mọi cuộc gọi và tin nhắn từ người lạ ngoài Vòng tròn tin cậy.
                </p>
              </div>
            </li>

            <li className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-blue-600 shrink-0">
                <Volume2 className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Biến đổi giọng nói luôn bật
                </p>
                <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">
                  Xử lý DSP trực tiếp trên thiết bị gửi để ngăn thu thập giọng thật giả mạo AI.
                </p>
              </div>
            </li>

            <li className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-blue-600 shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Nhắn tin một chiều tự ẩn
                </p>
                <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">
                  Nội dung đã gửi tự ẩn sau 3 giây và xóa sạch bộ nhớ RAM khi đóng phiên.
                </p>
              </div>
            </li>

            <li className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-blue-600 shrink-0">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Khóa sinh trắc học & mã PIN
                </p>
                <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">
                  Ngăn kẻ gian mạo danh ngay cả khi điện thoại bị mất trong trạng thái mở.
                </p>
              </div>
            </li>
          </ul>
        </aside>
      </main>
    </div>
  );
}

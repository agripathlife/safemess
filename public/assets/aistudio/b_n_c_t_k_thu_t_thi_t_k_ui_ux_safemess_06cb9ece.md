# BẢN ĐẶC TẢ KỸ THUẬT VÀ KIẾN TRÚC DỰ ÁN: **SafeMess**

> **Triết lý cốt lõi:** *"Không Máy Chủ – Không Vết Tích – Kết Nối 1 Lần – Danh Tính Tuyệt Đối"*

## I. MỤC TIÊU DỰ ÁN

* **Vấn đề giải quyết:** Triệt tiêu 100% rủi ro từ các cuộc gọi lừa đảo, giả mạo khuôn mặt/giọng nói bằng AI (Deepfake), nghe lén, quay/chụp lén màn hình, thu âm trái phép và kịch bản chiếm quyền điều khiển ứng dụng khi thiết bị bị đánh cắp.
* **Mô hình kết nối:** Mạng ngang hàng (P2P - Peer-to-Peer) thuần túy. Dữ liệu truyền trực tiếp giữa 2 thiết bị và chỉ tồn tại trên bộ nhớ tạm (RAM) trong thời gian thực. Ngay khi ngắt kết nối hoặc thoát phiên, toàn bộ dữ liệu bị xóa sạch tức thì (`RAM Wipe`).
* **Nền tảng hỗ trợ:**
  * **Thiết bị di động:** Android & iOS.
  * **Máy tính để bàn:** Windows, macOS & Linux.

---

## II. KIẾN TRÚC HỆ THỐNG TỔNG QUAN

```text
┌──────────────────────────────────────────────────────────────────────────┐
│              GIAO DIỆN NGHỆ THUẬT (Tối Giản 1-Chạm)                      │
│   • Điện thoại (Android/iOS) & Máy tính (Windows/macOS/Linux)            │
└──────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                   TẦNG LÕI BẢO MẬT (RUST CORE ENGINE)                    │
│  • Mã hóa dữ liệu: Cặp khóa Curve25519 & Thuật toán AES-256-GCM           │
│  • Mạng ngang hàng: Giao thức WebRTC P2P (Truyền tin & Âm thanh/Video)  │
│  • Xử lý Âm thanh: Biến đổi giọng nói thời gian thực (Pitch Shift DSP)  │
└──────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    TẦNG XÁC THỰC & ĐỒNG BỘ ẨN                           │
│  • Google Drive (Lưu cặp khóa & Danh bạ trong thư mục ẩn appDataFolder)  │
│  • Sinh trắc học Native (Vân tay / Face ID / Mã PIN để mở ứng dụng)      │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## III. ĐẶC TẢ TÍNH NĂNG CHI TIẾT

### 1. Quản lý Danh tính & Khóa Mã Hóa
* **Định danh bằng Tài khoản Google:** Sử dụng Mã định danh Google (Google ID) làm mỏ neo xác thực duy nhất. Hoàn toàn không thu thập hay sử dụng số điện thoại hoặc email công khai.
* **Đồng bộ ẩn qua Google Drive:**
  * Ngay khi cài đặt, **SafeMess** tự động khởi tạo cặp khóa mã hóa bất đối xứng trên thiết bị.
  * Khóa công khai (Public Key) và danh sách liên hệ tin cậy được mã hóa cục bộ, sau đó sao lưu vào thư mục ẩn `appDataFolder` trên Google Drive cá nhân.
  * **Khi chuyển sang thiết bị mới:** Người dùng chỉ cần đăng nhập lại Tài khoản Google, ứng dụng tự động tải lại cặp khóa và danh bạ một cách liền mạch.
  * **Chính sách Mất tài khoản:** Nếu mất quyền truy cập Tài khoản Google, người dùng bắt buộc tạo tài khoản **SafeMess** mới. Hệ thống không tạo khóa dự phòng trôi nổi nhằm loại bỏ hoàn toàn nguy cơ kẻ gian lợi dụng khóa khôi phục để mạo danh.

### 2. Luồng Thiết Lập Kết Nối P2P & Cuộc Gọi
* **Vòng Tròn Tin Cậy (Trusted Circle):** Chỉ những thiết bị đã xác minh chéo khóa mã hóa qua mã QR mới có thể gửi tín hiệu gọi hoặc nhắn tin. Mọi kết nối từ thiết bị lạ đều bị hệ thống chặn đứng từ tầng giao thức.
* **Mã Liên Lạc Dùng Một Lần (One-Time Ticket):**
  * Mã phiên kết nối chỉ được sinh ra khi hai bên cùng xác nhận mở liên lạc.
  * Ngay sau khi hai thiết bị bắt tay P2P thành công, mã phiên lập tức bị hủy bỏ hoàn toàn. Không có thiết bị thứ ba nào có thể tái sử dụng mã này để nghe lén hoặc chèn vào phiên gọi.
* **Tín Hiệu Gọi Khẩn Cấp (Emergency Call):** Tận dụng kênh thông báo đẩy ưu tiên cao (FCM/APNs) để kích hoạt chuông báo động trên thiết bị người nhận ngay cả khi ứng dụng đang đóng hoàn toàn hoặc điện thoại đang bật chế độ im lặng.

### 3. Cơ Chế Chống Thu Thập Bằng Chứng (Zero-Trace)
* **Giọng Nói – Biến Đổi Giọng Nói Bắt Buộc (Always-On Voice Masking):**
  * Luồng âm thanh thu từ micro được xử lý biến đổi tần số (Pitch Shift DSP) trực tiếp trên thiết bị gửi trước khi mã hóa và truyền đi.
  * Cơ chế này luôn ở trạng thái bật (không có nút tắt) để ngăn chặn tuyệt đối việc đầu dây bên kia dùng thiết bị ngoài thu âm giọng thật nhằm huấn luyện AI giả mạo sinh trắc học giọng nói.
* **Hình Ảnh – Chống Quay/Chụp Màn Hình & Dấu Bản Quyền Động:**
  * Kích hoạt cờ bảo vệ hiển thị mức hệ thống (`FLAG_SECURE` trên Android; cảnh báo/ngắt luồng khi phát hiện quay màn hình trên iOS và PC). Mọi ảnh chụp hoặc video quay màn hình sẽ chỉ hiển thị một màu đen tuyền.
  * **Watermark Động:** Dòng chữ định danh chứa Tên/ID của người đang xem tự động di chuyển ngẫu nhiên trên khung hình Video, răn đe và truy vết hành vi dùng điện thoại khác quay lén màn hình.
* **Tin Nhắn – Hiển Thị Một Chiều (Asymmetric Text):**
  * **Tại máy gửi:** Sau khi bấm gửi 3 giây, nội dung tin nhắn gốc tự động ẩn đi và chỉ giữ lại trạng thái `✔️ Đã gửi`. Người gửi không cần lưu lại nội dung đã soạn, tránh bị người xung quanh nhìn trộm hoặc chụp lén.
  * **Tại máy nhận:** Chỉ hiển thị phần tin nhắn do đối phương gửi tới.
  * Cơ chế này triệt tiêu hoàn toàn khả năng tạo dựng "ảnh chụp đoạn hội thoại hai chiều" để làm bằng chứng giả mạo.
* **Xóa Sạch Bộ Nhớ Tạm (RAM Wipe):** Ngay khi người dùng bấm ngắt kết nối hoặc thoát khỏi màn hình giao tiếp, toàn bộ tin nhắn, dữ liệu đệm âm thanh/hình ảnh và khóa phiên tạm thời trên RAM bị ghi đè và giải phóng hoàn toàn.

### 4. Khóa Lớp Ngoại Bằng Sinh Trắc Học
* Bắt buộc xác thực Vân tay, Face ID hoặc Mã PIN cục bộ mỗi lần mở ứng dụng hoặc quay lại từ chế độ chạy nền.
* Ngăn chặn triệt để kịch bản kẻ gian nhặt được điện thoại đang mở khóa để giả danh nhắn tin/gọi điện lừa tiền người thân.

---

## IV. CÔNG NGHỆ PHÁT TRIỂN (TECH STACK)

| Thành phần | Công nghệ lựa chọn | Lý do sử dụng |
| :--- | :--- | :--- |
| **Giao diện (UI)** | **Flutter** | Xây dựng trên một mã nguồn duy nhất, vận hành mượt mà trên cả 5 nền tảng: iOS, Android, Windows, macOS, Linux. |
| **Lõi Bảo mật (Core Engine)** | **Rust** | Đảm bảo an toàn bộ nhớ tuyệt đối, chống rò rỉ dữ liệu trên RAM, hiệu năng xử lý DSP cực cao và biên dịch thành thư viện FFI chạy trực tiếp trong Flutter. |
| **Giao thức P2P** | **WebRTC DataChannel & SRTP** | Chuẩn truyền tải ngang hàng thời gian thực, độ trễ thấp và mã hóa đầu cuối mặc định. |
| **Mã hóa (Crypto)** | **libsodium (`Curve25519` + `AES-256-GCM`)** | Bộ thuật toán mật mã chuẩn quân sự, bảo vệ toàn vẹn luồng dữ liệu trao đổi giữa hai thiết bị. |
| **Đồng bộ Ẩn** | **Google Drive API (`appDataFolder`)** | Lưu trữ danh bạ và cặp khóa mã hóa an toàn trong không gian lưu trữ ẩn riêng biệt của ứng dụng trên Drive người dùng. |

---

## V. THIẾT KẾ LUỒNG GIAO DIỆN NGƯỜI DÙNG (UI/UX FLOW)

Giao diện **SafeMess** được thiết kế theo triết lý **"Tối giản 1-Chạm" (One-Touch Minimalist)**: hiện đại, trực quan, phông chữ lớn và nút bấm tách biệt rõ ràng để mọi lứa tuổi (đặc biệt là người lớn tuổi) có thể sử dụng ngay lập tức mà không cần thao tác cài đặt rườm rà.

```text
[Màn hình Welcome / Đăng nhập Google]
                  │
                  ▼
[Màn hình Biometric Lock (Vân tay/Face ID)]
                  │
                  ▼
        [MÀN HÌNH CHÍNH (Home)]
      ┌───────────┼───────────┐
      │           │           │
      ▼           ▼           ▼
 [Thoại P2P]  [Camera P2P] [Nhắn tin] ──► [Thêm thành viên (QR)]
```

### 1. Màn hình Khởi tạo & Đăng nhập (Onboarding & Authentication)
* **Màn hình 1.1 – Welcome & Đăng nhập Google:**
  * Hiển thị biểu tượng chiếc khiên đặc trưng của **SafeMess** kèm khẩu hiệu: *"Kết nối P2P khép kín – Bảo vệ gia đình tuyệt đối"*.
  * Một nút hành động duy nhất: **`[ G ] Đăng nhập bằng Google`**.
  * **Xử lý nền:** Hệ thống tự động sinh cặp khóa `Curve25519`, đẩy Public Key lên `appDataFolder` của Google Drive và kích hoạt yêu cầu thiết lập bảo mật Sinh trắc học.
* **Màn hình 1.2 – Khóa Sinh trắc học (App Lock):**
  * Hiển thị biểu tượng Vân tay/Face ID lớn ở trung tâm với thông báo: *"Xác nhận danh tính để mở SafeMess"* kèm tùy chọn nhập Mã PIN dự phòng.

### 2. Màn hình Chính (Main Home Screen) – 3 Nút Chức Năng Độc Lập
Màn hình chính hiển thị danh sách **Thẻ Thành Viên (Family Cards)** kích thước lớn. Mỗi thẻ cung cấp **3 nút bấm độc lập, tách biệt hoàn toàn** giúp người dùng chọn đúng nhu cầu chỉ với 1 lần chạm:

```text
┌──────────────────────────────────────────────────────────┐
│  🛡️ SafeMess                             [ ➕ Thêm ]      │
├──────────────────────────────────────────────────────────┤
│  Trạng thái: 🟢 An toàn (P2P Sẵn sàng)                   │
│──────────────────────────────────────────────────────────│
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  |  📸 [Ảnh Bố]  BỐ RỘT - 🟢 Đang online              |  │
│  |                                                    |  │
│  |  [ 📞 THOẠI ]     [ 📹 CAMERA ]     [ 💬 NHẮN TIN ]|  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  |  📸 [Ảnh Mẹ]  MẸ RỘT - ⚪ Ngoại tuyến              |  │
│  |                                                    |  │
│  |  [ 🔔 KHẨN ]      [ 📹 CAMERA ]     [ 💬 NHẮN TIN ]|  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

* **`[ 📞 THOẠI ]` / `[ 🔔 KHẨN ]`:** Khởi tạo ngay cuộc gọi âm thanh P2P nếu đối phương đang trực tuyến (🟢), hoặc tự động chuyển thành nút **Gọi Khẩn** phát chuông báo động đánh thức thiết bị nếu đối phương đang ngoại tuyến (⚪).
* **`[ 📹 CAMERA ]`:** Mở thẳng cuộc gọi Video P2P kèm lớp bảo vệ Watermark động.
* **`[ 💬 NHẮN TIN ]`:** Mở khung chat P2P hiển thị một chiều tự hủy.

### 3. Màn hình Thêm Thành Viên (Add Member / Pairing)
* Gồm 2 thẻ chuyển đổi: **`Tab 1: Mã QR của tôi`** (hiển thị mã QR chứa Public Key cá nhân) và **`Tab 2: Quét mã người thân`** (mở khung camera quét mã).
* Hai thiết bị chỉ cần quét mã **một lần duy nhất** để trao đổi khóa công khai và lưu tự động vào Google Drive ẩn.

### 4. Màn hình Cuộc Gọi Thoại & Video (Voice & Video Call Screen)

#### Giao diện Cuộc Gọi Thoại (Voice Call)
```text
┌──────────────────────────────────────────────────────────┐
│ 🛡️ SafeMess - THOẠI BẢO MẬT P2P (Mã hoá E2EE)            │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                   📸 [ Ảnh Đại Diện Bố ]                 │
│                        02:45                             │
│                                                          │
│  ------------------------------------------------------  │
│  CHỌN KIỂU GIỌNG NÓI BẢO MẬT (LUÔN BẬT):                 │
│  ┌──────────────────┬──────────────────┬──────────────┐  │
│  │  🐻 GIỌNG TRẦM   │  🤡 HOẠT HÌNH    │ 🤖 ROBOT     │  │
│  │   (Mặc định)     │                  │              │  │
│  └──────────────────┴──────────────────┴──────────────┘  │
│  ------------------------------------------------------  │
│                                                          │
│   [ 🔇 Tắt Mic ]    [ 🔴 NGẮT GỌI ]    [ 📷 BẬT CAMERA ] │
└──────────────────────────────────────────────────────────┘
```

* **Chuyển kiểu giọng 1-Chạm:** Tính năng đổi giọng luôn bật (Always-On). Người dùng chọn 1 trong 3 sắc thái âm thanh dễ nghe nhất (`Giọng Trầm`, `Hoạt Hình`, `Robot`) để bộ xử lý DSP thay đổi tần số tức thì.
* **Nâng cấp phiên gọi mượt mà:** Bấm **`[ 📷 BẬT CAMERA ]`** để chuyển thẳng từ gọi Thoại sang gọi Video mà không làm ngắt kết nối P2P hiện tại.

#### Giao diện Cuộc Gọi Video (Video Call)
```text
┌──────────────────────────────────────────────────────────┐
│ 🛡️ SafeMess - VIDEO BẢO MẬT P2P                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                  [ DẤU BẢN QUYỀN ĐỘNG ]                   │
│            "SafeMess - ĐANG XEM: BỐ RỘT"                 │
│             (Chạy nhảy ngẫu nhiên màn hình)               │
│                                                          │
│                  📸 [ KHUNG VIDEO BỐ ]                   │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  |  Đổi giọng: [ 🐻 Trầm ]  [ 🤡 Hoạt Hình ]  [ 🤖 Robot ]│  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│   [ 🔄 Đổi Cam ]    [ 🔴 NGẮT GỌI ]    [ 📷 TẮT CAMERA ] │
└──────────────────────────────────────────────────────────┘
```

* Tích hợp sẵn cờ `FLAG_SECURE` chống quay/chụp màn hình, Watermark động chạy ngẫu nhiên, nút **`[ 🔄 Đổi Cam ]`** (trước/sau) và nút **`[ 📷 TẮT CAMERA ]`** để hạ phiên gọi về chế độ Thoại tiết kiệm băng thông.
* Bấm **`[ 🔴 NGẮT GỌI ]`** sẽ kích hoạt ngay lệnh `RAM Wipe` xóa sạch khóa phiên và dữ liệu đệm.

### 5. Màn hình Nhắn Tin Một Chiều (Asymmetric Chat Screen)
```text
┌──────────────────────────────────────────────────────────┐
│ 🛡️ SafeMess Chat với CON CẢ   [ 🗑️ Xóa & Thoát ]         │
├──────────────────────────────────────────────────────────┤
│  ⚠️ LƯU Ý: Tin nhắn sẽ tự hủy sạch khi đóng khung        │
│──────────────────────────────────────────────────────────│
│                                                          │
│  ┌─────────────────────────────┐                         │
│  | [Con Cả]: Mẹ ơi con mới     |                         │
│  | chuyển tiền cho Mẹ rồi nhé  |  (Tin nhận)             │
│  └─────────────────────────────┘                         │
│                                                          │
│                       ┌───────────────────────┐          │
│                       |  ✔️ Đã gửi            |          │
│                       |  (Nội dung đã ẩn)     |          │
│                       └───────────────────────┘          │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ [ Soạn tin nhắn...                 ]  [ 📤 GỬI ]         │
└──────────────────────────────────────────────────────────┘
```

* Tin nhắn gửi đi sẽ hiển thị đầy đủ bên máy người nhận, nhưng trên máy người gửi sẽ biến thành nhãn **`✔️ Đã gửi (Nội dung đã ẩn)`** sau 3 giây.
* Bấm **`[ 🗑️ Xóa & Thoát ]`** hoặc thoát màn hình sẽ kích hoạt `RAM Wipe`, xóa vĩnh viễn 100% lịch sử phiên chat.

---

## VI. LỘ TRÌNH THỰC HIỆN DỰ ÁN (ROADMAP)

1. **Giai đoạn 1 – Nền tảng Định danh & Đồng bộ:** Xây dựng luồng Đăng nhập Google OAuth và kết nối đọc/ghi mã hóa vào thư mục ẩn `appDataFolder` trên Google Drive.
2. **Giai đoạn 2 – Lõi Mạng Ngang Hàng (Rust + WebRTC):** Thiết lập luồng bắt tay P2P WebRTC sử dụng One-Time Ticket giữa các thiết bị (Mobile – Mobile và Mobile – Desktop).
3. **Giai đoạn 3 – Bảo mật Lớp Ngoại:** Tích hợp xác thực Sinh trắc học Native (Vân tay / Face ID / PIN) khi khởi chạy và quay lại ứng dụng.
4. **Giai đoạn 4 – Xử lý Media & Chống Truy Vết:** Lập trình module biến đổi tần số giọng nói (Pitch Shift DSP) bằng Rust, tích hợp cờ chặn chụp màn hình (`FLAG_SECURE`) và Watermark động.
5. **Giai đoạn 5 – Nhắn tin Một Chiều & Hủy Dữ Liệu:** Hoàn thiện cơ chế Asymmetric Text và quy trình dọn dẹp bộ nhớ RAM (`RAM Wipe`) khi ngắt phiên.
6. **Giai đoạn 6 – Tối ưu UI/UX 1-Chạm:** Tinh chỉnh giao diện 3 nút độc lập (Thoại / Camera / Nhắn tin) và bộ chọn 3 sắc thái giọng nói trực quan.
7. **Giai đoạn 7 – Đóng gói & Kiểm thử Xâm nhập:** Biên dịch và đóng gói bộ cài đặt cho Android (`.apk`), iOS (`.ipa`), Windows (`.exe`), macOS (`.dmg`) và Linux; tiến hành kiểm thử thực tế khả năng chống giả mạo và rò rỉ dữ liệu.
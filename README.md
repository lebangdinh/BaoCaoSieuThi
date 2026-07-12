# Thi Đua Siêu Thị Pro V6

Tool HTML nội bộ để quản lý thi đua, doanh thu, KPI/PUSH, xếp hạng nhân viên và xuất ảnh báo cáo.

## Cách dùng nhanh

1. Mở `index.html` bằng Chrome hoặc Edge.
2. Vào tab **Import dữ liệu**.
3. Dán dữ liệu BI vào các ô tương ứng.
4. Bấm **Lưu & tính lại**.
5. Xem Dashboard, BXH nhân viên, Chi tiết nhân viên, Thi đua theo siêu thị.
6. Dùng nút xuất ảnh để gửi báo cáo.

## Đưa lên GitHub Pages

Khuyến nghị dùng repository **Private** vì tool có thể chứa link BI nội bộ và dữ liệu nghiệp vụ.

Các bước:

1. Tạo repository mới trên GitHub, ví dụ `thidua-pro`.
2. Upload toàn bộ file trong thư mục này.
3. Vào **Settings → Pages**.
4. Source: chọn **Deploy from a branch**.
5. Branch: chọn `main` và thư mục `/root`.
6. Bấm Save.
7. GitHub sẽ tạo link dạng:

```text
https://<username>.github.io/thidua-pro/
```

## Lưu ý bảo mật

- Không nên để repo Public nếu còn link BI nội bộ hoặc dữ liệu nhân viên.
- Nếu cần Public, hãy xóa dữ liệu mẫu và link nội bộ trước khi upload.
- Dữ liệu nhập trong tool được lưu tại trình duyệt bằng LocalStorage của máy đang sử dụng.

## Backup dữ liệu

Trước khi thay file phiên bản mới, hãy xuất/backup dữ liệu trong tool nếu đã có dữ liệu quan trọng.

## Phiên bản

- V6 Pro Links: có link truy vấn nhanh, BXH card, xuất ảnh theo siêu thị, import dữ liệu.

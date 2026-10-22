# Đóng góp vào video-assets

## Quy tắc vàng: không sửa tay

`assets/` và `index/` **chỉ do Asset Engine ghi**. Mọi hình vào, ra, đổi đều đi qua nó, vì nó là nơi làm sạch SVG, kiểm giấy phép và tính `assetId` (băm nội dung). Sửa tay sẽ làm `manifest.json`, băm và `index/` lệch nhau, CI `verify` báo đỏ.

| Việc | Lệnh (trong `asset-engine/`) |
|---|---|
| Lấy hình cho brief | `resolve` |
| Nạp hàng loạt | `seed` |
| Chọn/biến thể | `select` |
| Dọn hình không dùng | `gc --apply` |
| Sinh lại chỉ mục | `publish-index --assets ../video-assets --out ../video-assets/index --tag vYYYY.MM.DD-N` |

Xem `asset-engine/docs/CONTRACT.md` và `CDN-PLAN.md`.

## Việc được sửa tay

`README.md`, `CONTRIBUTING.md`, `.github/`, `tools/`, `monitor/`.

## Quy ước commit

- Commit sửa `assets/` hoặc `index/` kèm trailer cuối thông điệp: `Asset-Engine: <phiên bản hoặc tag index>` (ví dụ `Asset-Engine: v2026.10.21-2`).
- Tách commit: một commit cho `assets/` (+ manifest), một commit cho `index/` sinh từ nó.
- `tools/verify.mjs` cảnh báo (không chặn) commit trong PR thiếu trailer; lịch sử cũ không bị viết lại.

## Kiểm cục bộ

```
node tools/verify.mjs                  # toàn kho (~1 giây)
node tools/verify.mjs --changed origin/master   # chỉ tệp đổi
node tools/verify.mjs --strict         # cảnh báo cũng làm thoát mã 1
```

## Việc chủ kho cần bật trong Settings (không tự động hoá)

1. Settings > Branches > Add branch ruleset (hoặc protection rule) cho `master`: Require a pull request; Require status checks: chọn `verify`; Require review from Code Owners; Block force pushes. (Nhánh `monitor` để ngoài quy tắc, workflow `cdn-monitor` cần đẩy vào đó.)
2. Settings > Actions > General: Workflow permissions = Read repository contents (đã khai báo trong từng workflow).
3. Nếu agent/Asset Engine đẩy thẳng lên `master`: thêm người dùng/app đó vào danh sách bypass của ruleset, hoặc chuyển sang đẩy nhánh + PR.

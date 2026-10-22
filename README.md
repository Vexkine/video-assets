# video-assets: kho hình của hệ thống video

Kho hình do Asset Engine (C) resolve: icon, sơ đồ, ảnh. **Nằm ngoài repo `video-engine`** để repo mã không phình theo số hình. Khi render, Video Engine chỉ chép (hardlink) những hình mà brief thực sự dùng vào một thư mục tạm.

## Bố cục

```
video-assets/
├── .gitattributes     ảnh jpg/png/webp đi qua Git LFS (svg và manifest.json là văn bản, lưu thường)
└── assets/
    ├── manifest.json  assetId -> { file: "assets/<id>.<đuôi>", class, license, ... }  (schema: asset-engine/docs/manifest.schema.json)
    └── <assetId>.<svg|jpg|png|webp>
```

Bố cục `assets/` giữ y như `video-engine/public/assets/` trước đây (mục `file` tính tương đối với thư mục cha của `assets/`), nên mã resolve, attribution và manifest không đổi.

## Dùng chung cho cả nhóm (3 người)

1. Cài Git LFS một lần: `brew install git-lfs && git lfs install`.
2. Clone **cạnh** hai repo kia, cùng thư mục cha:
   ```
   video-create-workflow/
   ├── asset-engine/  video-engine/  video-assets/
   ```
   Đặt cạnh nhau thì không cần cấu hình gì (mặc định `../video-assets/assets` tính từ mỗi repo).
3. Nếu đặt chỗ khác: `export ASSETS_DIR=/đường/dẫn/video-assets/assets` (cả shell chạy `asset-engine` lẫn `video-engine`).
4. Đồng bộ: `git pull` trước khi làm; sau khi resolve hình mới, `git add assets && git commit && git push`. `manifest.json` là một tệp chung, nên hai người cùng resolve rồi push dễ xung đột: pull trước, nếu xung đột thì gộp tay hai khối JSON (mỗi assetId là một khối độc lập, giữ cả hai).
5. Remote: chưa có. Người quản trị tạo repo riêng (GitHub/GitLab có hỗ trợ LFS) rồi `git remote add origin ... && git push -u origin main`.

## Dọn kho

`cd asset-engine && npm run cli -- gc` liệt kê hình không brief nào trong `video-engine/briefs/` dùng; thêm `--apply` mới xoá. Xem `asset-engine/docs/CONTRACT.md`.

## Giám sát CDN

Workflow `.github/workflows/cdn-monitor.yml` chạy **mỗi 3 giờ** (và tay: `gh workflow run cdn-monitor.yml`) trên runner GitHub. `monitor/probe.mjs` (Node 20+, không phụ thuộc gói) đo 3 nguồn: `raw.githubusercontent.com`, jsDelivr `@master`, jsDelivr ghim `@<commit>`; mỗi nguồn: 40 hình ngẫu nhiên (lần đầu, rồi lần hai đã nóng) và lưới 60 hình tải lười 6 luồng; kèm kiểm `index/release.json` nếu đã có. Ngưỡng đạt: lỗi < 1%, không timeout, p95 TTFB < 1,5 s ở lần nóng; vượt ngưỡng thì job báo đỏ.

- Kết quả nằm ở nhánh **`monitor`**, tệp `data/YYYY-MM.jsonl` (mỗi lần chạy một dòng JSON). **Nhánh này là dữ liệu dùng một lần: lịch sử có thể bị xoá hoặc viết lại bất cứ lúc nào, đừng dựa vào nó như bản ghi vĩnh viễn.** Workflow không lưu bí mật nào, chỉ dùng `GITHUB_TOKEN` mặc định với `contents: write`.
- Đọc báo cáo: `node monitor/report.mjs --fetch --since 2026-10-21` (lấy `data/` từ nhánh `monitor` qua git), hoặc `node monitor/report.mjs <thư-mục-hoặc-tệp.jsonl>`. Bảng theo nguồn: số mẫu, tỉ lệ lỗi, 404, timeout, p50/p95, tỉ lệ cache HIT; tổng, theo ngày, theo giờ (UTC). `--phase first|warm|grid` lọc theo pha.
- Chạy cục bộ: `node monitor/probe.mjs --pretty` (thoát mã 1 nếu vượt ngưỡng).
- Bản fork bỏ qua workflow.

## Chỉ mục tìm kiếm (`index/`)

`index/` là chỉ mục **sinh tự động** để truy vấn trực tiếp từ CDN tĩnh, không cần máy chủ: `release.json` (con trỏ: phiên bản, `commit` của kho hình, đếm, kích thước và băm từng tệp), `meta/<hh>.json` (256 phân mảnh: loại, màu, giấy phép, dung lượng, nguồn, từ khoá), `search/<tt>.json` (chỉ mục ngược theo 2 ký tự đầu của token đã bỏ dấu), `collections/<từ-khoá>.json`, `concepts.vi.json` (từ điển Việt→Anh), `attribution/<hh>.json` (đoạn ghi công và giấy phép nguyên văn của hình CC-BY). **Không sửa tay.** Sinh lại bằng `cd asset-engine && npx tsx src/cli.ts publish-index --assets ../video-assets --out ../video-assets/index --tag vYYYY.MM.DD-N`, rồi commit chỉ `index/`; cùng đầu vào cho cùng byte. Truy vấn thử: `npx tsx src/cli.ts cdn-search "tế bào" --class icon`. Định dạng: `asset-engine/docs/CONTRACT.md`, thiết kế: `asset-engine/docs/CDN-PLAN.md`. Ảnh JPEG nằm ở Git LFS nên `raw`/jsDelivr chỉ trả tệp con trỏ; chỉ mục vẫn liệt kê chúng.

## Không sửa tay

`assets/` và `index/` **chỉ do Asset Engine ghi** (`resolve`, `seed`, `select`, `gc`, `publish-index`); sửa tay làm manifest, băm và chỉ mục lệch nhau. Quy ước commit, CODEOWNERS và hướng dẫn bật bảo vệ nhánh: `CONTRIBUTING.md`.

## Kiểm nhất quán (CI `verify`)

`node tools/verify.mjs` (Node 20+, không phụ thuộc gói, ~1 giây cho 8.000+ tệp) kiểm: manifest khớp tệp (không thiếu, không mồ côi, tên tệp = `<assetId>.<đuôi>`); giấy phép thuộc allowlist, không SA/NC/ND/GPL, CC-BY phải có attribution; **băm**: `assetId` = 8 ký tự đầu sha256 của *nội dung tệp* (svg, kể cả diagram đã gắn id lớp; ảnh thì băm ảnh thật hoặc `oid` của con trỏ LFS); an toàn SVG (không `<script`, `on*=`, `javascript:`, `<foreignObject`, `<image`, `<!ENTITY`, `href` ra ngoài, < 30 MB); `index/` khớp `release.json` (băm, kích thước, phân mảnh `hh`, id mồ côi/thiếu, `counts`); cảnh báo ảnh còn là con trỏ LFS và commit sửa `assets/`/`index/` thiếu trailer `Asset-Engine:`. `--changed <base>` chỉ kiểm tệp đổi, `--strict` coi cảnh báo là lỗi. Workflow `.github/workflows/verify.yml` chạy trên PR và push `master`, kết quả ở Job Summary. Đây là lớp phòng thủ của kho; lõi đồng bộ index nằm ở Asset Engine.

## Ảnh (Git LFS) qua CDN

Ảnh jpg/png/webp lưu bằng Git LFS (xem `.gitattributes`), nên `raw.githubusercontent.com` và jsDelivr **chỉ trả tệp con trỏ** (`version https://git-lfs.github.com/spec/v1`), không phải ảnh. Cách phục vụ ảnh: `https://media.githubusercontent.com/media/Vexkine/video-assets/<commit-hoặc-master>/assets/<assetId>.jpg`. Giới hạn: đây là điểm cuối LFS của GitHub, **không phải CDN công cộng được đảm bảo**; chịu hạn mức băng thông LFS của tổ chức (gói miễn phí 1 GB/tháng cho lưu trữ và băng thông), vượt thì trả lỗi 403/ bị khoá đến kỳ sau; không có `Cache-Control` dài như jsDelivr; không ghim bất biến bằng tag ở jsDelivr được. Hiện kho chỉ có 12 ảnh; nếu ảnh nhiều lên, cân nhắc bỏ LFS cho ảnh nhỏ (< vài trăm KB) để jsDelivr phục vụ trực tiếp, hoặc chuyển ảnh sang kho đối tượng. `verify` cảnh báo `[lfs]` cho từng ảnh để nhắc giới hạn này.

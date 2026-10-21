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

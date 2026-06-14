#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Deploy Suirobo Skill Factory to Walrus Sites
#
# Yêu cầu:
#   - site-builder CLI 2.8+ (Walgo đã cài: ~/.walgo/bin/site-builder)
#   - Ví Sui có WAL token (Walgo: 51 WAL available)
#   - Network: mainnet
#
# Cách dùng:
#   ./deploy-walrus.sh publish        # Lần đầu — tạo site mới
#   ./deploy-walrus.sh update <ID>    # Cập nhật site đã có
# ─────────────────────────────────────────────────────────────────────────────

set -e

# Đảm bảo site-builder trong PATH
export PATH="$HOME/.walgo/bin:$PATH"

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$PROJECT_DIR/dist"
EPOCHS="${EPOCHS:-60}"  # ~60 ngày, sửa qua biến môi trường nếu muốn

# ─── 1. Build app ──────────────────────────────────────────────────────────────
echo "📦 Building Suirobo app..."
cd "$PROJECT_DIR"
npm run build

if [ ! -f "$DIST_DIR/index.html" ]; then
  echo "❌ Build thất bại — không thấy dist/index.html"
  exit 1
fi

# ─── 2. Tạo ws-resources.json nếu chưa có ─────────────────────────────────────
if [ ! -f "$DIST_DIR/ws-resources.json" ]; then
  echo "⚠️  Đang tạo ws-resources.json mặc định cho SPA routing..."
  cat > "$DIST_DIR/ws-resources.json" <<'EOF'
{
  "routes": { "/*": "/index.html" },
  "metadata": { "name": "Suirobo Skill Factory" }
}
EOF
fi

# ─── 3. Publish hoặc Update ──────────────────────────────────────────────────
ACTION="${1:-publish}"
SITE_ID="$2"

case "$ACTION" in
  publish)
    echo "🚀 Publishing site mới to Walrus (epochs=$EPOCHS)..."
    site-builder publish "$DIST_DIR" --epochs "$EPOCHS"
    echo ""
    echo "✅ Hoàn thành! Lưu Site Object ID từ output bên trên."
    echo "   URL: https://<base36-id>.wal.app"
    ;;
  update)
    if [ -z "$SITE_ID" ]; then
      echo "❌ Cần Site Object ID. Dùng: $0 update <SITE_ID>"
      exit 1
    fi
    echo "🔄 Updating site $SITE_ID (epochs=$EPOCHS)..."
    site-builder update "$DIST_DIR" --site-id "$SITE_ID" --epochs "$EPOCHS"
    echo "✅ Đã cập nhật! URL giữ nguyên."
    ;;
  sitemap)
    if [ -z "$SITE_ID" ]; then
      echo "❌ Cần Site Object ID. Dùng: $0 sitemap <SITE_ID>"
      exit 1
    fi
    site-builder sitemap "$SITE_ID"
    ;;
  *)
    echo "Cách dùng: $0 [publish|update <ID>|sitemap <ID>]"
    exit 1
    ;;
esac

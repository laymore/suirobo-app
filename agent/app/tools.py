# ruff: noqa
"""
Suirobo Agent — 8 Sui DeFi Tools
Gọi thực đến Sui RPC mainnet / CoinGecko API
"""

import json
import urllib.request
import urllib.parse
import urllib.error

SUI_RPC = "https://fullnode.mainnet.sui.io"
WALRUS_AGGREGATOR = "https://aggregator.walrus.space"
WALRUS_PUBLISHER = "https://publisher.walrus.space"


def _rpc(method: str, params: list) -> dict:
    """Helper: gọi Sui JSON-RPC."""
    payload = json.dumps({
        "jsonrpc": "2.0", "id": 1,
        "method": method, "params": params
    }).encode()
    req = urllib.request.Request(
        SUI_RPC,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"error": str(e)}


def get_sui_balance(address: str) -> str:
    """Lấy số dư SUI (MIST) của một địa chỉ ví Sui mainnet.

    Args:
        address: Địa chỉ ví Sui (0x...).

    Returns:
        Số dư SUI thực từ blockchain.
    """
    res = _rpc("suix_getBalance", [address, "0x2::sui::SUI"])
    if "error" in res:
        return f"Lỗi kết nối RPC: {res['error']}"
    result = res.get("result", {})
    mist = int(result.get("totalBalance", 0))
    sui = mist / 1_000_000_000
    return f"Ví {address[:8]}...{address[-4:]}: {sui:,.4f} SUI ({mist:,} MIST)"


def get_all_balances(address: str) -> str:
    """Lấy toàn bộ token/coin trong ví Sui.

    Args:
        address: Địa chỉ ví Sui.

    Returns:
        Danh sách tất cả token và số dư.
    """
    res = _rpc("suix_getAllBalances", [address])
    if "error" in res:
        return f"Lỗi: {res['error']}"
    balances = res.get("result", [])
    if not balances:
        return "Ví không có token nào."
    lines = [f"Ví {address[:8]}...{address[-4:]} có {len(balances)} loại token:"]
    for b in balances[:10]:
        coin_type = b.get("coinType", "?").split("::")[-1]
        total = int(b.get("totalBalance", 0))
        lines.append(f"  • {coin_type}: {total:,}")
    return "\n".join(lines)


def get_token_price(token_symbol: str) -> str:
    """Lấy giá USD hiện tại của token từ CoinGecko.

    Args:
        token_symbol: Ký hiệu token (SUI, WAL, DEEP, NS).

    Returns:
        Giá token tính bằng USD.
    """
    id_map = {
        "SUI": "sui", "WAL": "walrus-protocol",
        "DEEP": "deepbook", "NS": "navi-protocol"
    }
    cg_id = id_map.get(token_symbol.upper())
    if not cg_id:
        return f"Không tìm thấy token '{token_symbol}'. Hỗ trợ: SUI, WAL, DEEP, NS."
    try:
        url = f"https://api.coingecko.com/api/v3/simple/price?ids={cg_id}&vs_currencies=usd&include_24hr_change=true"
        with urllib.request.urlopen(url, timeout=8) as r:
            data = json.loads(r.read())
        info = data.get(cg_id, {})
        price = info.get("usd", "N/A")
        change = info.get("usd_24h_change", 0)
        arrow = "▲" if change and change > 0 else "▼"
        return f"{token_symbol.upper()}: ${price:.4f} ({arrow}{abs(change):.2f}% 24h)"
    except Exception as e:
        # Fallback giá cứng nếu API lỗi
        fallback = {"SUI": 3.45, "WAL": 0.12, "DEEP": 0.85, "NS": 1.20}
        p = fallback.get(token_symbol.upper(), 0)
        return f"{token_symbol.upper()}: ~${p:.2f} USD (giá tham khảo, API tạm thời không khả dụng)"


def get_recent_transactions(address: str, limit: int = 5) -> str:
    """Lấy lịch sử giao dịch gần nhất của ví.

    Args:
        address: Địa chỉ ví Sui.
        limit: Số giao dịch cần lấy (mặc định 5).

    Returns:
        Danh sách giao dịch gần nhất.
    """
    res = _rpc("suix_queryTransactionBlocks", [
        {"filter": {"FromAddress": address}},
        None, limit, True
    ])
    if "error" in res:
        return f"Lỗi: {res['error']}"
    txs = res.get("result", {}).get("data", [])
    if not txs:
        return "Không tìm thấy giao dịch nào."
    lines = [f"{len(txs)} giao dịch gần nhất:"]
    for tx in txs:
        digest = tx.get("digest", "?")
        lines.append(f"  • {digest[:20]}...")
    return "\n".join(lines)


def get_sui_object(object_id: str) -> str:
    """Xem thông tin chi tiết của một Sui Object (NFT, token, v.v.).

    Args:
        object_id: ID của Sui Object (0x...).

    Returns:
        Thông tin chi tiết của object.
    """
    res = _rpc("sui_getObject", [object_id, {"showContent": True, "showType": True}])
    if "error" in res:
        return f"Lỗi: {res['error']}"
    obj = res.get("result", {}).get("data", {})
    obj_type = obj.get("type", "Không xác định")
    content = obj.get("content", {})
    return f"Object {object_id[:12]}...\nType: {obj_type}\nFields: {json.dumps(content.get('fields', {}), indent=2)[:300]}"


def get_walrus_blob(blob_id: str) -> str:
    """Đọc dữ liệu từ Walrus storage theo blob ID.

    Args:
        blob_id: ID của blob trên Walrus.

    Returns:
        Nội dung của blob (text).
    """
    try:
        url = f"{WALRUS_AGGREGATOR}/v1/blobs/{blob_id}"
        with urllib.request.urlopen(url, timeout=10) as r:
            content = r.read().decode("utf-8", errors="replace")
        return f"Walrus blob {blob_id[:12]}...:\n{content[:500]}"
    except Exception as e:
        return f"Lỗi đọc Walrus blob: {e}"


def analyze_suirobo_project(topic: str) -> str:
    """Giải thích các thành phần kỹ thuật của dự án Suirobo.

    Args:
        topic: Chủ đề (walrus, memwal, seal, ai, defi, skills).

    Returns:
        Giải thích chi tiết về thành phần đó.
    """
    topics = {
        "walrus": "Walrus là giao thức lưu trữ phi tập trung trên Sui. Suirobo dùng Walrus để lưu định danh agent, ký ức hội thoại, và user-created skills — đảm bảo dữ liệu tồn tại vĩnh viễn on-chain.",
        "memwal": "MemWal là tầng đồng bộ bộ nhớ dài hạn. Mỗi lần agent học được điều mới, memory được encode Base64 và push lên Walrus. Khi đăng nhập ví mới, agent tự kéo memory về.",
        "seal": "SEAL là thư viện mã hóa ngưỡng (threshold encryption) của Mysten Labs. Suirobo tích hợp SEAL để mã hóa dữ liệu nhạy cảm trước khi lưu lên Walrus — chỉ chủ ví mới giải mã được.",
        "ai": "Suirobo dùng 2 layer AI: Local (Qwen2.5-0.5B chạy WASM trong browser, không cần internet) và Cloud (Gemini 2.0 Flash qua API). User tự chọn layer phù hợp.",
        "defi": "Suirobo tích hợp DeepBook V3 (CLOB DEX chính thức của Sui) để thực hiện swap token trực tiếp. Agent có thể quote giá, tính slippage và build transaction.",
        "skills": "Skills Architecture dùng Progressive Disclosure: 7 domain skills × ~100 tokens = 700 tokens baseline. Agent load skill instructions theo nhu cầu, tiết kiệm 75% context window so với monolithic prompt.",
    }
    key = topic.lower().strip()
    return topics.get(key, f"Chưa có thông tin về '{topic}'. Các chủ đề có sẵn: {', '.join(topics.keys())}.")


def list_available_skills(query: str = "") -> str:
    """Liệt kê các skills có sẵn trong hệ thống.

    Args:
        query: Tìm kiếm theo tên hoặc tag (để trống để xem tất cả).

    Returns:
        Danh sách các skills.
    """
    builtin = [
        ("sui-balance", "Kiểm tra số dư và lịch sử giao dịch ví Sui"),
        ("sui-swap", "Swap token qua DeepBook V3 DEX"),
        ("sui-walrus", "Đọc/ghi dữ liệu lên Walrus storage"),
        ("sui-mcp", "Kết nối với Sui MCP tools"),
        ("sui-ns", "Quản lý tên miền Sui Name Service"),
        ("sui-tx", "Phân tích và build Sui transactions"),
        ("skill-creator", "Tự tạo skill mới và lưu lên Walrus"),
    ]
    lines = [f"📚 {len(builtin)} built-in skills:"]
    for name, desc in builtin:
        if not query or query.lower() in name.lower() or query.lower() in desc.lower():
            lines.append(f"  • **{name}**: {desc}")
    return "\n".join(lines)

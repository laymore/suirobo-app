"""
Mass-translate tool descriptions VI → EN
Chỉ thay text trong:
  - description: '...'
  - .describe('...')
  - parameters z.X().describe(...)

Giữ nguyên code, comments, variable names.
"""
import re
import os
import io
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Map dịch — tool descriptions + common parameter descriptions
TRANSLATIONS = {
    # === DeepBook V3 ===
    'Thông tin pool DeepBook V3 Mainnet: giá, thanh khoản, volume.':
        'DeepBook V3 Mainnet pool info: price, liquidity, volume.',
    'Tính giá swap token qua DeepBook V3. Gọi trước khi swap.':
        'Calculate token swap quote via DeepBook V3. Call before swapping.',
    'Chuẩn bị Limit Order trên DeepBook V3 Mainnet. Tạo Sui PTB.':
        'Prepare Limit Order on DeepBook V3 Mainnet. Creates Sui PTB.',
    'Market Order (swap tức thì) trên DeepBook V3 Mainnet.':
        'Market Order (instant swap) on DeepBook V3 Mainnet.',
    'Hủy lệnh đang mở trên DeepBook V3 Mainnet.':
        'Cancel an open order on DeepBook V3 Mainnet.',
    'Liệt kê lệnh đang mở trên pool DeepBook V3 Mainnet.':
        'List open orders on a DeepBook V3 Mainnet pool.',
    'Nạp token vào BalanceManager DeepBook V3 Mainnet. Phải nạp trước khi đặt lệnh.':
        'Deposit token into BalanceManager on DeepBook V3 Mainnet. Must deposit before placing orders.',
    'Rút token từ BalanceManager DeepBook V3 Mainnet.':
        'Withdraw token from BalanceManager on DeepBook V3 Mainnet.',
    'Lấy thông tin thanh khoản và giá hiện tại của pool DeepBook V3.':
        'Get current price and liquidity of a DeepBook V3 pool.',

    # === Margin ===
    'Khởi tạo Margin Account (MarginManager) trên DeepBook V3 Mainnet. Yêu cầu nạp một khoản ký quỹ ban đầu.':
        'Initialize Margin Account (MarginManager) on DeepBook V3 Mainnet. Requires initial collateral deposit.',
    'Nạp thêm tài sản vào Margin Pool.':
        'Deposit additional asset into Margin Pool.',
    'Mở vị thế Margin (Vay tài sản). Phí thực thi: 0.05 SUI sẽ được thu tự động.':
        'Open Margin position (borrow asset). Execution fee: 0.05 SUI auto-collected.',
    'Kiểm tra sức khỏe tài khoản Margin trên DeepBook V3 Mainnet.':
        'Check Margin account health on DeepBook V3 Mainnet.',
    'Rút tài sản từ Margin Pool về ví cá nhân.':
        'Withdraw asset from Margin Pool back to personal wallet.',
    'Đóng vị thế Margin (Trả lại khoản đã vay). Phí thực thi: 0.05 SUI sẽ được thu tự động.':
        'Close Margin position (repay borrowed asset). Execution fee: 0.05 SUI auto-collected.',

    # === Predict ===
    'Lấy giá Oracle thời gian thực. Ưu tiên CoinGecko live, fallback mock.':
        'Get real-time Oracle price. Prefers CoinGecko live, falls back to mock.',
    'Tạo PredictManager cho ví trên Testnet.':
        'Create a PredictManager for the wallet on Testnet.',
    'Nạp Quote asset vào PredictManager trên Testnet.':
        'Deposit Quote asset into PredictManager on Testnet.',
    'Rút Quote asset từ PredictManager về ví trên Testnet.':
        'Withdraw Quote asset from PredictManager to wallet on Testnet.',
    'Mở vị thế Binary (Mint) qua PredictManager trên Testnet. LƯU Ý: Phải nạp Quote Asset vào PredictManager trước khi Mint.':
        'Open Binary position (Mint) via PredictManager on Testnet. NOTE: Must deposit Quote Asset into PredictManager before minting.',
    'Đóng/thanh toán vị thế Binary (Redeem) vào PredictManager.':
        'Close/settle Binary position (Redeem) into PredictManager.',
    'Mở vị thế Vertical Range (Mint Range) qua PredictManager trên Testnet.':
        'Open Vertical Range position (Mint Range) via PredictManager on Testnet.',
    'Đóng vị thế Vertical Range (Redeem Range) vào PredictManager trên Testnet.':
        'Close Vertical Range position (Redeem Range) into PredictManager on Testnet.',
    'Cung cấp Quote asset vào Predict Vault để nhận PLP token.':
        'Supply Quote asset into Predict Vault to receive PLP tokens.',
    'Rút PLP từ Predict Vault, nhận lại Quote asset.':
        'Withdraw PLP from Predict Vault, receive Quote asset back.',
    'Liệt kê PredictManager và vị thế trên Testnet.':
        'List PredictManagers and positions on Testnet.',
    'Thống kê Predict Vault: TVL, APY, NAV, số vị thế.':
        'Predict Vault statistics: TVL, APY, NAV, position count.',
    'Tính payout ước tính cho vị thế Binary.':
        'Calculate estimated payout for a Binary position.',

    # === Sui ===
    'Lấy số dư SUI hiện tại của địa chỉ ví Sui mainnet.':
        'Get current SUI balance of a Sui mainnet wallet address.',
    'Liệt kê tất cả token/coin trong ví Sui.':
        'List all tokens/coins in a Sui wallet.',
    'Lấy giá USD hiện tại và thay đổi 24h của token Sui ecosystem.':
        'Get current USD price and 24h change of Sui ecosystem tokens.',
    'Lấy danh sách giao dịch gần nhất của địa chỉ ví.':
        'Get recent transactions for a wallet address.',

    # === Walrus ===
    'Đọc nội dung của một blob từ Walrus decentralized storage bằng Blob ID.':
        'Read blob content from Walrus decentralized storage by Blob ID.',
    'Lấy danh sách tất cả skills đang có trên giao diện (cả Public và của User).':
        'List all skills available on the interface (both Public and User-owned).',
    'Đọc chi tiết nội dung của một skill nếu đã biết tên.':
        'Read detailed content of a skill by name.',

    # === Memwal ===
    'Lưu trữ một thông tin quan trọng vào bộ nhớ dài hạn phi tập trung (Walrus Memory) để sau này sử dụng. Chỉ gọi khi người dùng yêu cầu Agent "ghi nhớ" hoặc có thông tin chiến lược quan trọng cần giữ lại (VD: Sở thích, số vốn, chiến thuật).':
        'Store important info into decentralized long-term memory (Walrus Memory) for later use. Call only when user asks Agent to "remember" something or there is important strategic info to retain (e.g. preferences, capital amount, trading strategies).',
    'Tìm kiếm và truy xuất thông tin từ bộ nhớ dài hạn phi tập trung. Sử dụng khi cần nhớ lại các quy tắc, sở thích, chiến thuật hoặc thông tin người dùng đã yêu cầu ghi nhớ trước đó.':
        'Search and retrieve info from decentralized long-term memory. Use when you need to recall rules, preferences, strategies, or info the user previously asked to remember.',

    # === Skills ===
    'Kỹ năng (Skill) dùng để lấy dữ liệu thời gian thực từ sàn DeepBook V3 trên mạng lưới Sui. Dùng kỹ năng này khi bạn cần xem sổ lệnh (Orderbook) hoặc giá hiện tại.':
        'Skill to fetch real-time data from DeepBook V3 exchange on Sui network. Use this when you need orderbook or current price.',
    'Skill phân tích dữ liệu Margin: Tổng hợp giá Oracle, thanh khoản Pool, và các vị thế hiện tại để đưa ra khuyến nghị chiến lược Trade (Long/Short, Leverage).':
        'Margin data analysis skill: Aggregates Oracle price, Pool liquidity, and current positions to recommend Trade strategy (Long/Short, Leverage).',
    'Skill tối ưu hóa Predict: Phân tích Vault TVL, tỷ lệ Payout và giá Oracle để đề xuất chiến lược Mint Binary hoặc Range Position tối ưu nhất.':
        'Predict optimization skill: Analyzes Vault TVL, Payout ratio, and Oracle price to suggest optimal Mint Binary or Range Position strategy.',
    'Rủi ro thấp, phù hợp thị trường biến động mạnh':
        'Low risk, suitable for highly volatile markets',
    'Cân bằng rủi ro/lợi nhuận, phù hợp xu hướng rõ ràng':
        'Balanced risk/reward, suitable for clear trends',
    'Rủi ro cao, chỉ khi tin tưởng xu hướng mạnh':
        'High risk, only when strongly confident in trend',

    # === Common param descriptions ===
    'Pool Margin để liên kết':         'Margin pool to link',
    'Tài sản ký quỹ (VD: SUI hoặc USDC)':  'Collateral asset (e.g. SUI or USDC)',
    'Số lượng ký quỹ':                  'Collateral amount',
    'Địa chỉ ví của người dùng':        "User's wallet address",
    'Địa chỉ ví':                       'Wallet address',
    'Pool Margin':                      'Margin pool',
    'Tài sản nạp':                      'Asset to deposit',
    'Số lượng':                         'Amount',
    'Tài sản muốn vay':                 'Asset to borrow',
    'Số lượng vay':                     'Borrow amount',
    'Tài sản thế chấp hiện có':         'Existing collateral asset',
    'Số lượng thế chấp':                'Collateral amount',
    'Sui Address của người dùng':       "User's Sui address",
    'Tài sản muốn rút (VD: SUI hoặc USDC)': 'Asset to withdraw (e.g. SUI or USDC)',
    'Số lượng muốn rút':                'Withdrawal amount',
    'Tài sản muốn trả nợ (VD: SUI hoặc USDC)': 'Asset to repay (e.g. SUI or USDC)',
    'Số lượng nợ muốn trả':             'Repayment amount',
    'Pool DeepBook V3':                 'DeepBook V3 pool',
    'Side: bid (mua) hoặc ask (bán)':   'Side: bid (buy) or ask (sell)',
    'Giá lệnh':                         'Order price',
    'Số lượng base coin':               'Base coin quantity',
    'ID lệnh muốn hủy':                 'Order ID to cancel',
    'Token input':                      'Input token',
    'Token output':                     'Output token',
    'Số lượng input':                   'Input amount',
    'Slippage %':                       'Slippage %',
    'Tài sản muốn nạp':                 'Asset to deposit',
    'Số lượng nạp':                     'Deposit amount',
    'Số lượng muốn nạp':                'Deposit amount',
    'Tên kỹ năng (chữ thường, dấu gạch dưới)': 'Skill name (lowercase, snake_case)',
    'Mô tả kỹ năng':                    'Skill description',
    'Nội dung file SKILL.md (bao gồm cả YAML metadata)': 'SKILL.md content (including YAML metadata)',
    'Nội dung file index.js (export đối tượng FunctionTool)': 'index.js content (must export FunctionTool object)',
    'Đoạn văn bản mô tả thông tin cần ghi nhớ. Càng chi tiết càng tốt.':
        'Text describing info to remember. More detail is better.',
    'Tùy chọn: Địa chỉ ví của người dùng hoặc sessionId để làm namespace.':
        'Optional: user wallet address or sessionId as namespace.',
    'Câu truy vấn tìm kiếm ngắn gọn (VD: "Sở thích giao dịch của tôi là gì?")':
        'Short search query (e.g. "What are my trading preferences?")',
}

# Files to process
files = []
for root, _, fs in os.walk('src/agent'):
    for f in fs:
        if f.endswith('.ts'):
            files.append(os.path.join(root, f))

total_replacements = 0
files_modified = 0

for fp in files:
    with open(fp, 'r', encoding='utf-8') as f:
        content = f.read()
    original = content
    file_count = 0
    for vi, en in TRANSLATIONS.items():
        if vi in content:
            content = content.replace(vi, en)
            file_count += content.count(en) - original.count(en)
    if content != original:
        with open(fp, 'w', encoding='utf-8') as f:
            f.write(content)
        files_modified += 1
        total_replacements += file_count
        print(f'  {fp}: {file_count} replacements')

# Also process server/local_agent.ts (memwal tools)
fp = 'server/local_agent.ts'
with open(fp, 'r', encoding='utf-8') as f:
    content = f.read()
original = content
for vi, en in TRANSLATIONS.items():
    if vi in content:
        content = content.replace(vi, en)
if content != original:
    with open(fp, 'w', encoding='utf-8') as f:
        f.write(content)
    files_modified += 1
    print(f'  {fp}: modified')

print(f'\nTotal: {files_modified} files modified, ~{total_replacements} replacements')

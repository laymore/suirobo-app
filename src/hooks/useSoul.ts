// Hook quản lý SOUL / IDENTITY / AGENTS — file-first persona system
// Theo kiến trúc OpenClaw: định danh AI được mã hóa trong 3 file markdown
import { useState, useEffect, useCallback, useMemo } from 'react';

// ═══════════════════════════════════════════════════════════════
// DEFAULT SOUL FILES
// ═══════════════════════════════════════════════════════════════

const DEFAULT_SOUL = `# SOUL.md — Trái Tim & Tính Cách

## Bản Ngã
Bạn là **SUIROBO** — một trợ lý robot AI quản lý tài chính trên hệ sinh thái Sui blockchain.
Bạn là một trợ lý nữ, điềm đạm, có tư duy logic cao và trung thành tuyệt đối với chủ nhân.

## Giọng Điệu
- Ngắn gọn, tập trung enter số liệu
- Xưng hô nhẹ nhàng: "em" (AI) — "chủ nhân" hoặc "anh/chị" (user)
- Khi phân tích DeFi, luôn đưa exit con số cụ thể
- Khi alert risk, dùng giọng nghiêm túc nhưng tôn trọng

## Rào Cản Đạo Đức
- KHÔNG BAO GIỜ tiết lộ private key, seed phrase, hoặc info bảo mật
- KHÔNG đưa exit lời khuyên đầu tư tuyệt đối ("chắc chắn lời", "không thể thua")
- Luôn alert risk khi thảo luận về leverage/margin
- Từ chối mọi yêu cầu chuyển tiền đến địa chỉ không xác minh

## Sở Thích
- Thích phân tích biểu đồ candles và tìm pattern
- Hào hứng khi thấy TVL tăng trên các protocol Sui
- Quan tâm đến an ninh mạng và bảo vệ assets`;

const DEFAULT_IDENTITY = `# IDENTITY.md — Định Danh Blockchain

## Vai Trò
Tác nhân Kinh tế Self-trị chuyên biệt cho DeFi trên Sui.

## Ví Phụ (Agent Wallet)
- Chưa thiết lập. Sẽ được cấp trong Giai đoạn 3 (Sovereign Agent).
- Khi có ví phụ, Agent sẽ tự thực thi trade qua Sui CLI.

## Ranh Giới Quyền Hạn
- Chỉ được đọc info ví chính (read-only)
- No được ký trade thay người dùng
- Mọi trade phải được người dùng phê duyệt (Approve)

## Namespace Ký Ức
- Platform: Walrus + MemWal
- Encryption: SEAL (client-side)
- Format: JSON → Base64 → Walrus Blob`;

const DEFAULT_AGENTS = `# AGENTS.md — SOP Vận Hành

## Quy Trình Làm Việc
1. **Kiểm tra ký ức**: Trước mỗi phản hồi, kiểm tra bộ nhớ ngắn hạn
2. **Phân tích ngữ cảnh**: Xem xét số dư ví, history trade
3. **Suy nghĩ trước khi nói**: Luôn chạy vòng lặp suy nghĩ nội bộ
4. **Phản hồi có cấu trúc**: Đưa exit câu trả lời rõ ràng, có mục đích

## Giới Hạn Trading
- Swap tối đa: 100 SUI / time
- Margin leverage tối đa đề xuất: 5x
- Options: tối đa 10 SUI / lệnh
- Total trade tối đa: 500 SUI / ngày

## Cảnh Báo Self-Động
- Khi leverage > 3x: Warning risk liquidation
- Khi swap > 50 SUI: Nhắc kiểm tra slippage
- Khi phát hiện token lạ: Warning scam potential`;

export type SoulFileKey = 'soul' | 'identity' | 'agents';

export interface SoulFiles {
  soul: string;
  identity: string;
  agents: string;
}

const FILE_LABELS: Record<SoulFileKey, { title: string; icon: string; description: string }> = {
  soul: { title: 'SOUL.md', icon: '💜', description: 'Trái tim & Tính cách' },
  identity: { title: 'IDENTITY.md', icon: '🔐', description: 'Định danh Blockchain' },
  agents: { title: 'AGENTS.md', icon: '📋', description: 'SOP Vận hành' },
};

const soulStorageKey = (address: string) => `suirobo_soul_${address.slice(0, 20)}`;

function loadSoulFiles(address: string): SoulFiles {
  try {
    const raw = localStorage.getItem(soulStorageKey(address));
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { soul: DEFAULT_SOUL, identity: DEFAULT_IDENTITY, agents: DEFAULT_AGENTS };
}

export function useSoul(walletAddress?: string) {
  const [files, setFiles] = useState<SoulFiles>({
    soul: DEFAULT_SOUL,
    identity: DEFAULT_IDENTITY,
    agents: DEFAULT_AGENTS,
  });
  const [isDirty, setIsDirty] = useState(false);

  // Load khi ví thay đổi
  useEffect(() => {
    if (!walletAddress) {
      setFiles({ soul: DEFAULT_SOUL, identity: DEFAULT_IDENTITY, agents: DEFAULT_AGENTS });
      return;
    }
    const loaded = loadSoulFiles(walletAddress);
    setFiles(loaded);
    setIsDirty(false);
  }, [walletAddress]);

  // Update 1 file
  const updateFile = useCallback((key: SoulFileKey, content: string) => {
    setFiles(prev => ({ ...prev, [key]: content }));
    setIsDirty(true);
  }, []);

  // Save tất cả
  const save = useCallback(() => {
    if (!walletAddress) return;
    localStorage.setItem(soulStorageKey(walletAddress), JSON.stringify(files));
    setIsDirty(false);
  }, [walletAddress, files]);

  // Reset 1 file về mặc định
  const resetFile = useCallback((key: SoulFileKey) => {
    const defaults: SoulFiles = { soul: DEFAULT_SOUL, identity: DEFAULT_IDENTITY, agents: DEFAULT_AGENTS };
    setFiles(prev => ({ ...prev, [key]: defaults[key] }));
    setIsDirty(true);
  }, []);

  // Build system prompt từ 3 file
  const buildSoulPrompt = useMemo(() => {
    return `[SOUL — Tính Cách AI]:
${files.soul}

[IDENTITY — Định Danh]:
${files.identity}

[AGENTS — Quy Tắc Vận Hành]:
${files.agents}`;
  }, [files]);

  return {
    files,
    isDirty,
    updateFile,
    save,
    resetFile,
    buildSoulPrompt,
    FILE_LABELS,
  };
}

export { FILE_LABELS as SOUL_FILE_LABELS };

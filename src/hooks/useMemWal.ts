// MemWal hook — bộ nhớ gắn với địa chỉ ví Sui đang đăng nhập
// Mỗi ví có namespace riêng: memories không bị lẫn giữa các ví
import { useCallback, useState, useEffect } from 'react';

const RELAYER_URL = 'https://relayer.memwal.ai';

// MemWal account dùng để thanh toán phí lưu trữ Walrus
// (không phải ví của người dùng — đây là service account)
const SERVICE_ACCOUNT_ID = '0x4e0943960eb0a40d951f51f8f54f7a67bc787828b0331a6db2014f45dcb667ed';
const SERVICE_PRIVATE_KEY = '7db5fa15773a46e857e4661bc189372f20bf0266155df2f56402999c0d073fa7';

export interface Memory {
  id: string;
  content: string;
  timestamp: number;
  type: 'conversation' | 'wallet' | 'system';
  walletAddress?: string; // địa chỉ ví chủ sở hữu
}

// Key localStorage theo địa chỉ ví — mỗi ví có vùng nhớ riêng
const storageKey = (address: string) => `suirobo_memories_${address.slice(0, 20)}`;

function loadFromLocal(walletAddress: string): Memory[] {
  try {
    const raw = localStorage.getItem(storageKey(walletAddress));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveToLocal(walletAddress: string, memories: Memory[]) {
  try {
    localStorage.setItem(storageKey(walletAddress), JSON.stringify(memories.slice(0, 50)));
  } catch { /* localStorage full */ }
}

export function useMemWal(walletAddress?: string) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [walrusStatus, setWalrusStatus] = useState<'idle' | 'ok' | 'error'>('idle');

  // Tải memories từ localStorage khi ví thay đổi
  useEffect(() => {
    if (!walletAddress) {
      setMemories([]); // Ngắt ví → xóa memories khỏi UI
      return;
    }
    const local = loadFromLocal(walletAddress);
    setMemories(local);

    // Thử sync từ Walrus (nền)
    syncFromWalrus(walletAddress).catch(() => {});
  }, [walletAddress]);

  // Sync bộ nhớ từ Walrus về — merge với local
  const syncFromWalrus = async (address: string) => {
    try {
      const response = await fetch(`${RELAYER_URL}/list?t=${Date.now()}`, {
        headers: {
          'X-Account-Id': SERVICE_ACCOUNT_ID,
          'X-Private-Key': SERVICE_PRIVATE_KEY,
          'X-Wallet-Namespace': address, // namespace theo ví
        },
      });
      if (response.ok) {
        const data = await response.json();
        const decodedMemories = (data.memories || []).map((item: any) => {
          try {
            if (item.data && typeof item.data === 'string') {
              const decoded = JSON.parse(decodeURIComponent(atob(item.data)));
              return { ...item, ...decoded };
            }
          } catch { /* ignore parse error */ }
          return item;
        });
        const remoteMemories: Memory[] = decodedMemories
          .filter((m: Memory) => m.walletAddress === address); // chỉ lấy của ví này
        if (remoteMemories.length > 0) {
          setMemories(prev => {
            // Merge: ưu tiên remote, tránh duplicate theo id
            const merged = [...remoteMemories, ...prev]
              .filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i)
              .sort((a, b) => b.timestamp - a.timestamp)
              .slice(0, 50);
            saveToLocal(address, merged);
            return merged;
          });
        }
        setWalrusStatus('ok');
      }
    } catch {
      setWalrusStatus('error');
    }
  };

  const saveMemory = useCallback(async (
    content: string,
    type: Memory['type'] = 'conversation'
  ) => {
    if (!walletAddress) return; // Không lưu nếu chưa kết nối ví

    setIsSaving(true);
    const memory: Memory = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      content,
      timestamp: Date.now(),
      type,
      walletAddress, // đánh dấu ví chủ sở hữu
    };

    // 1. Lưu local ngay (offline-first)
    setMemories(prev => {
      const updated = [memory, ...prev].slice(0, 50);
      saveToLocal(walletAddress, updated);
      return updated;
    });

    // 2. Đẩy lên Walrus (background, có thể fail)
    try {
      const response = await fetch(`${RELAYER_URL}/store`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Account-Id': SERVICE_ACCOUNT_ID,
          'X-Private-Key': SERVICE_PRIVATE_KEY,
          'X-Wallet-Namespace': walletAddress,
        },
        body: JSON.stringify({
          data: btoa(encodeURIComponent(JSON.stringify(memory))),
          epochs: 10,
          tags: { wallet: walletAddress, type },
        }),
      });
      if (response.ok) {
        const result = await response.json();
        console.log('[MemWal] Saved to Walrus, blob:', result.blobId);
        setWalrusStatus('ok');
      }
    } catch {
      // Không throw — local đã lưu rồi, Walrus chỉ là sync
      setWalrusStatus('error');
    } finally {
      setIsSaving(false);
    }

    return memory;
  }, [walletAddress]);

  const clearMemories = useCallback(() => {
    if (!walletAddress) return;
    setMemories([]);
    localStorage.removeItem(storageKey(walletAddress));
  }, [walletAddress]);

  return {
    memories,
    isSaving,
    walrusStatus,
    saveMemory,
    clearMemories,
    totalCount: memories.length,
    isConnected: !!walletAddress,
  };
}

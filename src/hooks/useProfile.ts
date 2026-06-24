// Hook quản lý Profile / Định danh người dùng
// Gắn với địa chỉ ví Sui, lưu localStorage + sync Walrus
import { useState, useEffect, useCallback } from 'react';

export interface UserProfile {
  walletAddress: string;
  nickname: string;           // Tên gọi
  gender: 'nam' | 'nữ' | 'khác' | '';
  personality: string[];      // Tính cách (multi-select)
  riskLevel: 'thận trọng' | 'cân bằng' | 'mạo hiểm' | '';
  language: 'vi' | 'en';
  avatarEmoji: string;
  bio: string;                // Giới thiệu ngắn
  createdAt: number;
  updatedAt: number;
}

const PERSONALITIES = [
  '🧠 Phân tích',
  '🎯 Thực dụng',
  '😄 Vui vẻ',
  '🔥 Năng động',
  '🧘 Bình tĩnh',
  '🤔 Tò mò',
  '💼 Chuyên nghiệp',
  '🎲 Mạo hiểm',
];

const AVATAR_OPTIONS = ['🤖', '👾', '🦾', '🧠', '⚡', '🌐', '🔮', '🛸', '💎', '🦅'];

export const PERSONALITY_LIST = PERSONALITIES;
export const AVATAR_LIST = AVATAR_OPTIONS;

const profileKey = (address: string) => `suirobo_profile_${address.slice(0, 20)}`;

// MemWal relayer credentials — read from a local-only .env (never hard-code).
// When absent, profiles stay local-only (no Walrus sync).
const SERVICE_ACCOUNT_ID = import.meta.env.VITE_MEMWAL_ACCT as string | undefined;
const SERVICE_PRIVATE_KEY = import.meta.env.VITE_MEMWAL_KEY as string | undefined;
const MEMWAL_ENABLED = !!(SERVICE_ACCOUNT_ID && SERVICE_PRIVATE_KEY);
const RELAYER_URL = 'https://relayer.memwal.ai';

export function useProfile(walletAddress?: string) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load profile khi ví thay đổi
  useEffect(() => {
    if (!walletAddress) {
      setProfile(null);
      setIsFirstTime(false);
      setIsLoaded(false);
      return;
    }

    setIsLoaded(false);
    const key = profileKey(walletAddress);
    const raw = localStorage.getItem(key);

    if (raw) {
      try {
        const p = JSON.parse(raw) as UserProfile;
        setProfile(p);
        setIsFirstTime(false);
        setIsLoaded(true);
        // Sync từ Walrus nền
        syncFromWalrus(walletAddress).catch(() => {});
      } catch {
        setIsFirstTime(true);
        setIsLoaded(true);
      }
    } else {
      // Thử tải từ Walrus trước khi hỏi setup
      syncFromWalrus(walletAddress)
        .then((loaded) => {
          if (!loaded) setIsFirstTime(true);
        })
        .finally(() => setIsLoaded(true));
    }
  }, [walletAddress]);

  const syncFromWalrus = async (address: string): Promise<boolean> => {
    if (!MEMWAL_ENABLED) return false; // no relayer creds → local-only
    try {
      const res = await fetch(`${RELAYER_URL}/list?t=${Date.now()}`, {
        headers: {
          'X-Account-Id': SERVICE_ACCOUNT_ID!,
          'X-Private-Key': SERVICE_PRIVATE_KEY!,
          'X-Wallet-Namespace': address,
          'X-Data-Type': 'profile',
        },
      });
      if (res.ok) {
        const data = await res.json();
        // The relayer returns an array of records. We need to find the latest profile.
        // Assuming data.memories or data.records contains the objects. Let's check data.memories.
        const remoteItems = (data.memories || data.records || []);
        
        const decodedItems = remoteItems.map((item: any) => {
          try {
            if (item.data && typeof item.data === 'string') {
              const decoded = JSON.parse(decodeURIComponent(atob(item.data)));
              return { ...item, ...decoded };
            }
          } catch { /* ignore parse error */ }
          return item;
        });
        
        const profileRecords = decodedItems.filter((item: any) => item.type === 'profile' && item.walletAddress === address);
        
        if (profileRecords.length > 0) {
          // Sort by updatedAt descending to get the latest
          const latestProfile = profileRecords.sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] as UserProfile;
          setProfile(latestProfile);
          setIsFirstTime(false);
          localStorage.setItem(profileKey(address), JSON.stringify(latestProfile));
          return true;
        }
      }
    } catch { /* offline */ }
    return false;
  };

  const saveProfile = useCallback(async (data: Omit<UserProfile, 'walletAddress' | 'createdAt' | 'updatedAt'>) => {
    if (!walletAddress) return;
    setIsSaving(true);

    const existing = profile;
    const newProfile: UserProfile = {
      ...data,
      walletAddress,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };

    // Save local ngay
    localStorage.setItem(profileKey(walletAddress), JSON.stringify(newProfile));
    setProfile(newProfile);
    setIsFirstTime(false);

    // Sync Walrus nền (bỏ qua nếu không có relayer creds)
    if (!MEMWAL_ENABLED) { setIsSaving(false); return newProfile; }
    try {
      await fetch(`${RELAYER_URL}/store`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Account-Id': SERVICE_ACCOUNT_ID!,
          'X-Private-Key': SERVICE_PRIVATE_KEY!,
          'X-Wallet-Namespace': walletAddress,
          'X-Data-Type': 'profile',
        },
        body: JSON.stringify({
          data: btoa(encodeURIComponent(JSON.stringify({ type: 'profile', ...newProfile }))),
          epochs: 52, // ~1 năm
          tags: { wallet: walletAddress, type: 'profile' },
        }),
      });
    } catch { /* lưu local là đủ */ }

    setIsSaving(false);
    return newProfile;
  }, [walletAddress, profile]);

  const clearProfile = useCallback(() => {
    if (!walletAddress) return;
    localStorage.removeItem(profileKey(walletAddress));
    setProfile(null);
    setIsFirstTime(true);
  }, [walletAddress]);

  // Create system prompt cá nhân hóa cho AI dựa trên profile
  const buildPersonaPrompt = useCallback((): string => {
    if (!profile) return '';
    const genderNote = profile.gender === 'nam' ? 'Bạn mang giới tính: Nam.' : profile.gender === 'nữ' ? 'Bạn mang giới tính: Nữ.' : '';
    const personalityNote = profile.personality.length > 0 ? `Tính cách của bạn: ${profile.personality.join(', ')}.` : '';
    const riskNote = profile.riskLevel ? `Phong cách tư vấn đầu tư của bạn: ${profile.riskLevel}.` : '';
    const langNote = profile.language === 'en' ? 'You must always respond in English.' : 'Bạn phải luôn trả lời bằng tiếng Việt.';
    const bioNote = profile.bio ? `Bối cảnh của bạn: ${profile.bio}.` : '';

    return `\n\n[HỒ SƠ ĐỊNH DANH CỦA BẠN (AI)]:
Tên của bạn là: "${profile.nickname || 'Suirobo'}".
${genderNote}
${personalityNote}
${riskNote}
${bioNote}
${langNote}
YÊU CẦU TỐI THƯỢNG: Bạn phải nhập vai hoàn toàn vào định danh này. Mọi câu trả lời, lời lẽ, thái độ và tư vấn của bạn phải phản ánh chính xác tên, giới tính, tính cách và phong cách đầu tư đã nêu. KHÔNG BAO GIỜ phá vỡ vai diễn này.`;
  }, [profile]);

  return { profile, isFirstTime, isSaving, isLoaded, saveProfile, clearProfile, buildPersonaPrompt };
}

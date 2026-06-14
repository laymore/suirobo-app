import { useState, useEffect, useCallback } from 'react';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const LOCAL_WALLET_KEY = 'suirobo_local_wallet_secret';

export function useLocalWallet() {
  const [localKeypair, setLocalKeypair] = useState<Ed25519Keypair | null>(null);
  const [localAddress, setLocalAddress] = useState<string | null>(null);

  // Khôi phục ví từ localStorage khi load
  useEffect(() => {
    const savedSecret = localStorage.getItem(LOCAL_WALLET_KEY);
    if (savedSecret) {
      try {
        const keypair = Ed25519Keypair.fromSecretKey(savedSecret);
        setLocalKeypair(keypair);
        setLocalAddress(keypair.toSuiAddress());
      } catch (e) {
        console.error('Error khi khôi phục Ví Local:', e);
        localStorage.removeItem(LOCAL_WALLET_KEY);
      }
    }
  }, []);

  // Create ví mới
  const generateNewWallet = useCallback(() => {
    const newKeypair = new Ed25519Keypair();
    const secretKey = newKeypair.getSecretKey();
    localStorage.setItem(LOCAL_WALLET_KEY, secretKey);
    setLocalKeypair(newKeypair);
    setLocalAddress(newKeypair.toSuiAddress());
    return newKeypair;
  }, []);

  // Delete ví
  const clearWallet = useCallback(() => {
    localStorage.removeItem(LOCAL_WALLET_KEY);
    setLocalKeypair(null);
    setLocalAddress(null);
  }, []);

  return {
    localKeypair,
    localAddress,
    generateNewWallet,
    clearWallet,
  };
}

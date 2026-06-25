/**
 * AccountStrip — compact, read-only "account at a glance" bar for the desktop header.
 *
 * Shows the trading wallet + its SUI/USDC DeepBook margin account, refreshed every
 * 20s. Everything here is READ-ONLY on-chain (getBalance + the margin-manager bag);
 * it never signs, so it works on desktop (agent-signed, no browser wallet) exactly
 * the same as it would with a connected wallet.
 *
 * Address resolution (desktop has no browser wallet):
 *   1. connected browser wallet (web)              → useCurrentAccount()
 *   2. the live bot's configured trading address   → GET /api/livebot/state .config.walletAddress
 *   3. the agent's local wallet                     → GET /api/dev/wallet .address
 *
 * Margin numbers reuse the exact production-tested path from LiveTradeDashboard:
 *   getMarginManagerIdsForOwner → pickBestSuiUsdcManager → getMarginManagerDetail.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useCurrentAccount, useSuiClient } from '@mysten/dapp-kit';
import { DeepBookClient } from '@mysten/deepbook-v3';
import { getMarginManagerDetail, pickBestSuiUsdcManager } from '../utils/marginDetail';
import { AGENT_URL } from '../agent/agentUrl';

const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

interface Acct {
  sui: number;       // wallet gas SUI
  usdc: number;      // wallet spendable USDC
  mUsdc: number;     // margin collateral USDC (total valuation)
  mSui: number;      // margin collateral SUI (total valuation)
  freeUsdc: number;  // liquid / withdrawable USDC
  hasDebt: boolean;
  hasMargin: boolean;
}

const Cell: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.18 }}>
    <span style={{ fontSize: '0.52rem', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
    <span style={{ fontSize: '0.72rem', color: color || '#cbd5e1', fontFamily: 'monospace', fontWeight: 600 }}>{value}</span>
  </span>
);

const Divider = () => <span style={{ width: 1, height: 22, background: '#1e293b', flexShrink: 0 }} />;

export const AccountStrip: React.FC = () => {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const [addr, setAddr] = useState<string | null>(null);
  const [data, setData] = useState<Acct | null>(null);

  // Resolve the address: browser wallet → live-bot config → agent local wallet.
  useEffect(() => {
    let alive = true;
    if (account?.address) { setAddr(account.address); return; }
    (async () => {
      try {
        const st = await fetch(`${AGENT_URL}/api/livebot/state`).then(r => r.json());
        if (alive && st?.config?.walletAddress) { setAddr(st.config.walletAddress); return; }
      } catch { /* agent offline → try next */ }
      try {
        const dw = await fetch(`${AGENT_URL}/api/dev/wallet`).then(r => r.json());
        if (alive && dw?.address) setAddr(dw.address);
      } catch { /* no agent wallet → strip stays hidden */ }
    })();
    return () => { alive = false; };
  }, [account?.address]);

  const refresh = useCallback(async () => {
    if (!addr) { setData(null); return; }
    try {
      const [suiBal, usdcBal] = await Promise.all([
        suiClient.getBalance({ owner: addr }),                      // SUI (gas)
        suiClient.getBalance({ owner: addr, coinType: USDC_TYPE }), // USDC
      ]);
      const sui  = Number(suiBal.totalBalance || 0) / 1e9;
      const usdc = Number(usdcBal.totalBalance || 0) / 1e6;

      let mUsdc = 0, mSui = 0, freeUsdc = 0, hasDebt = false, hasMargin = false;
      try {
        const discover = new DeepBookClient({ client: suiClient as any, network: 'mainnet', address: addr });
        const ids = await discover.getMarginManagerIdsForOwner(addr);
        if (ids.length) {
          const mk = await pickBestSuiUsdcManager(suiClient, ids);
          if (mk) {
            const db = new DeepBookClient({
              client: suiClient as any, network: 'mainnet', address: addr,
              marginManagers: { [mk]: { marginManagerKey: mk, address: mk, poolKey: 'SUI_USDC' } } as any,
            });
            const d = await getMarginManagerDetail(suiClient, db, mk);
            mUsdc = d.totalUsdc; mSui = d.totalSui;
            freeUsdc = d.withdrawableUsdc;
            hasDebt = d.debtBaseShares > 0n || d.debtQuoteShares > 0n;
            hasMargin = true;
          }
        }
      } catch { /* margin read failed (indexer lag) → leave zeros, retry next tick */ }

      setData({ sui, usdc, mUsdc, mSui, freeUsdc, hasDebt, hasMargin });
    } catch {
      setData(null);
    }
  }, [addr, suiClient]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!addr) return null;

  return (
    <div style={{
      background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8,
      padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'nowrap',
    }}>
      <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontFamily: 'monospace' }}>
        💎 {addr.slice(0, 6)}…{addr.slice(-4)}
      </span>
      <Divider />
      <Cell label="Wallet" value={`${data ? data.sui.toFixed(2) : '—'} SUI`} color="#00d4ff" />
      <Cell label="USDC" value={data ? data.usdc.toFixed(2) : '—'} />
      <Divider />
      {data?.hasMargin ? (
        <>
          <Cell label="Margin" value={`${data.mUsdc.toFixed(2)} USDC`} />
          <Cell label="+ SUI" value={data.mSui.toFixed(2)} />
          <Cell label="Free" value={`${data.freeUsdc.toFixed(2)} USDC`} color="#22c55e" />
          <span style={{
            fontSize: '0.58rem', fontWeight: 700, padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap',
            background: data.hasDebt ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.10)',
            color: data.hasDebt ? '#f59e0b' : '#22c55e',
          }}>{data.hasDebt ? '⚠ Borrowed' : '● No debt'}</span>
        </>
      ) : (
        <Cell label="Margin" value="No account" color="#475569" />
      )}
      <span style={{ color: '#22c55e', fontSize: '0.6rem', whiteSpace: 'nowrap' }}>● Mainnet</span>
    </div>
  );
};

export default AccountStrip;

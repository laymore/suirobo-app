// DEV-ONLY test panel — validates the bot's new swap-based margin logic with a
// real wallet signature (read the tx in your wallet, click Approve/Reject).
// Mirrors directOpen/directClose in server/live_trade_agent.ts exactly.
// Reach it at:  <app-url>/?devmargintest=1
import { useState, useCallback, useEffect } from 'react';
import { useCurrentAccount, useSuiClient, useSignTransaction, ConnectButton } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { DeepBookClient } from '@mysten/deepbook-v3';
import { usePythOracle } from '../hooks/usePythOracle';
import { getMarginManagerDetail, pickBestSuiUsdcManager } from '../utils/marginDetail';

type Side = 'LONG' | 'SHORT';

export default function DevMarginTest() {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signTx } = useSignTransaction();
  const { fetchAndInjectVAA } = usePythOracle(suiClient as any);

  const [managerKey, setManagerKey] = useState<string>('');
  const [detail, setDetail] = useState<any>(null);
  const [price, setPrice] = useState<number>(0);
  const [size, setSize] = useState<number>(0.5);
  const [side, setSide] = useState<Side>('LONG');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const add = (m: string) => setLog(l => [`${new Date().toLocaleTimeString('en-GB')}  ${m}`, ...l].slice(0, 40));

  const buildDb = useCallback((mk: string) => new DeepBookClient({
    client: suiClient as any, network: 'mainnet', address: account!.address,
    marginManagers: { [mk]: { marginManagerKey: mk, address: mk, poolKey: 'SUI_USDC' } } as any,
  }), [suiClient, account]);

  const refresh = useCallback(async () => {
    if (!account) return;
    try {
      const discover = new DeepBookClient({ client: suiClient as any, network: 'mainnet', address: account.address });
      const ids = await discover.getMarginManagerIdsForOwner(account.address);
      const mk = (await pickBestSuiUsdcManager(suiClient, ids)) || ids[0] || '';
      setManagerKey(mk);
      if (mk) setDetail(await getMarginManagerDetail(suiClient, buildDb(mk), mk));
      const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SUIUSDT');
      setPrice(parseFloat((await r.json()).price));
    } catch (e: any) { add(`refresh error: ${e.message}`); }
  }, [account, suiClient, buildDb]);

  useEffect(() => { refresh(); }, [refresh]);

  const run = async (label: string, build: (tx: Transaction, db: DeepBookClient, mk: string) => Promise<void> | void) => {
    if (!account) return add('Connect wallet first');
    if (!managerKey) return add('No SUI/USDC margin account found');
    setBusy(true);
    try {
      const db = buildDb(managerKey);
      const tx = new Transaction();
      await fetchAndInjectVAA(tx, 'SUI_USDC');   // fresh Pyth first — health checks read it
      await build(tx, db, managerKey);
      add(`${label}: requesting wallet signature…`);
      const signed = await signTx({ transaction: tx });
      const res = await suiClient.executeTransactionBlock({
        transactionBlock: signed.bytes, signature: signed.signature, options: { showEffects: true },
      });
      const st = res.effects?.status?.status;
      if (st === 'success') add(`✅ ${label} OK — ${res.digest}`);
      else throw new Error(res.effects?.status?.error || 'tx failed');
      await refresh();
    } catch (e: any) {
      add(`❌ ${label} failed: ${(e.message || e).toString().slice(0, 180)}`);
    } finally { setBusy(false); }
  };

  const cid = () => Date.now().toString();
  // DeepBook SUI_USDC minimum order = 1 SUI, lot step 0.1.
  const lot = (q: number) => Math.max(1, Math.round(q * 10) / 10);

  const doDeposit = () => run(`deposit ${size} SUI`, (tx, db, mk) => {
    db.marginManager.depositBase({ managerKey: mk, amount: size })(tx);
  });
  const doWithdraw = () => run(`withdraw ${size} SUI`, (tx, db, mk) => {
    const coin = db.marginManager.withdrawBase(mk, size)(tx);
    tx.transferObjects([coin], tx.pure.address(account!.address));
  });
  const doOpen = () => run(`open ${side} ${lot(size)} SUI`, (tx, db, mk) => {
    const qty = lot(size);
    if (side === 'LONG') {
      db.marginManager.borrowQuote(mk, qty * price)(tx);
      db.poolProxy.placeMarketOrder({ poolKey: 'SUI_USDC', marginManagerKey: mk, clientOrderId: cid(), quantity: qty, isBid: true, payWithDeep: false } as any)(tx);
    } else {
      db.marginManager.borrowBase(mk, qty)(tx);
      db.poolProxy.placeMarketOrder({ poolKey: 'SUI_USDC', marginManagerKey: mk, clientOrderId: cid(), quantity: qty, isBid: false, payWithDeep: false } as any)(tx);
    }
  });
  const doClose = () => run(`close ${side}`, async (tx, db, mk) => {
    // Size the closing swap from REAL debt (over-cover) so the repay leaves no
    // dust — a residual opposite-side debt would block the next flip trade.
    let baseDebt = 0, quoteDebt = 0;
    try { const d: any = await (db as any).getMarginManagerDebts(mk); baseDebt = parseFloat(d?.baseDebt ?? '0') || 0; quoteDebt = parseFloat(d?.quoteDebt ?? '0') || 0; } catch {}
    if (side === 'LONG') {
      const qty = lot((quoteDebt / (price || 1)) * 1.5);
      db.poolProxy.placeMarketOrder({ poolKey: 'SUI_USDC', marginManagerKey: mk, clientOrderId: cid(), quantity: qty, isBid: false, payWithDeep: false } as any)(tx);
      db.poolProxy.withdrawSettledAmounts(mk)(tx);
      db.marginManager.repayQuote(mk, undefined as any)(tx);
    } else {
      const qty = lot(baseDebt * 1.05);
      db.poolProxy.placeMarketOrder({ poolKey: 'SUI_USDC', marginManagerKey: mk, clientOrderId: cid(), quantity: qty, isBid: true, payWithDeep: false } as any)(tx);
      db.poolProxy.withdrawSettledAmounts(mk)(tx);
      db.marginManager.repayBase(mk, undefined as any)(tx);
    }
  });

  const B = (txt: string, on: () => void, color: string) => (
    <button disabled={busy} onClick={on} style={{
      padding: '10px 14px', borderRadius: 8, border: 'none', cursor: busy ? 'wait' : 'pointer',
      background: color, color: '#fff', fontWeight: 700, fontSize: '0.85rem', opacity: busy ? 0.5 : 1,
    }}>{txt}</button>
  );

  const q = lot(size);
  const previewLong = side === 'LONG'
    ? `borrow ${(q * price).toFixed(3)} USDC → market-BUY ${q} SUI`
    : `borrow ${q} SUI → market-SELL ${q} SUI`;
  const previewClose = side === 'LONG'
    ? `market-SELL ${q} SUI → withdraw → repay USDC`
    : `market-BUY ${q} SUI → withdraw → repay SUI`;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(2,8,20,0.97)',
      color: '#e2e8f0', fontFamily: "'Inter', sans-serif", padding: 24, overflow: 'auto',
    }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h2 style={{ color: '#00d4ff', margin: '0 0 4px' }}>🤖 Bot Margin Logic — Live Sign Test</h2>
        <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: 0 }}>
          Validates the new swap-based <code>directOpen/directClose</code> with a real wallet signature.
          Read the transaction in your wallet popup, then Approve or Reject. Use tiny size.
        </p>

        {!account && (
          <div style={{ margin: '12px 0' }}>
            <p style={{ color: '#f87171', marginBottom: 8 }}>Connect your wallet to begin:</p>
            <ConnectButton />
          </div>
        )}

        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: 16, margin: '12px 0' }}>
          <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Margin manager</div>
          <div style={{ fontFamily: 'monospace', fontSize: '0.78rem', wordBreak: 'break-all' }}>{managerKey || '—'}</div>
          <div style={{ display: 'flex', gap: 18, marginTop: 10, flexWrap: 'wrap', fontSize: '0.85rem' }}>
            <span>SUI price: <b style={{ color: '#00d4ff' }}>${price.toFixed(4)}</b></span>
            <span>collateral SUI: <b>{detail ? (detail.totalSui || detail.withdrawableSui) : '—'}</b></span>
            <span>debt SUI shares: <b>{detail ? String(detail.debtBaseShares) : '—'}</b></span>
            <span>debt USDC shares: <b>{detail ? String(detail.debtQuoteShares) : '—'}</b></span>
          </div>
          <button onClick={refresh} disabled={busy} style={{ marginTop: 10, padding: '6px 12px', borderRadius: 6, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', cursor: 'pointer' }}>↻ Refresh state</button>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '10px 0', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.85rem' }}>Size (SUI):{' '}
            <input type="number" step="0.1" value={size} onChange={e => setSize(parseFloat(e.target.value) || 0)}
              style={{ width: 80, padding: 6, borderRadius: 6, border: '1px solid #334155', background: '#0a101d', color: '#fff' }} />
          </label>
          <label style={{ fontSize: '0.85rem' }}>Side:{' '}
            <select value={side} onChange={e => setSide(e.target.value as Side)}
              style={{ padding: 6, borderRadius: 6, border: '1px solid #334155', background: '#0a101d', color: '#fff' }}>
              <option>LONG</option><option>SHORT</option>
            </select>
          </label>
        </div>

        <div style={{ background: '#0b1322', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 14px', fontSize: '0.8rem', color: '#cbd5e1', marginBottom: 12 }}>
          <div><b>OPEN {side}</b> → {previewLong}</div>
          <div><b>CLOSE {side}</b> → {previewClose}</div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          {B('1 · Deposit', doDeposit, '#0ea5e9')}
          {B(`2 · Open ${side}`, doOpen, side === 'LONG' ? '#16a34a' : '#dc2626')}
          {B(`3 · Close ${side}`, doClose, '#7c3aed')}
          {B('4 · Withdraw', doWithdraw, '#475569')}
        </div>

        <div style={{ background: '#020814', border: '1px solid #1e293b', borderRadius: 8, padding: 12, fontFamily: 'monospace', fontSize: '0.74rem', maxHeight: 260, overflow: 'auto' }}>
          {log.length === 0 ? <span style={{ color: '#475569' }}>Logs appear here…</span>
            : log.map((l, i) => <div key={i} style={{ color: l.includes('✅') ? '#4ade80' : l.includes('❌') ? '#f87171' : '#cbd5e1' }}>{l}</div>)}
        </div>
        <p style={{ color: '#64748b', fontSize: '0.72rem', marginTop: 10 }}>
          Tip: Deposit → Open → (Refresh, confirm debt appeared) → Close → (Refresh, confirm debt back to 0) → Withdraw.
        </p>
      </div>
    </div>
  );
}

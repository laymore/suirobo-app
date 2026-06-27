/**
 * OrderBookGauge — live DeepBook SUI/USDC order-book imbalance, read on-chain.
 *
 * Surfaces a microstructure signal a CEX-broker EA can't see: which side of the
 * book is heavier (buy vs sell pressure), the spread, and depth. Read-only, every
 * ~15s. Informational for now (the bot still trades on its candle signals);
 * wiring OBI as a live entry filter is the next step (P3-4b).
 */
import React from 'react';
import { useOrderBook } from '../hooks/useOrderBook';

const Cell: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div style={{ textAlign: 'center', background: '#080d1a', borderRadius: 6, padding: '5px 4px' }}>
    <div style={{ fontSize: '0.52rem', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
    <div style={{ fontSize: '0.74rem', fontWeight: 700, color: color || '#cbd5e1', fontFamily: 'monospace' }}>{value}</div>
  </div>
);

const OrderBookGauge: React.FC<{ filterOn?: boolean; onToggleFilter?: () => void }> = ({ filterOn, onToggleFilter }) => {
  const { book } = useOrderBook();
  if (!book) return null;

  const tot = book.bidVol + book.askVol;
  const bidPct = tot > 0 ? (book.bidVol / tot) * 100 : 50;
  const obiPct = Math.round(book.obi * 100);
  const lean = book.obi > 0.12 ? { txt: 'Buy pressure', c: '#22c55e' }
    : book.obi < -0.12 ? { txt: 'Sell pressure', c: '#ef4444' }
    : { txt: 'Balanced', c: '#94a3b8' };

  return (
    <div style={{ padding: '0 12px', marginTop: 8 }}>
      <div style={{ background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 12, padding: 14, margin: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.6rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
            📊 DeepBook order book · on-chain
          </span>
          <span style={{
            fontSize: '0.6rem', fontWeight: 800, padding: '2px 8px', borderRadius: 5,
            background: `${lean.c}1a`, color: lean.c, border: `1px solid ${lean.c}55`,
          }}>{lean.txt} · OBI {obiPct >= 0 ? '+' : ''}{obiPct}%</span>
          {onToggleFilter && (
            <button onClick={onToggleFilter}
              title="When on, the bot only opens LONG when the book is bid-heavy (and SHORT when ask-heavy). Live-only confirmation."
              style={{
                fontSize: '0.58rem', fontWeight: 700, padding: '3px 9px', borderRadius: 5, cursor: 'pointer', marginLeft: 'auto',
                background: filterOn ? 'rgba(139,92,246,0.15)' : 'transparent',
                border: `1px solid ${filterOn ? '#8b5cf6' : '#334155'}`,
                color: filterOn ? '#a78bfa' : '#64748b',
              }}>
              {filterOn ? '✓ Live entry filter ON' : 'Use as entry filter'}
            </button>
          )}
          {!onToggleFilter && <span style={{ fontSize: '0.58rem', color: '#475569', marginLeft: 'auto' }}>SUI/USDC · top 10 levels</span>}
        </div>

        {/* Imbalance bar: green = bid depth, red = ask depth */}
        <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', border: '1px solid #1e293b', marginBottom: 4 }}>
          <div style={{ width: `${bidPct}%`, background: 'linear-gradient(90deg,#065f46,#22c55e)', transition: 'width 0.4s' }} />
          <div style={{ flex: 1, background: 'linear-gradient(90deg,#ef4444,#7f1d1d)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.58rem', fontFamily: 'monospace', marginBottom: 10 }}>
          <span style={{ color: '#22c55e' }}>▲ bids {book.bidVol.toLocaleString('en-US', { maximumFractionDigits: 0 })} SUI</span>
          <span style={{ color: '#ef4444' }}>{book.askVol.toLocaleString('en-US', { maximumFractionDigits: 0 })} SUI asks ▼</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          <Cell label="Best bid" value={`$${book.bestBid.toFixed(4)}`} color="#22c55e" />
          <Cell label="Best ask" value={`$${book.bestAsk.toFixed(4)}`} color="#ef4444" />
          <Cell label="Spread" value={`${book.spreadBps.toFixed(1)} bps`} />
          <Cell label="Mid" value={`$${book.mid.toFixed(4)}`} color="#00d4ff" />
        </div>
      </div>
    </div>
  );
};

export default OrderBookGauge;

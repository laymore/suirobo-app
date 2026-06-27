/**
 * TxConfirmModal — human-in-the-loop trade confirmation popup.
 * Shows a risk warning for Margin / Predict before signing.
 */
import type { PendingTx } from '../hooks/useDeepTradeAgent';

interface Props {
  tx: PendingTx;
  onConfirm: () => void;
  onReject: () => void;
}

const RISK_MESSAGES: Record<string, string> = {
  margin_liquidation:
    '⚠️ This margin position can be LIQUIDATED if the margin ratio falls below the safety threshold (20%). You can lose all assets pledged as collateral.',
  predict_loss:
    '⚠️ Binary options can WIPE OUT your entire stake if the prediction is wrong.',
};

function renderValue(val: any, depth = 0): React.ReactNode {
  if (val === null || val === undefined) return <span style={{ color: '#64748b' }}>—</span>;
  if (typeof val === 'object') {
    return (
      <div style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
        {Object.entries(val).filter(([k]) => !['status', 'is_risky', 'riskType', 'action_required', 'executionFee'].includes(k)).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
            <span style={{ color: '#94a3b8', minWidth: 120, fontSize: '0.78rem' }}>{k}:</span>
            <span style={{ color: '#e2e8f0', fontSize: '0.78rem', wordBreak: 'break-all' }}>
              {typeof v === 'object' ? renderValue(v, depth + 1) : String(v)}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return <span>{String(val)}</span>;
}

export function TxConfirmModal({ tx, onConfirm, onReject }: Props) {
  const riskMsg = tx.riskType ? RISK_MESSAGES[tx.riskType] : null;
  const orderData = tx.order ?? tx.position ?? tx.supply ?? {};

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: '#0f172a', border: '1px solid',
        borderColor: tx.is_risky ? '#ef4444' : '#00d4ff',
        borderRadius: 16, padding: 28, width: '100%', maxWidth: 480,
        boxShadow: `0 0 40px ${tx.is_risky ? 'rgba(239,68,68,0.3)' : 'rgba(77,162,255,0.2)'}`,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <span style={{ fontSize: '1.5rem' }}>{tx.is_risky ? '⚠️' : '🔐'}</span>
          <div>
            <h3 style={{ margin: 0, color: tx.is_risky ? '#ef4444' : '#00d4ff', fontSize: '1rem' }}>
              Confirm trade
            </h3>
            <p style={{ margin: 0, fontSize: '0.72rem', color: '#64748b' }}>
              The agent prepared this order — your signature is required
            </p>
          </div>
        </div>

        {/* Risk Warning */}
        {riskMsg && (
          <div style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: 8, padding: '10px 14px', marginBottom: 16,
            fontSize: '0.8rem', color: '#fca5a5', lineHeight: 1.5,
          }}>
            {riskMsg}
          </div>
        )}

        {/* Execution Fee */}
        {tx.executionFee && (
          <div style={{
            background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: 8, padding: '10px 14px', marginBottom: 16,
            fontSize: '0.8rem', color: '#fbbf24', lineHeight: 1.5,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
          }}>
            <span>💰 Skill marketplace execution fee</span>
            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{tx.executionFee} SUI</span>
          </div>
        )}

        {/* Transaction Details */}
        <div style={{
          background: '#1e293b', borderRadius: 10, padding: '14px 16px',
          marginBottom: 20, maxHeight: 280, overflowY: 'auto',
        }}>
          {renderValue(orderData)}
        </div>

        {/* Action Required */}
        <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: 16, textAlign: 'center' }}>
          {tx.action_required}
        </p>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onConfirm}
            style={{
              flex: 1, padding: '12px', border: 'none', borderRadius: 10,
              background: tx.is_risky
                ? 'linear-gradient(135deg, #dc2626, #b91c1c)'
                : 'linear-gradient(135deg, #00d4ff, #0080ff)',
              color: '#fff', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
            }}
          >
            {tx.is_risky ? '⚠️ Confirm & sign' : '✍️ Sign & send'}
          </button>
          <button
            onClick={onReject}
            style={{
              flex: 1, padding: '12px', borderRadius: 10,
              background: 'transparent', border: '1px solid #334155',
              color: '#94a3b8', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * DEEPTRADE FULL PIPELINE V2 — 6 Skills → Decision Gate → Execute
 * 
 * Pipeline 1 (Margin / Mainnet):
 *   margin_risk_guard → margin_entry_strategist → [GATE] → margin_open_position
 *   → margin_portfolio_guardian (POST-TRADE giám sát)
 *
 * Pipeline 2 (Predict / Testnet):
 *   predict_multi_asset_allocator (Kelly Criterion) → [GATE] → predict_mint (multi-asset)
 *   → predict_position_monitor (POST-TRADE giám sát)
 */

import fetch from 'node-fetch';
import { Transaction } from '@mysten/sui/transactions';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

// Tools
import { marginTools } from '../src/agent/tools/margin.js';
import { predictTools } from '../src/agent/tools/predict.js';

// All 6 Advanced Skills
import { marginRiskGuardSkill } from '../src/agent/skills/margin_risk_guard.js';
import { marginEntryStrategistSkill } from '../src/agent/skills/margin_entry_strategist.js';
import { marginPortfolioGuardianSkill } from '../src/agent/skills/margin_portfolio_guardian.js';
import { predictOpportunityScannerSkill } from '../src/agent/skills/predict_opportunity_scanner.js';
import { predictPositionMonitorSkill } from '../src/agent/skills/predict_position_monitor.js';
import { predictMultiAssetAllocatorSkill } from '../src/agent/skills/predict_multi_asset_allocator.js';

// ── Config ────────────────────────────────────────────────────────────────────
const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || '');
const PRIV_KEY = (process.env.SUIROBO_DEV_WALLET || '');
const parsed   = decodeSuiPrivateKey(PRIV_KEY);
const keypair  = Ed25519Keypair.fromSecretKey(parsed.secretKey);
const address  = keypair.toSuiAddress();

const MAINNET_RPC = 'https://fullnode.mainnet.sui.io';
const TESTNET_RPC = 'https://fullnode.testnet.sui.io';

// Buffer fix for Sui SDK
const origBufferFrom = Buffer.from;
(Buffer as any).from = function(val: any, enc?: any, len?: any) {
  const buf = origBufferFrom(val, enc, len);
  if (buf.byteOffset !== 0 || buf.buffer.byteLength !== buf.byteLength) {
    const clean = new Uint8Array(new ArrayBuffer(buf.length));
    clean.set(buf);
    return origBufferFrom(clean.buffer);
  }
  return buf;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function convertSchema(obj: any): any {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(convertSchema);
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'type' && typeof v === 'string') out[k] = v.toLowerCase();
    else if (['anyOf','allOf','oneOf'].includes(k)) {
      if (Array.isArray(v) && v.length > 0) Object.assign(out, convertSchema(v[0]));
    } else if (['default','nullable','exclusiveMinimum','exclusiveMaximum','$schema'].includes(k)) {
      continue;
    } else { out[k] = convertSchema(v); }
  }
  return out;
}

async function buildSignExecute(
  serializedTxOrBytes: string | Uint8Array,
  rpcUrl: string,
  networkLabel: string
): Promise<string | null> {
  const suiClient = new SuiJsonRpcClient({ url: rpcUrl });
  try {
    let builtBytes: Uint8Array;
    if (typeof serializedTxOrBytes === 'string') {
      const tx = Transaction.from(serializedTxOrBytes);
      tx.setSender(address);
      const gasPrice = await suiClient.getReferenceGasPrice();
      tx.setGasPrice(gasPrice);
      tx.setGasBudget(50_000_000);
      const coins = await suiClient.getCoins({ owner: address, coinType: '0x2::sui::SUI' });
      if (coins.data.length > 0) {
        const c = coins.data[0];
        tx.setGasPayment([{ objectId: c.coinObjectId, version: c.version, digest: c.digest }]);
      }
      builtBytes = await tx.build({ client: suiClient });
    } else {
      builtBytes = serializedTxOrBytes;
    }

    const { signature } = await keypair.signTransaction(builtBytes);
    const txRes = await suiClient.executeTransactionBlock({
      transactionBlock: builtBytes,
      signature,
      options: { showEffects: true }
    });

    console.log(`    ✅ ON-CHAIN SUCCESS: ${txRes.digest}`);
    console.log(`    🔗 https://suivision.xyz/txblock/${txRes.digest}?network=${networkLabel}`);
    return txRes.digest;
  } catch (e: any) {
    console.log(`    ❌ ON-CHAIN FAIL: ${e.message?.split('\n')[0]}`);
    return null;
  }
}

async function runAgentWithTools(
  prompt: string,
  tools: any[],
  rpcUrl: string,
  networkLabel: string
) {
  const toolDefs = tools.map((t: any) => {
    const dec = t._getDeclaration();
    const props = convertSchema(dec.parameters?.properties || {});
    return {
      type: 'function',
      function: {
        name: dec.name,
        description: dec.description,
        parameters: { type: 'object', properties: props, required: dec.parameters?.required || [] }
      }
    };
  });

  const messages: any[] = [
    {
      role: 'system',
      content: 'Bạn là DeepTrade Agent chuyên nghiệp. Hãy sử dụng các Skills phân tích TRƯỚC, đọc kết quả JSON, rồi quyết định có gọi tool thực thi hay không dựa trên shouldExecute và EV. Luôn thực hiện autonomous.'
    },
    { role: 'user', content: prompt }
  ];

  const txList: string[] = [];
  let isDone = false;

  while (!isDone) {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages, tools: toolDefs })
    });
    if (!res.ok) throw new Error(`DeepSeek: ${await res.text()}`);
    const data = await res.json() as any;
    const msg = data.choices[0].message;
    messages.push(msg);

    if (msg.content) console.log(`\n  🤖 Agent: ${msg.content.substring(0, 300)}...`);

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const call of msg.tool_calls) {
        const tool = tools.find(t => t.name === call.function.name);
        if (!tool) continue;
        const args = JSON.parse(call.function.arguments);
        console.log(`\n  🔧 Gọi: ${call.function.name}`);
        console.log(`     Args: ${JSON.stringify(args).substring(0, 200)}`);

        let toolResult: any;
        try {
          toolResult = await (tool as any).runAsync({ args, toolContext: { walletAddress: address } });
        } catch (e: any) {
          toolResult = { error: e.message };
        }

        if (toolResult?.serializedTx) {
          console.log(`     → Phát hiện giao dịch cần ký & gửi...`);
          let txStr = toolResult.serializedTx;
          if (typeof txStr === 'object' && txStr.serializedTx) txStr = txStr.serializedTx;
          const digest = await buildSignExecute(txStr, rpcUrl, networkLabel);
          if (digest) {
            txList.push(digest);
            toolResult._txDigest = digest;
            toolResult._status = 'SUCCESS';
          }
        }

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(toolResult)
        });
      }
    } else {
      isDone = true;
    }
  }

  return txList;
}

// ═══════════════════════════════════════════════════════════
// PIPELINE 1: MARGIN (MAINNET) — 3 Skills → Gate → Execute → Guardian
// ═══════════════════════════════════════════════════════════
async function runMarginPipeline() {
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║  PIPELINE 1: MARGIN SMART TRADING (MAINNET)          ║');
  console.log('║  Skills: risk_guard → entry_strategist → [GATE]      ║');
  console.log('║  Post:   portfolio_guardian (giám sát liên tục)      ║');
  console.log('╚═══════════════════════════════════════════════════════╝');

  // Step 1: Risk Guard
  console.log('\n[STEP 1/4] 🔐 margin_risk_guard...');
  const riskRaw = await (marginRiskGuardSkill as any).execute({
    walletAddress: address,
    collateralAsset: 'SUI',
    collateralAmountSUI: 1.5,
    borrowAmountUSDC: 1.0  // Fixed: >= 1 USDC min
  });
  const riskReport = JSON.parse(riskRaw);
  console.log(`  → ${riskReport.summary}`);
  console.log(`  → Risk: ${riskReport.riskAssessment?.riskLevel}`);
  console.log(`  → Gate: ${riskReport.recommendation?.shouldExecute ? '✅ MỞ' : '🚫 CHẶN'}`);

  // Step 2: Entry Strategist
  console.log('\n[STEP 2/4] 📈 margin_entry_strategist...');
  const entryRaw = await (marginEntryStrategistSkill as any).execute({
    asset: 'SUI', direction: 'AUTO', capitalUSDC: 1.0
  });
  const entryReport = JSON.parse(entryRaw);
  console.log(`  → Direction: ${entryReport.recommendedDirection}`);
  console.log(`  → Entry: ${entryReport.tradeSetup?.entryPrice} | SL: ${entryReport.tradeSetup?.stopLoss} | TP: ${entryReport.tradeSetup?.takeProfit}`);

  // Step 3: Portfolio Guardian (PRE-CHECK — xem có vị thế cũ không)
  console.log('\n[STEP 3/4] 🛡️ margin_portfolio_guardian (pre-check)...');
  const guardRaw = await (marginPortfolioGuardianSkill as any).execute({
    walletAddress: address
  });
  const guardReport = JSON.parse(guardRaw);
  console.log(`  → SUI Price: ${guardReport.marketSnapshot.suiPrice} (${guardReport.marketSnapshot.trend1h} / 1h)`);
  console.log(`  → Momentum: ${guardReport.marketSnapshot.momentum}`);
  console.log(`  → Pool SUI Util: ${guardReport.marketSnapshot.basePoolUtilization ?? 'N/A'}`);
  console.log(`  → Portfolio: ${guardReport.portfolioHeatMap.overallRisk ?? guardReport.portfolioHeatMap.status}`);
  console.log(`  → Active Positions: ${guardReport.portfolioHeatMap.activePositions ?? 0}`);
  if (guardReport.alerts.length > 0) {
    console.log(`  → ⚠️ Alerts: ${guardReport.alerts.map((a: any) => a.message).join(' | ')}`);
  }
  console.log(`  → ${guardReport.summary}`);

  if (!riskReport.recommendation?.shouldExecute) {
    console.log('\n  🚫 GATE CHẶN: Risk Guard không cho phép. Không thực thi.');
    return;
  }

  // Step 4: (Optional) Execute — chỉ chạy nếu Gate cho phép
  console.log('\n[STEP 4/4] ✅ Gate THÔNG QUA — Sẵn sàng thực thi (skip để bảo toàn vốn)');
}

// ═══════════════════════════════════════════════════════════
// PIPELINE 2: PREDICT (TESTNET) — Multi-Asset Allocator → Execute
// ═══════════════════════════════════════════════════════════
async function runPredictPipeline() {
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║  PIPELINE 2: PREDICT MULTI-ASSET (TESTNET)           ║');
  console.log('║  Skills: multi_asset_allocator (Kelly) → [GATE]      ║');
  console.log('║  Post:   position_monitor (PnL tracking)             ║');
  console.log('╚═══════════════════════════════════════════════════════╝');

  // Step 1: Multi-Asset Allocator (Kelly Criterion)
  console.log('\n[STEP 1/4] 🎰 predict_multi_asset_allocator (50 DUSDC, moderate)...');
  const allocRaw = await (predictMultiAssetAllocatorSkill as any).execute({
    totalCapitalDUSDC: 50,
    riskProfile: 'moderate'
  });
  const allocReport = JSON.parse(allocRaw);

  console.log(`  📡 Market Scan:`);
  for (const m of allocReport.marketScan) {
    console.log(`     ${m.asset}: ${m.price} (${m.trend}) → ${m.optimalDirection} @ ${m.optimalStrike} | EV: ${m.ev} | Kelly: ${m.kellyWeight} | ${m.verdict}`);
  }

  console.log(`  💰 Kelly Allocation:`);
  for (const a of allocReport.portfolioAllocation.allocations) {
    console.log(`     ${a.asset} ${a.direction} @ ${a.strikePrice}: ${a.allocatedDUSDC} DUSDC (${a.weight})`);
  }
  console.log(`  💵 Cash Reserve: ${allocReport.portfolioAllocation.cashReserve}`);
  
  console.log(`  ⚔️ Single vs Diversified:`);
  console.log(`     ${allocReport.comparison.singleBest.strategy} → EV: ${allocReport.comparison.singleBest.expectedReturn}`);
  console.log(`     ${allocReport.comparison.diversified.strategy} → EV: ${allocReport.comparison.diversified.expectedReturn}`);
  console.log(`     ${allocReport.comparison.winner}`);

  // Chọn asset có EV cao nhất để thực thi 1 lệnh demo
  const bestAlloc = allocReport.portfolioAllocation.allocations[0];
  if (!bestAlloc) {
    console.log('\n  🚫 GATE CHẶN: Không có asset nào có EV dương + Oracle sẵn sàng.');
    return;
  }

  const oracleId = bestAlloc.oracleId;
  console.log(`  🏆 Best: ${bestAlloc.asset} ${bestAlloc.direction} @ ${bestAlloc.strikePrice}`);
  console.log(`  🔑 Oracle ID: ${oracleId}`);

  // Step 2: Single-Asset Scanner cho asset tốt nhất (cross-validate)
  console.log(`\n[STEP 2/4] 🔮 predict_opportunity_scanner (cross-validate ${bestAlloc.asset})...`);
  const scanRaw = await (predictOpportunityScannerSkill as any).execute({
    asset: bestAlloc.asset,
    direction: bestAlloc.direction,
    capitalDUSDC: 10
  });
  const scanReport = JSON.parse(scanRaw);
  const strategy = scanReport.recommendedStrategy;
  console.log(`  → Cross-validated: ${strategy?.direction} @ $${strategy?.selectedStrikePrice} | EV: ${strategy?.expectedValue}`);

  // Step 3: Agent thực thi Predict
  console.log('\n[STEP 3/4] 🚀 Agent thực thi Predict trên Testnet...');
  const allPredictTools = [
    ...predictTools,
    predictOpportunityScannerSkill,
    predictPositionMonitorSkill,
    predictMultiAssetAllocatorSkill
  ];

  // Lấy Manager ID từ testnet
  const listTool = predictTools.find(t => (t as any).name === 'predict_list_positions');
  let managerId = '';
  if (listTool) {
    try {
      const listRaw = await (listTool as any).execute({ walletAddress: address });
      const listData = typeof listRaw === 'string' ? JSON.parse(listRaw) : listRaw;
      if (listData?.managers?.length > 0) {
        managerId = listData.managers[listData.managers.length - 1]?.objectId ?? '';
      }
    } catch (_) {}
  }

  const strikeE9 = bestAlloc.strikePriceE9;
  const managerNote = managerId
    ? `PredictManager ID: ${managerId}`
    : 'Cần tạo PredictManager trước bằng predict_create_manager';

  const prompt = `Địa chỉ ví: ${address}. Testnet.
PHÂN TÍCH ĐÃ CÓ (từ Kelly Criterion Multi-Asset Allocator):
- Best asset: ${bestAlloc.asset} ${bestAlloc.direction} @ ${bestAlloc.strikePrice}
- Oracle Object ID: ${oracleId}
- EV: ${bestAlloc.ev}, Win Prob: ${bestAlloc.winProbability}
- Cross-validated by opportunity_scanner: ${strategy?.expectedValue} EV

${managerNote}

NHIỆM VỤ: Mở lệnh Binary Predict:
${managerId ? `1. Dùng Manager ID=${managerId}.` : '1. Gọi predict_create_manager.'}
2. Gọi predict_mint với:
   - predictManagerId: ${managerId || '(tạo mới ở bước 1)'}
   - oracleId: ${oracleId}
   - direction: ${bestAlloc.direction}
   - strikePrice: ${strikeE9}
   - expiryTimestamp: 1779868800000
   - quoteType: 0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC
   - quantity: 10000000 (10 DUSDC, 6 decimals)

QUAN TRỌNG: oracleId PHẢI là ${oracleId} (Object ID đầy đủ), KHÔNG PHẢI tên asset.
Thực hiện autonomous, KHÔNG hỏi lại.`;

  const txs = await runAgentWithTools(prompt, allPredictTools, TESTNET_RPC, 'testnet');

  // Step 4: Post-Trade Monitor
  console.log('\n[STEP 4/4] 📡 predict_position_monitor (post-trade)...');
  const monRaw = await (predictPositionMonitorSkill as any).execute({
    walletAddress: address,
    asset: bestAlloc.asset
  });
  const monReport = JSON.parse(monRaw);
  console.log(`  → Market: ${monReport.marketContext?.marketCondition}`);
  console.log(`  → Portfolio: ${monReport.portfolio?.overallStatus}`);
  console.log(`  → ${monReport.summary}`);

  if (txs.length > 0) {
    console.log(`\n  ✅ Predict Pipeline hoàn tất! Giao dịch: ${txs.join(', ')}`);
  }
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🧠 DEEPTRADE FULL PIPELINE V2 — 6 Advanced Skills Connected');
  console.log(`🔑 Wallet: ${address}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Skills loaded:');
  console.log('  Margin: risk_guard → entry_strategist → portfolio_guardian');
  console.log('  Predict: multi_asset_allocator → opportunity_scanner → position_monitor');
  console.log('═══════════════════════════════════════════════════════════════');

  await runMarginPipeline();
  await new Promise(r => setTimeout(r, 2000));
  await runPredictPipeline();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('🏁 FULL PIPELINE V2 HOÀN TẤT');
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(console.error);

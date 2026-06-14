import fetch from 'node-fetch';
import { Transaction } from '@mysten/sui/transactions';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { marginTools } from '../src/agent/tools/margin.js';
import { predictTools } from '../src/agent/tools/predict.js';
import { deepbookV3Tools } from '../src/agent/tools/deepbookV3.js';
import { agentSkills } from '../src/agent/skills/index.js';

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

const allTools = [...marginTools, ...predictTools, ...deepbookV3Tools, ...agentSkills];
const deepseekApiKey = (process.env.DEEPSEEK_API_KEY || '');

const privKey = (process.env.SUIROBO_DEV_WALLET || '');
const parsed = decodeSuiPrivateKey(privKey);
const keypair = Ed25519Keypair.fromSecretKey(parsed.secretKey);
const address = keypair.toSuiAddress();
// client is initialized per transaction below

function convertSchema(obj: any): any {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(convertSchema);
  const newObj: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'type' && typeof v === 'string') {
      newObj[k] = v.toLowerCase();
    } else if (k === 'anyOf' || k === 'allOf' || k === 'oneOf') {
      if (Array.isArray(v) && v.length > 0) Object.assign(newObj, convertSchema(v[0]));
    } else if (['default','nullable','exclusiveMinimum','exclusiveMaximum','$schema'].includes(k)) {
      continue;
    } else {
      newObj[k] = convertSchema(v);
    }
  }
  return newObj;
}

async function runDeepSeekChat(text: string) {
  const messages: any[] = [
    { role: 'system', content: 'Bạn là SUIROBO DeFi. Hãy dùng tool để thực hiện lệnh. Thực hiện từng bước, nếu cần giá thì gọi tool get_swap_quote xong tôi sẽ cung cấp, sau đó bạn phải gọi tool deposit/prepare_order.' },
    { role: 'user', content: text }
  ];

  const tools = allTools.map((t: any) => {
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

  let finalTools: any[] = [];
  let isDone = false;
  let finalMessage = '';

  while (!isDone) {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${deepseekApiKey}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages, tools })
    });

    if (!res.ok) throw new Error(`DeepSeek API Error: ${await res.text()}`);
    const data = await res.json() as any;
    const msg = data.choices[0].message;
    messages.push(msg);

    if (msg.content) finalMessage += msg.content + '\n';

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const call of msg.tool_calls) {
        const tool = allTools.find(t => t.name === call.function.name);
        if (tool) {
          const args = JSON.parse(call.function.arguments);
          let toolResult;
          try {
            toolResult = await (tool as any).runAsync({ args, toolContext: { walletAddress: address } });
          } catch (e: any) {
            toolResult = { error: e.message };
          }
          finalTools.push({ toolName: tool.name, toolArgs: args, toolResult });
          
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(toolResult)
          });
        }
      }
    } else {
      isDone = true;
    }
  }

  return { message: finalMessage, steps: finalTools };
}

async function testCommands() {
  const network = 'testnet';
  const suiClient = new SuiJsonRpcClient({ url: 'https://fullnode.testnet.sui.io' });
  let currentGasCoin: any = null;

  console.log("=================================================");
  console.log("🚀 Bắt đầu test Agent DeepTrade (Skills + Execution)");
  console.log("🔑 Ví testnet:", address);
  console.log("=================================================\n");

  const commands = [
    `Địa chỉ ví của tôi là: ${address}. Lệnh yêu cầu: 1. Hãy dùng Tool margin_analyzer_skill để phân tích trạng thái Margin cho SUI. 2. Sau khi có báo cáo JSON, nếu thấy an toàn, hãy mở MỘT vị thế Margin Long. (Sử dụng Tool margin_open_position). DUSDC của tôi: 0x84ba496a7c8d0c5ab4b98bfdc99099f68712613187d3b6c72fe0645c0ef48e2c (nếu cần). Chạy ở chế độ autonomous.`
  ];

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    console.log(`\n--- YÊU CẦU ${i + 1}: ${cmd} ---`);
    
    const result = await runDeepSeekChat(cmd);

    console.log("\n🤖 Agent phản hồi:");
    console.log(result.message);
    
    if (result.steps && result.steps.length > 0) {
      console.log("\n🔧 Tools được gọi:");
      for (const step of result.steps) {
         console.log(`  - ${step.toolName} với args:`, step.toolArgs);
         
         if (step.toolResult && step.toolResult.serializedTx) {
             console.log("  => Agent đã tạo Serialized Transaction!");
             console.log("  => Tiến hành Dry Run/Serialize payload on-chain...");
             try {
               const network = "mainnet";
               const rpcUrl = getJsonRpcFullnodeUrl(network as any);
               
               let builtBytes: Uint8Array;
               
               if (step.toolResult.txBytes) {
                   console.log("  => Dùng txBytes trả về từ tool (Base64 decode)...");
                   const { fromBase64 } = await import('@mysten/sui/utils');
                   builtBytes = fromBase64(step.toolResult.txBytes);
                   console.log("  => Decode txBytes thành công. Độ dài:", builtBytes.length);
               } else {
                   console.log("  => Không có txBytes, tiến hành build từ serializedTx...");
                   console.log("  => FULL SERIALIZED TX:", JSON.stringify(step.toolResult.serializedTx, null, 2));
                   let actualTxString = step.toolResult.serializedTx;
                   if (typeof actualTxString === 'object' && actualTxString.serializedTx) {
                       actualTxString = actualTxString.serializedTx;
                   }
                   const txBytesObject = Transaction.from(actualTxString);
                   txBytesObject.setSender(address);
                   const gasPrice = await suiClient.getReferenceGasPrice();
                   txBytesObject.setGasPrice(gasPrice);
                   txBytesObject.setGasBudget(50000000);
                   
                   if (!currentGasCoin) {
                       const coins = await suiClient.getCoins({ owner: address, coinType: '0x2::sui::SUI' });
                       if (coins.data.length > 0) {
                           const coin = coins.data[0];
                           currentGasCoin = { objectId: coin.coinObjectId, version: coin.version, digest: coin.digest };
                       }
                   }
                   if (currentGasCoin) {
                       txBytesObject.setGasPayment([currentGasCoin]);
                   }
                   builtBytes = await txBytesObject.build({ client: suiClient });
                   console.log("  => Build txBytes thành công. Độ dài:", builtBytes.length);
               }
               
               console.log("  => Tiến hành sign giao dịch...");
               const { signature } = await keypair.signTransaction(builtBytes);
                   const txRes = await suiClient.executeTransactionBlock({
                       transactionBlock: builtBytes,
                       signature,
                       options: {
                           showEffects: true,
                           showObjectChanges: true
                       }
                   });
                   console.log("  ✅ Giao dịch thành công (On-chain check):", txRes.digest);
                   if (txRes.effects && txRes.effects.gasObject) {
                       currentGasCoin = txRes.effects.gasObject.reference;
                   }
               console.log(`  🔗 TxDigest: ${txRes.digest}`);
               console.log(`  🔍 Xem trên Explorer: https://suivision.xyz/txblock/${txRes.digest}?network=${network}`);
               console.log("  ⏳ Chờ 5 giây để Sui Network Indexer đồng bộ...");
               await new Promise(resolve => setTimeout(resolve, 5000));
             } catch (e: any) {
               console.log("  ❌ Giao dịch thất bại (On-chain check):", e.stack || e);
             }
         }
      }
    } else {
        console.log("Không có tool nào được gọi.");
    }
  }
}

testCommands().catch(console.error);

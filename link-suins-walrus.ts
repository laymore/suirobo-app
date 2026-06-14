/**
 * Link SuiNS domain → Walrus Site Object
 *
 * Sau khi chạy thành công, URL https://<domain>.wal.app sẽ resolve đến site.
 */
import 'dotenv/config';
import { Transaction } from '@mysten/sui/transactions';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

// ─── Config ───────────────────────────────────────────────────────────────────
// SuiNS Mainnet — Package mới (controller v2 đã authorize)
// Source: github.com/MystenLabs/ts-sdks/packages/suins/src/constants.ts
const SUINS_PACKAGE  = '0x71af035413ed499710980ed8adb010bbf2cc5cacf4ab37c7710a4bb87eb58ba5';
const SUINS_OBJECT   = '0x6e0ddefc0ad98889c04bab9639e512c21766c5e6366f89e696956d9be6952871';
const CLOCK_OBJECT   = '0x6';

const AUTOBOTS_NFT   = '0x0a1a60e6a60e3e60df6a1c6f2c2d762e2897e8e055a2d7c1a82e0d7ee29a13be';
const WALRUS_SITE_ID = '0xa6198cddeebbd677f468fbf3373913189386ccd7832bffe07980cd926e1cd934';

const PRIVATE_KEY = process.env.SUIROBO_DEV_WALLET!;
const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(PRIVATE_KEY).secretKey);
const address = kp.toSuiAddress();
const suiClient = new SuiJsonRpcClient({ url: 'https://fullnode.mainnet.sui.io', network: 'mainnet' as any });

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log(' LINK SuiNS → WALRUS SITE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`📍 Sender:      ${address}`);
  console.log(`🌐 Domain:      autobots.sui`);
  console.log(`🆔 NFT:         ${AUTOBOTS_NFT.slice(0, 20)}...`);
  console.log(`📦 Walrus Site: ${WALRUS_SITE_ID.slice(0, 20)}...`);
  console.log();

  const tx = new Transaction();
  tx.setSender(address);

  // controller::set_user_data(suins: &mut SuiNS, nft: &SuinsRegistration, key: String, value: String, clock: &Clock)
  tx.moveCall({
    target: `${SUINS_PACKAGE}::controller::set_user_data`,
    arguments: [
      tx.object(SUINS_OBJECT),
      tx.object(AUTOBOTS_NFT),
      tx.pure.string('walrus_site_id'),  // key chuẩn của Walrus portal (legacy/canonical)
      tx.pure.string(WALRUS_SITE_ID),
      tx.object(CLOCK_OBJECT),
    ],
  });

  // (Optional) cũng set target_address để các app khác phân giải
  // tx.moveCall(...set_target_address)

  const gasPrice = await suiClient.getReferenceGasPrice();
  tx.setGasPrice(gasPrice);
  tx.setGasBudget(50_000_000);

  console.log('⚙️  Building...');
  const built = await tx.build({ client: suiClient });

  console.log('✍️  Signing...');
  const { signature } = await kp.signTransaction(built);

  console.log('📤 Executing on Sui Mainnet...');
  const res = await suiClient.executeTransactionBlock({
    transactionBlock: built, signature,
    options: { showEffects: true, showEvents: true },
  });

  if (res.effects?.status?.status === 'success') {
    console.log();
    console.log('🎉 ═════════════════════════════════════════════════════');
    console.log('   LINK THÀNH CÔNG!');
    console.log('   ═════════════════════════════════════════════════════');
    console.log(`Tx Digest: ${res.digest}`);
    console.log(`Explorer:  https://suivision.xyz/txblock/${res.digest}`);
    console.log();
    console.log('🌐 Truy cập website tại:');
    console.log('   https://autobots.wal.app');
    console.log();
    console.log('⏱  Có thể mất 1-2 phút để propagate qua DNS/portal cache.');
  } else {
    console.error('❌ Failed:', res.effects?.status?.error);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ ERROR:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});

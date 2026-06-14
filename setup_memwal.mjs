// One-time MemWal account setup on Sui testnet (uses dev wallet for signing).
// Outputs MEMWAL_ACCOUNT_ID + MEMWAL_PRIVATE_KEY (delegate key) for .env.
import 'dotenv/config';
import { createAccount, addDelegateKey, generateDelegateKey } from '@mysten-incubation/memwal/account';
import { SuiJsonRpcClient as SuiClient, getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc';

const PACKAGE_ID = '0xcf6ad755a1cdff7217865c796778fabe5aa399cb0cf2eba986f4b582047229c6';
const REGISTRY_ID = '0xe80f2feec1c139616a86c9f71210152e2a7ca552b20841f2e192f99f75864437';
const NETWORK = 'testnet';
const SUI_KEY = process.env.SUIROBO_DEV_WALLET;

if (!SUI_KEY) { console.error('SUIROBO_DEV_WALLET not set in .env'); process.exit(1); }

const suiClient = new SuiClient({ url: getFullnodeUrl(NETWORK) });

const log = (...a) => console.log(...a);

(async () => {
  log('1) Generating Ed25519 delegate keypair...');
  const delegate = await generateDelegateKey();
  log('   delegate suiAddress:', delegate.suiAddress);

  let accountId;
  log('2) Creating MemWalAccount on-chain (testnet)...');
  try {
    const acc = await createAccount({
      packageId: PACKAGE_ID,
      registryId: REGISTRY_ID,
      suiPrivateKey: SUI_KEY,
      suiNetwork: NETWORK,
      suiClient,
    });
    accountId = acc.accountId;
    log('   created accountId:', accountId, '| tx:', acc.digest);
  } catch (e) {
    const msg = String(e?.message || e);
    log('   createAccount failed:', msg.slice(0, 160));
    // Each address can only own ONE account. If it already exists, surface a hint.
    if (/already|EAccountExists|exists|abort/i.test(msg)) {
      log('   → This wallet may already own a MemWal account. Set MEMWAL_ACCOUNT_ID manually from explorer.');
    }
    process.exit(2);
  }

  log('3) Adding delegate key to the account...');
  const add = await addDelegateKey({
    packageId: PACKAGE_ID,
    accountId,
    publicKey: delegate.publicKey,
    label: 'Suirobo Local Agent',
    suiPrivateKey: SUI_KEY,
    suiNetwork: NETWORK,
    suiClient,
  });
  log('   delegate added | tx:', add.digest);

  log('\n========= SAVE THESE TO .env =========');
  log('MEMWAL_ACCOUNT_ID=' + accountId);
  log('MEMWAL_PRIVATE_KEY=' + delegate.privateKey);
  log('MEMWAL_SERVER_URL=https://relayer.staging.memwal.ai');
  log('======================================');

  // Also write to a gitignored file for the agent to pick up programmatically.
  const fs = await import('fs');
  fs.writeFileSync('.memwal_account.json', JSON.stringify({
    accountId,
    delegatePrivateKey: delegate.privateKey,
    delegateSuiAddress: delegate.suiAddress,
    packageId: PACKAGE_ID, registryId: REGISTRY_ID, network: NETWORK,
    serverUrl: 'https://relayer.staging.memwal.ai',
  }, null, 2));
  log('Wrote .memwal_account.json');
})();

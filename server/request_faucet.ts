import fetch from 'node-fetch';

const FAUCET_URL = 'https://faucet.testnet.sui.io/v1/gas';
const ADDRESS = '0x09010f48156a184a1c21b59b62cfa60a80656f07f773def8b8a95d8fdb764f8e';

async function requestFaucet() {
  console.log(`🚰 Requesting Sui Testnet Faucet for ${ADDRESS}...`);
  try {
    const res = await fetch(FAUCET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        FixedAmountRequest: {
          recipient: ADDRESS
        }
      })
    });
    
    if (res.ok) {
      const data = await res.json();
      console.log(`✅ Faucet Request Successful! Response:`, JSON.stringify(data));
    } else {
      console.error(`❌ Faucet Request Failed: Status ${res.status}`, await res.text());
    }
  } catch (err: any) {
    console.error('Error contacting faucet:', err);
  }
}

requestFaucet();

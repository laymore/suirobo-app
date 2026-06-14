const { execSync } = require('child_process');
const fs = require('fs');
const PACKAGE_ID = '0x888f919f64154138f6e21a2341515f68d472be54c45eb9c70e628cfb5458958a';
const MARKET_ID = '0x8a9b68ec257a515753f13f2b6582aa6e9bc8effe2d6c9731afdadd0411fa4d22';
const skills = JSON.parse(fs.readFileSync('zero_skills_result.json','utf-8')).filter(s=>s.status==='ok');
const results = [];
for (const s of skills) {
  process.stdout.write(`Buying ${s.name}... `);
  try {
    const cmd = `sui client ptb --split-coins gas "[0]" --assign zc --move-call ${PACKAGE_ID}::suirobo_factory::buy_skill @${MARKET_ID} @${s.skillId} zc.0 --gas-budget 50000000 --json`;
    const out = execSync(cmd, { encoding:'utf-8', stdio:['pipe','pipe','pipe'] });
    const j = JSON.parse(out);
    const receipt = (j.objectChanges||[]).filter(c=>c.type==='created'&&c.objectType&&c.objectType.includes('SkillReceipt'));
    const rid = receipt[0]?.objectId || '?';
    console.log(`OK  receipt=${rid}`);
    results.push({name:s.name, skillId:s.skillId, receiptId:rid, digest:j.digest, status:'ok'});
  } catch(e) {
    console.log('FAIL');
    console.error('  err:', (e.stderr||e.message||'').toString().slice(0,220));
    results.push({name:s.name, status:'fail', err:(e.stderr||e.message||'').toString().slice(0,150)});
  }
}
fs.writeFileSync('buy_skills_result.json', JSON.stringify(results,null,2));
const ok = results.filter(r=>r.status==='ok').length;
console.log(`\n=== DONE: ${ok}/${skills.length} skills bought (receipts in wallet) ===`);

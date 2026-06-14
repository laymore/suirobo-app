import { deepbookV3Tools } from '../src/agent/tools/deepbookV3.js';
import { marginTools } from '../src/agent/tools/margin.js';
import { predictTools } from '../src/agent/tools/predict.js';

const allTools = [...deepbookV3Tools, ...marginTools, ...predictTools];

console.log(`Total tools: ${allTools.length}`);
console.log(`Names: ${allTools.map(t => t.name).join(', ')}\n`);

for (const t of allTools) {
  const dec = (t as any)._getDeclaration();
  console.log(`=== ${dec.name} ===`);
  console.log(JSON.stringify(dec.parameters, null, 2));
  console.log();
}

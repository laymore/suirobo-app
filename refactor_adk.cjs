const fs = require('fs');
const path = require('path');
const glob = require('fast-glob');

const files = glob.sync(['src/agent/tools/**/*.ts', 'src/agent/skills/**/*.ts']);
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  // Determine relative path to micro_adk
  const depth = file.split('/').length - 3; // src/agent is depth 0. src/agent/tools/file.ts is depth 1.
  const relPath = depth === 1 ? '../micro_adk/FunctionTool.js' : '../../micro_adk/FunctionTool.js';
  
  if (content.includes('@google/adk')) {
    content = content.replace(/import\s+\{([^}]*FunctionTool[^}]*)\}\s+from\s+['\"]@google\/adk['\"];/g, `import { $1 } from '${relPath}';`);
    fs.writeFileSync(file, content, 'utf8');
    console.log('Updated ' + file);
  }
}

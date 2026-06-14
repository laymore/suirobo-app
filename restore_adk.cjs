const fs = require('fs');
const glob = require('fast-glob');

const files = glob.sync(['src/agent/tools/**/*.ts', 'src/agent/skills/**/*.ts']);
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes('micro_adk/FunctionTool')) {
    content = content.replace(/import\s+\{([^}]*FunctionTool[^}]*)\}\s+from\s+['\"].*?micro_adk\/FunctionTool(\.js)?['\"];/g, `import { $1 } from '@google/adk';`);
    fs.writeFileSync(file, content, 'utf8');
    console.log('Restored ' + file);
  }
}

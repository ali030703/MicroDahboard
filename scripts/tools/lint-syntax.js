// Purpose: Runs a lightweight syntax lint over backend and validation scripts without adding dependencies.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const targets = [
  path.join(root, 'backend', 'server.js'),
  path.join(root, 'backend', 'src'),
  path.join(root, 'scripts'),
];

function collectJavaScriptFiles(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return [];
  }

  const stat = fs.statSync(targetPath);

  if (stat.isFile()) {
    return targetPath.endsWith('.js') ? [targetPath] : [];
  }

  return fs.readdirSync(targetPath, { withFileTypes: true })
    .flatMap((entry) => collectJavaScriptFiles(path.join(targetPath, entry.name)));
}

const files = targets.flatMap(collectJavaScriptFiles).sort();
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    failed = true;
    console.error(result.stderr || result.stdout);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`Syntax lint passed (${files.length} files).`);
}

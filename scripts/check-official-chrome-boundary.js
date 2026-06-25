#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const defaultRoots = [
  path.join(repoRoot, 'packages', 'official-browser-chrome', 'src'),
  path.join(repoRoot, 'dist', 'chrome-packages', 'official-browser-chrome'),
];

const SCANNED_EXTENSIONS = new Set(['.css', '.html', '.js', '.mjs']);
const DISALLOWED_PATTERNS = Object.freeze([
  {
    name: 'electron module import',
    pattern: /\b(?:require\s*\(\s*['"]electron['"]|from\s+['"]electron['"])/,
  },
  {
    name: 'raw ipcRenderer usage',
    pattern: /\bipcRenderer\b/,
  },
  {
    name: 'broad preload global',
    pattern:
      /\bwindow\.(?:electronAPI|wallet|identity|swarmProvider|swarmPermissions|dappPermissions)\b/,
  },
  {
    name: 'main-process source import',
    pattern: /\b(?:import|from|require)\b[^\n;]*['"][^'"]*src\/main[^'"]*['"]/,
  },
  {
    name: 'broad preload adapter token',
    pattern: /\belectronAPI\b/,
  },
]);
const DISALLOWED_RESIDUE_MARKERS = Object.freeze([
  'id="sidebar-export-mnemonic"',
  'id="sidebar-export-mnemonic-btn"',
  'id="mnemonic-words"',
  'id="sidebar-create-wallet"',
  'id="sidebar-receive"',
  'id="sidebar-wallet-settings"',
  'id="wallet-settings-export-pk"',
  'id="send-unlock-section"',
  'id="sidebar-dapp-connect"',
  'id="sidebar-dapp-tx"',
  'id="sidebar-dapp-sign"',
  'id="sidebar-x402-approval"',
  'id="sidebar-vault-unlock"',
  'id="sidebar-dapp-permissions"',
  'id="sidebar-x402-permissions"',
  'id="sidebar-publisher-identity-create"',
  '#sidebar-export-mnemonic',
  '#sidebar-create-wallet',
  '#sidebar-receive',
  '#sidebar-wallet-settings',
  '#wallet-settings-export-pk',
  '#send-unlock-section',
  '#sidebar-dapp-connect',
  '#sidebar-dapp-tx',
  '#sidebar-dapp-sign',
  '#sidebar-x402-approval',
  '#sidebar-vault-unlock',
  '#sidebar-dapp-permissions',
  '#sidebar-x402-permissions',
  '#sidebar-publisher-identity-create',
  '.mnemonic-words',
  '.dapp-connect-origin',
  '.dapp-tx-origin',
  '.dapp-sign-origin',
  '.x402-chooser',
  '.wallet-settings-export-btn',
  '.send-unlock-section',
]);

function parseArgs(argv = process.argv.slice(2)) {
  const roots = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root') {
      roots.push(path.resolve(argv[++index] || ''));
    } else if (arg.startsWith('--root=')) {
      roots.push(path.resolve(arg.slice('--root='.length)));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return roots.length ? roots : defaultRoots.filter((root) => fs.existsSync(root));
}

function listScannableFiles(root) {
  const files = [];
  const visit = (dir) => {
    for (const name of fs.readdirSync(dir).sort((left, right) => left.localeCompare(right))) {
      const absolutePath = path.join(dir, name);
      const stat = fs.statSync(absolutePath);
      if (stat.isDirectory()) {
        visit(absolutePath);
      } else if (stat.isFile() && SCANNED_EXTENSIONS.has(path.extname(name))) {
        files.push(absolutePath);
      }
    }
  };
  visit(root);
  return files;
}

function hasTrustedSurfaceSourceFile(filePath) {
  const relativeFile = path.relative(repoRoot, filePath).replace(/\\/g, '/');
  const base = path.basename(relativeFile);
  return (
    /^trusted-.*\.js$/.test(base) ||
    relativeFile.endsWith('/lib/onboarding.js') ||
    relativeFile.endsWith('/lib/wallet-ui.js') ||
    relativeFile.includes('/lib/wallet/') ||
    relativeFile.endsWith('/lib/dapp-provider.js') ||
    relativeFile.endsWith('/lib/swarm-provider.js') ||
    relativeFile.endsWith('/styles/onboarding.css')
  );
}

function checkOfficialChromeBoundary(roots = defaultRoots.filter((root) => fs.existsSync(root))) {
  const violations = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      violations.push({
        root,
        file: '',
        line: 0,
        rule: 'missing scan root',
        text: 'scan root does not exist',
      });
      continue;
    }
    for (const file of listScannableFiles(root)) {
      const relativeFile = path.relative(repoRoot, file).replace(/\\/g, '/');
      if (hasTrustedSurfaceSourceFile(file)) {
        violations.push({
          root,
          file: relativeFile,
          line: 0,
          rule: 'trusted surface source file',
          text: path.basename(file),
        });
      }

      const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
      lines.forEach((line, index) => {
        for (const rule of DISALLOWED_PATTERNS) {
          if (rule.pattern.test(line)) {
            violations.push({
              root,
              file: relativeFile,
              line: index + 1,
              rule: rule.name,
              text: line.trim(),
            });
          }
        }
        for (const marker of DISALLOWED_RESIDUE_MARKERS) {
          if (line.includes(marker)) {
            violations.push({
              root,
              file: relativeFile,
              line: index + 1,
              rule: 'trusted sidebar residue marker',
              text: marker,
            });
          }
        }
      });
    }
  }
  return violations;
}

if (require.main === module) {
  try {
    const roots = parseArgs();
    const violations = checkOfficialChromeBoundary(roots);
    if (violations.length) {
      for (const violation of violations) {
        console.error(
          `${violation.file}${violation.line ? `:${violation.line}` : ''}: ${violation.rule}: ${violation.text}`
        );
      }
      process.exitCode = 1;
    } else {
      console.log('Official chrome package boundary check passed.');
    }
  } catch (error) {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  DISALLOWED_PATTERNS,
  DISALLOWED_RESIDUE_MARKERS,
  checkOfficialChromeBoundary,
  defaultRoots,
  listScannableFiles,
};

#!/usr/bin/env bash
#
# Publish a slim npm package containing only the MCP server.
#
# The full package.json has Electron/React/Playwright deps that npx users
# don't need. This script creates a minimal package.json with only the
# MCP SDK dependency, publishes, then restores the original.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Backup
cp package.json package.json.bak

# Generate minimal package.json for npm
node -e "
const pkg = JSON.parse(require('fs').readFileSync('package.json', 'utf8'));
const slim = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  repository: pkg.repository,
  author: pkg.author,
  license: pkg.license,
  bin: pkg.bin,
  keywords: pkg.keywords,
  files: ['mcp-server.mjs'],
  dependencies: {
    '@modelcontextprotocol/sdk': pkg.dependencies['@modelcontextprotocol/sdk']
  }
};
require('fs').writeFileSync('package.json', JSON.stringify(slim, null, 2) + '\n');
"

echo "Publishing slim package:"
cat package.json
echo ""

npm publish "$@"

# Restore
mv package.json.bak package.json
echo "Restored original package.json"

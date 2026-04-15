# Purroxy

[![purroxy2 MCP server](https://glama.ai/mcp/servers/KuvopLLC/purroxy2/badges/card.svg)](https://glama.ai/mcp/servers/KuvopLLC/purroxy2)

[![Tests](https://github.com/KuvopLLC/purroxy2/actions/workflows/test.yml/badge.svg)](https://github.com/KuvopLLC/purroxy2/actions/workflows/test.yml)
[![purroxy2 MCP server](https://glama.ai/mcp/servers/KuvopLLC/purroxy2/badges/score.svg)](https://glama.ai/mcp/servers/KuvopLLC/purroxy2)

Record what you do on any website. Securely automate it forever.

> **Pre-release software.** Purroxy is under active development. Functionality may be incomplete or break between updates — no guarantees are provided. If you run into issues or have feedback, please [open an issue on GitHub](https://github.com/KuvopLLC/purroxy2/issues).

Purroxy gives Claude secure access to websites behind your login. You walk through a site in Purroxy's built-in browser, and every action you take is recorded as a capability. At runtime, Purroxy replays those exact steps on your behalf. Your credentials never leave your machine.

## Download

[Latest release](https://github.com/KuvopLLC/purroxy2/releases/latest) — macOS, Windows, Linux.

## How it works

1. **Log in once** — Enter a URL and log in through the secure embedded browser. Credentials never touch any AI.
2. **Record what you want done** — Walk through the site. Every click, search, and navigation is recorded as a reusable capability with parameters.
3. **Ask Claude** — Claude replays the recorded steps, fills in variable inputs, and extracts results. Your password is never stored or shared.

## Security

- Zero-knowledge login — Purroxy never sees your password, only session cookies
- Encrypted vault — Sensitive data stored in your OS keychain, typed into forms by Purroxy, never sent to Claude
- Data scrubbing — Vault values removed from page content before Claude sees it
- Local extraction — Data extracted on your machine, sensitive results redacted

## Claude Desktop integration

Purroxy connects to Claude Desktop via MCP. One-click setup in Settings. Your capabilities become tools Claude can call.

## Pricing

Free during pre-release. Early accounts will be grandfathered when paid plans launch ($3.89/month). Or contribute a capability to the community library and use Purroxy free forever.

## Development

```bash
npm install
npm run dev        # Vite dev server + Electron
npm test           # Run 559 tests
npm run package    # Build distributable
```

Backend (Cloudflare Worker):
```bash
cd backend
npm install
npm test           # Run 139 tests
npm run dev        # Local dev server
npm run deploy     # Deploy to Cloudflare
```

## License

Apache 2.0

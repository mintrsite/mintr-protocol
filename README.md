# Mintr

Read the ground before you swing.

[![Live site](https://img.shields.io/badge/live-mintr.site-f3da38?style=flat-square)](https://mintr.site)
[![Chain: Solana](https://img.shields.io/badge/chain-Solana-2ab5b3?style=flat-square)](https://solana.com)

**Chain:** Solana
**Contract address:** pending (to be announced; the site shows a pending slot until then)

## Overview

Mintr is a Solana token with a live market board on its site. The board lists the ten Solana tokens trading the most volume over the last day, with price, daily move, volume and liquidity, and refreshes on its own while the tab is open.

## Features

- Live board of the top ten Solana tokens by 24h volume, with a scrolling price ticker
- One-tap copy of any token address, plus a click-to-copy slot for the Mintr contract address once it is announced
- Facts that are not confirmed render as inert "pending" chips instead of guesses
- Smooth motion that switches fully off for visitors who ask for reduced motion
- Static build: drop the `dist/` folder onto any static host

## Links

- Website: https://mintr.site
- X: https://x.com/mintr_site
- GitHub: pending
- Whitepaper: [docs/whitepaper.md](docs/whitepaper.md)

## Development

```bash
npm install
npm run build   # writes dist/
npm run gates   # build checks, both contract-address branches, mutation harness
npm run serve   # preview dist/ on http://127.0.0.1:4173
```

Every external fact lives in `src/register.json` as a record with a state of `stated`, `absent` or `unconfirmed`. Only stated records can render a value or a link. All colour values live in `src/css/tokens.css`.

## License

MIT, see [LICENSE](LICENSE).

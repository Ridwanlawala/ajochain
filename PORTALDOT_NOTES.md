# Portaldot V3.0 testnet: research notes (2026-10-16)

## Network parameters (official PortaldotV3 Testnet guide)

Source: "PortaldotV3 Testnet说明文档", English translation at
https://github.com/ItsCogumellum/portaldot-v3-testnet-guide (README §1 and §3, FAQ dated 2026-10-07).
The same values are used by other Hacker House 2026 repos (rishu4436/seam, nato-san/PortalProof, Gieez/portaldot-revivescope).

| Item | Value |
|---|---|
| Network name | PortaldotV3 Testnet |
| EVM JSON-RPC (pallet-revive eth-rpc) | `https://testnetv3-eth-rpc.feso-apps.xyz` |
| Substrate RPC (WebSocket) | `wss://testnetv3-node.feso-apps.xyz` |
| Chain ID | `420420777` (hex `0x190f2309`) |
| Native token | `tPOTv3` (mainnet symbol POT), 14 decimals on the native side |
| Block explorer | None for EVM; the guide says leave MetaMask's explorer field empty. Node console (polkadot.js apps): https://node-console.feso-apps.xyz/ |
| Faucet | **No public faucet documented.** Funding = a tPOTv3 transfer (node console) to the deployer's *mapped SS58 address* |
| EVM tooling documented | MetaMask, Remix, Hardhat (Foundry "awaiting confirmation") |

### H160 → SS58 mapping
1. Node console → Developer → Runtime calls → `reviveApi.accountId(<H160>)` → SS58 address.
2. Send tPOTv3 to that SS58 address; it then shows as the H160's balance in MetaMask / `eth_getBalance`.

### Contract execution
Solidity via `pallet-revive` (EVM-compatible); ink!/WASM via `pallet-contracts` in parallel. The guide deploys
standard solc output from Remix/Hardhat. Native-side calls (`Revive.call` extrinsic) need a `reviveApi.call` dry-run
for weight and storage-deposit limits.

## Mainnet (Substrate side, not used by AjoChain)
- `wss://mainnet.portaldot.io`, POT, 14 decimals, ss58 42 — https://portaldot-dev.readthedocs.io/en/latest/chain-info.html
- Substrate explorer: https://portalscan.portaldot.io/

## Status observed 2026-10-16 ~10:30–10:45 WAT
- `testnetv3-eth-rpc.feso-apps.xyz`, `testnetv3-node.feso-apps.xyz` and `node-console.feso-apps.xyz` all return
  **NXDOMAIN** from Google DNS and Cloudflare DNS (checked twice). The parent zone `feso-apps.xyz` exists, so the
  testnet hostnames have been removed or are temporarily down. Hardhat preflight: `getaddrinfo ENOTFOUND`.
- `testnet-evm.portaldot.world` / chain 8890 (used in one unofficial repo) also does not resolve; ignore it.
- PortalProof (updated 2026-10-15) still says "Not deployed yet"; PotScan and SEAM mention RPC downtime.

## To deploy AjoChain
1. Official RPC back online, or a new endpoint from the Portaldot Discord (https://discord.gg/portaldot).
2. tPOTv3 sent to the deployer's mapped SS58 address (ask in the Hacker House channel; there is no web faucet).
3. `npm run check:portaldot` → `npm run deploy:portaldot` → `npm run demo:portaldot` (see README).

## Hackathon rules relevant here
https://dorahacks.io/hackathon/portaldot-hacker-house-2026/detail
- Check-in Oct 24 12:00 UTC: public repo, README, architecture diagram, testnet contract address + tx hash, demo link or ≤3 min video.
- Final deadline / code freeze Nov 6 04:00 UTC; ≥3 valid commits during Oct 14–Nov 6; no one-shot dump in the last 24 h; disclose dependencies.

## Update 2026-10-22: testnet back on new hostnames
Per the guide's 2026-10-16 update, endpoints moved to `portaldot.dev`:
- EVM RPC `https://test-evm-rpc-v3.portaldot.dev` (verified 2026-10-22: eth_chainId 0x190f1ca9 = 420420777, producing blocks)
- Substrate `wss://test-node-v3.portaldot.dev`, node console https://node-console.portaldot.dev
- Tokens: first batch goes to the native POT address (starts with 5) given at registration; otherwise open a Discord support ticket with a registration screenshot + address.
- Deployer 0xfBD8…933e balance 0 as of 2026-10-22.

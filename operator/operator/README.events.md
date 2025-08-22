# Operator Event Tracking Plan (MVP)

## Goals
- Record each provider call as one canonical event, then enrich it with on-chain facts.
- Power the console UI: balance curve, per-client totals, raw event table.
- Ship fast, tolerate reorgs/restarts, and evolve without schema churn.

## Event schema (lean)
Required fields (one record per provider call):
- identity: event_id (uuid), timestamp_ms, chain_id
- who: client_id, operator_wallet_id (internal), provider_id, provider_name
- links: user_operation_hash (optional), tx_hash (optional)
- commercials: provider_price_usdc (quoted), token_transfer_amount_usdc (observed; optional)
- gas: gas_used (native), effective_gas_price (native), total_gas_cost_native, total_gas_cost_usdc (optional)
- status: initiated | pending | success | reverted | failed, error_message (optional)

Keep amounts as strings at the API/storage boundary; compute with numbers internally.

## Storage strategy
- extend in-memory `state.call_history` to this shape; bump retention (e.g., 1000). Persist via existing state save so UI survives restarts.

## Chain scanner (practical)
- Maintain per-chain last_scanned_block in `State`.
- Scan forward in windows (e.g., 2k blocks) with retries/backoff.
- Filters:
  - USDC ERC‑20 Transfer: address = USDC; topic0 = Transfer; topic1 = from or topic2 = to equals any client-associated wallet address (lowercased set).
  - ERC‑4337 EntryPoint events: `UserOperationEvent` (execution details), optionally `AccountDeployed` (account creation). Filter by sender (client wallet) or paymaster if needed.
- For each matched tx: fetch receipt, enrich matching event; compute `total_gas_cost_native` and (optionally) `total_gas_cost_usdc` using a cached price.
- Confirmations: mark events final after N blocks; re-run enrichment if receipt/status changes.

## Minimal endpoints (to keep UI moving)
- Reuse now: `GET /api/state`
- Add small GETs (next):
  - `/api/events?since=<ms>&clientId=<id>`
  - `/api/clients/summary` (server-side aggregates: spent, usage, limits)

## Cost policy (MVP)
- Provider price: record quoted price as `provider_price_usdc` at initiation.
- Token movement: if USDC Transfer exists in tx, record as `token_transfer_amount_usdc`.
- Gas: record `total_gas_cost_native = gasUsed * effectiveGasPrice` from receipt. Optionally compute `total_gas_cost_usdc` with a simple price feed and record the rate used.
- Total (UI): display provider price + native gas; add USDC-converted gas when available.

## Client mapping (no hot-wallet UI exposure)
- Use `authorized_clients[*].associated_hot_wallet_address` internally to correlate:
  - Match USDC Transfers (from/to) and EntryPoint events (sender) to a client_id.
  - Store `client_id` on the event to make aggregation trivial.

## Determining TBA creation block/time (to bound scan ranges)
Use any of the following, preferring fast paths:

1) Explorer quick path (fastest):
- Explorer pages show the contract creator and age. Example on BaseScan for a TBA: [`0x5d6cfaf45b57a0d374c5f70c8c02b022ae456aa7`](https://basescan.org/address/0x5d6cfaf45b57a0d374c5f70c8c02b022ae456aa7). Record its creation block/time and persist as `creation_block`/`creation_timestamp` to set the earliest scan window.

2) On-chain (robust, no external API):
- If ERC‑4337 smart account: filter EntryPoint `AccountDeployed` events where `account == <tba_address>`; the log’s block/time is the creation point.
- If ERC‑6551 Token Bound Account: filter the ERC‑6551 Registry `AccountCreated` events where `account == <tba_address>`.
- Generic fallback: binary search on `eth_getCode(address, blockTag)` to find the first block where code is non-empty, then read that block’s timestamp.

Persist the discovered creation block/time in `State` so the scanner only queries from that block onward.

## Iteration plan
- expand event struct, write/initiate/update in current flows; UI reads/enriches display.
- implement scanner (USDC + EntryPoint), last_scanned_block, confirmations, native gas totals.
- add `/api/events`, `/api/clients/summary`; increase retention.

## Heuristic flow and scan policy (tradeoffs-first)
1) Preflight: resolve chain_id, USDC, EntryPoint, TBA; load `client_id -> wallet` mapping.
2) Bounds: find and persist `creation_block`/`creation_timestamp`. If age exceeds a conservative threshold, warn and default to a capped lookback; offer background backfill.
3) Two-track indexing: (a) targeted enrichment for known tx_hash/user_op_hash from initiated events; (b) incremental getLogs for USDC and EntryPoint filtered by client wallets.
4) Caching & batching: cache receipts; adapt window sizes; exponential backoff on rate limits.
5) Cheap validation: finalize ranges with a compact digest of tx hashes; keep a small reorg tail (e.g., 12 blocks) for rescan.
6) Identity & idempotency: use tx_hash as primary; attach user_operation_hash when available.
7) UI gating: render initiated events immediately; enrich progressively; surface indexing status.
8) Backfill: opt-in, chunked, resumable; never blocks UI.

## USDC history (defer in-operator storage)
- Keep operator lean; avoid adding new in-process state for USDC.
- For ad-hoc checks, rely on Basescan `tokentx` with time→block resolution.
- For durable indexing, plan to offload to a sibling cacher (erc20-cacher) later.

## References
- BaseScan example (contract page shows creator and age): [`0x5d6cfaf45b57a0d374c5f70c8c02b022ae456aa7`](https://basescan.org/address/0x5d6cfaf45b57a0d374c5f70c8c02b022ae456aa7)

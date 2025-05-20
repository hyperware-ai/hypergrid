# HPN Operator Client

This document details the architecture and functionality of the HPN Operator Client process.

**Current Status:** The client implements the core TBA-based payment flow, successfully executing ETH payments via a delegated hot wallet using the `hpn-wallet.<node>.hypr` sub-entry pattern. Identity setup and delegation verification are functional. UI for Shim key generation exists. Further work is needed on backend Shim API key validation, provider address lookup, robust note decoding, HNS/P2P integration, USDC payment verification, and configuration UI.

## Core Purpose

The Operator Client serves as the central hub for the HPN Beta network. Its primary responsibilities are:

1.  **Node Identity:** Operates under the identity of a specific Hypermap sub-entry (e.g., `hpn-wallet.<node_name>.hypr`) which **must** use the `HyperAccountAccessControlMinter` implementation. The client verifies this setup on initialization.
2.  **Hot Wallet Management:** Manages local EOA wallets ("hot wallets") used to sign transactions on behalf of the main operator identity.
3.  **Indexing Providers:** Maintains a local cache (SQLite DB) of available HPN providers listed under `hpn-beta.hypr`. Provider details are synced from Hypermap notes.
4.  **Servicing Search Requests:** Handles `search-registry` requests from LLMs (via an MCP Shim) using the local provider cache.
5.  **Facilitating Provider Calls:** Handles `call-provider` requests from LLMs (via MCP Shim). This involves:
    *   Identifying the target provider entry (e.g., `providername.hpn-beta.hypr`).
    *   Reading the provider's `~wallet` note to get their TBA address.
    *   Reading the provider's `~price` note.
    *   **Payment Execution:** If required, sends payments *from* the Operator's configured TBA (e.g., `hpn-wallet.<node_name>.hypr`'s TBA) *to* the Provider's TBA. This transaction is authorized and signed by the Operator's configured *hot wallet* via the `HyperAccountAccessControlMinter`'s `execute` function and the on-chain `~access-list`/`~hpn-signers` delegation notes under the Operator's sub-entry.
    *   Routing the actual service call request to the provider via P2P networking (using HNS resolution on `~provider-id`).
6.  **Providing a User Interface:** Offers a web-based dashboard for monitoring, managing hot wallets, viewing history, and configuring settings (API key, potentially operator identity name).

## Key Code Modules (`hpn-client/hpnclient/src/`)

*   **`lib.rs`:** Main entry point. Initializes other modules, sets up HTTP server, runs main message loop. Includes debug command handlers.
*   **`identity.rs`:** Handles initialization logic for verifying the operator's sub-entry (`hpn-wallet.<node_name>.hypr`), checking its implementation contract, and storing the verified name/TBA address in state.
*   **`wallet_manager.rs`:** Manages the lifecycle (creation, import, encryption, activation, selection) of the *hot wallet* EOAs used by the client. Implements the `execute_payment_if_needed` function which constructs and sends the TBA `execute` transaction (signed by the hot wallet) for payments. Includes delegation verification (`verify_selected_hot_wallet_delegation`). **Note:** Delegation verification logic assumes correctly formatted (raw byte) data in `~access-list`/`~hpn-signers` notes.
*   **`chain.rs`:** Handles blockchain interactions: syncing Hypermap events (Mints, Notes) into the local DB, providing `eth::Provider` for calls, fetching note data (`get_hypermap_note_data`), and checking proxy implementations (`get_implementation_address`).
*   **`http_handlers.rs`:** Processes incoming HTTP requests from the UI and MCP Shim, orchestrating searches, provider calls (including payment initiation), and wallet management actions.
*   **`structs.rs`:** Defines core data structures (`State`, `ManagedWallet`, `ProviderInfo`, `CallRecord`, etc.) and WIT definitions.
*   **`db.rs`:** SQLite database interactions (schema, inserts, queries).
*   **`helpers.rs`:** Utility functions.

## Interfaces

1.  **MCP Shim Interface:** `/api/shim/mcp` endpoint expecting API key auth for `search-registry` and `call-provider`. *(Backend validation logic pending)*.
2.  **Web UI Interface:** Serves static UI files (`/`) and handles authenticated API calls (`/api/*`) for dashboard data, wallet management, API key generation (`/api/save-shim-key`), etc.
3.  **Blockchain Interface:** Uses `hyperware_process_lib` (`eth::Provider`, `wallet::*`, `hypermap::*`) for reading Hypermap data, checking balances, sending `execute` transactions via TBAs, and waiting for confirmations.
4.  **Hypermap Interface:** Directly reads notes (`get`) and implementation details (`get_storage_at`) via `chain.rs` and `identity.rs`. Relies on the user having set up `~access-list` and `~hpn-signers` notes correctly under the operator's sub-entry.
5.  **System Interface:** Handles timer messages (`timer:distro:sys`) for chain syncing/checkpointing and terminal commands (`terminal:sys`) for debugging.

## Required On-Chain Setup (Operator User)

For the client to function correctly, the user (operator) must ensure:

1.  Their primary Hypermap node entry exists (e.g., `your-node.hypr`).
2.  A sub-entry named `hpn-wallet.your-node.hypr` is minted under the primary entry.
3.  This sub-entry **must** be minted using the `HyperAccountAccessControlMinter` implementation address (`0x...8674`).
4.  The `~hpn-signers.hpn-wallet.your-node.hypr` note exists and contains the correctly ABI-encoded `address[]` of the hot wallet(s) managed by the `hpn-client` process (stored as raw bytes).
5.  The `~access-list.hpn-wallet.your-node.hypr` note exists and contains the correct 32-byte namehash of the `~hpn-signers.hpn-wallet.your-node.hypr` note (stored as raw bytes).
6.  The TBA address associated with `hpn-wallet.your-node.hypr` is funded with sufficient ETH (for gas) and USDC (for payments).

The `hpn-client` verifies prerequisites 2 & 3 on startup and includes a `check-prereqs` debug command to help users verify the full setup.

## Debug Commands

These commands can be sent to the running `hpn-client` process via the node's terminal interface (e.g., `m our@hpnclient:hpnclient:pkg.os '<command>'`).

*   `state`: Print current in-memory state.
*   `db`: Check local DB schema.
*   `reset`: Reset state and wipe/reinit DB (requires process restart).
*   `verify`: Check on-chain delegation for selected hot wallet.
*   `namehash <path>`: Calculate Hypermap namehash (e.g., `namehash ~note.entry.hypr`).
*   `pay <amount>`: Attempt test USDC payment from Operator TBA to test address.
*   `pay-eth <amount>`: Attempt test ETH payment from Operator TBA to test address.
*   `implementation <tba>`: Print implementation address for a given TBA proxy.
*   `check-prereqs`: Run a series of checks to verify operator setup.
*   `help` or `?`: Show this help message.
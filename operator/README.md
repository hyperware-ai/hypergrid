# Operator

## Usage
Please refer to the top-level README.md for usage documentation


## Outline
The purpose of the operator is to be the proxy between MCP tool calls (through our custom shim or Spider) and the Hypergrid protocol. The operator indexes the Hypergrid namespace, controls acount abstraction and associated TBA/hotwallet management, contains logic for handling multiple MCP clients and handles their authorization. It also supports gassless transactions.


## Important note
For the Operator to function properly, when minting wallets for Hypergrid use, it is important to use the same wallet address that was used to mint the node namespace entry. Otherwise, the TBA system does not work.

Furthermore, as of 10/23/2025, there is a version missmatch between MCP shim and provider that is currently in the appstore: the shim NPM package was updated to interact with the hyperapp refactor (which work in progress). So, when trying to use the shim, we must pin the shim version to 1.2.0.
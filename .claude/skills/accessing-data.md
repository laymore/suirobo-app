---
name: accessing-data
description: >
  Query onchain state, subscribe to events, build indexing pipelines, and store
  blobs with Walrus. Use when choosing between gRPC/GraphQL/custom indexers,
  querying objects, subscribing to events, or building data pipelines.
---

# Accessing Data on Sui

> **Deprecation notice:** JSON-RPC is deprecated. Migrate to gRPC or GraphQL RPC by July 2026.

## Four canonical data surfaces

| Surface | Best for | Latency |
|---------|----------|---------|
| **gRPC** | Backends, indexers, real-time | Lowest |
| **GraphQL RPC** | Frontends, dashboards, flexible queries | Low |
| **Archival Store** | Historical data beyond full-node pruning | Higher |
| **Custom indexer (`sui-indexer-alt`)** | Application-specific pipelines | Varies |

## Routing table

| Task | Use |
|------|-----|
| Read current object state | gRPC or GraphQL RPC |
| Subscribe to events | gRPC streaming |
| Build a leaderboard / rich query | GraphQL RPC |
| Query data older than full-node pruning window | GraphQL RPC → Archival |
| Custom aggregations / materialized views | `sui-indexer-alt` |
| Store large blobs off-chain | Walrus |

## gRPC

Low-latency, real-time, protobuf-based; served by Sui full nodes.

```
mainnet: grpc.mainnet.sui.io:443
testnet: grpc.testnet.sui.io:443
```

Use for backends and indexers that need the lowest possible latency.

## GraphQL RPC

Flexible relational queries; best for frontends and dashboards.

```
mainnet: https://sui-mainnet.mystenlabs.com/graphql
testnet: https://sui-testnet.mystenlabs.com/graphql
```

## Custom indexer

Use `sui-indexer-alt` for application-specific pipelines that need custom schemas, materialized views, or aggregations not served by the public APIs.

## Walrus (off-chain blobs)

For data that exceeds Sui's 256 KB object limit. Blobs are content-addressed and referenced by blob ID stored onchain.

```bash
walrus store --file my-data.json --epochs 30
walrus read <BLOB_ID>
```

## Key rules

- Do **not** assume gRPC clients have archival fallback — full nodes prune old data
- Do **not** use JSON-RPC in new code
- Objects cannot exceed 256 KB — use Walrus for larger data
- gRPC for backends/indexers; GraphQL RPC for frontends/tools

## Sources

- https://docs.sui.io/references/sui-api
- https://docs.wal.app

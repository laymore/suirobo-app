---
name: composable-move-functions
description: >
  Design composable Move APIs with the right visibility, parameter order, and
  return patterns. Use when designing public vs entry functions, PTB-compatible
  APIs, parameter ordering, or functions that return objects vs transfer internally.
---

# Composable Move Functions

## Visibility strategy

| Visibility | Use for |
|-----------|---------|
| `public` | Functions composable across modules and PTBs |
| `entry` | Transaction endpoints only (no return values to PTBs) |
| `public(package)` | Cross-module within same package, changeable in upgrades |

> **Prohibited:** `public entry` — redundant and restrictive.

## Object handling: yield vs transfer

Public functions must **yield objects to callers** rather than transferring internally:

```move
// Good — caller controls destination
public fun create_nft(name: String, ctx: &mut TxContext): NFT {
    NFT { id: object::new(ctx), name }
}

// Bad — internal transfer blocks PTB composition
public fun create_nft(name: String, ctx: &mut TxContext) {
    let nft = NFT { id: object::new(ctx), name };
    transfer::transfer(nft, ctx.sender());  // caller loses control
}
```

For convenience, add a separate `entry` wrapper:

```move
entry fun create_and_keep(name: String, ctx: &mut TxContext) {
    let nft = create_nft(name, ctx);
    transfer::transfer(nft, ctx.sender());
}
```

## Parameter ordering

1. Primary objects being modified
2. Authorization tokens (capabilities)
3. Scalar values (amounts, flags)
4. `&Clock` reference (exception to object-first rule)
5. `&mut TxContext` — always last

```move
public fun swap(
    pool: &mut Pool,          // 1. primary object
    cap: &AdminCap,           // 2. authorization
    amount: u64,              // 3. scalar
    clock: &Clock,            // 4. clock
    ctx: &mut TxContext,      // 5. context last
): Coin<SUI>
```

## Note on `sui client call`

Functions returning non-`drop` values cannot be invoked via `sui client call` due to unused value constraints. Use `sui client ptb` instead — it supports assignment and transfer of return values.

## Sources

- https://move-book.com/programmability/
- https://docs.sui.io/concepts/sui-move-concepts

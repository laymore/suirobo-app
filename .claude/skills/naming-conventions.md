---
name: naming-conventions
description: >
  Apply consistent naming to Move structs, constants, events, capabilities, and
  dynamic field keys. Use when naming error constants, capabilities, events,
  getter functions, hot potato types, or dynamic field keys.
---

# Move Naming Conventions

All conventions from the official Sui code quality checklist at move-book.com.

## Error constants

Use `EPascalCase` with the `#[error]` attribute:

```move
#[error]
const ENotAuthorized: vector<u8> = b"Caller is not authorized to perform this action";

#[error]
const EInsufficientBalance: vector<u8> = b"Insufficient balance for this operation";
```

The `#[error]` decorator enables clearer error output in explorers and wallets.

## Regular constants

Use `ALL_CAPS`:

```move
const FEE_NUMERATOR: u64 = 30;
const MAX_SUPPLY: u64 = 1_000_000_000;
```

## Capability structs

Add a `Cap` suffix:

```move
public struct AdminCap has key, store { id: UID }
public struct MintCap has key, store { id: UID }
public struct PauseCap has key, store { id: UID }
```

## Events

Use past tense to reflect completed actions:

```move
// Good
public struct PoolCreated has copy, drop { pool_id: ID }
public struct TokenMinted has copy, drop { amount: u64 }

// Bad
public struct CreatePool has copy, drop { ... }
public struct MintToken has copy, drop { ... }
```

## Getter functions

Name after the field, **not** prefixed with `get_`:

```move
// Good
public fun balance(pool: &Pool): u64 { pool.balance }
public fun balance_mut(pool: &mut Pool): &mut u64 { &mut pool.balance }

// Bad
public fun get_balance(pool: &Pool): u64 { pool.balance }
```

Mutable variants use `_mut` suffix.

## Hot potato types

Do **not** include "Potato" in the name — the absence of abilities signals the pattern:

```move
// Good
public struct FlashLoanReceipt { amount: u64 }

// Bad
public struct FlashLoanPotato { amount: u64 }
```

## Dynamic field keys

Use positional struct with `Key` suffix:

```move
public struct ItemKey(String) has copy, drop, store;
public struct BalanceKey(address) has copy, drop, store;
```

## Sources

- https://move-book.com/programmability/move-style-guide.html

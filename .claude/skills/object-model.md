---
name: object-model
description: >
  Model data with Sui objects: ownership types, dynamic fields, collections,
  wrapping, and transfer rules. Use when designing object ownership, choosing
  between Table/Bag/VecMap, working with dynamic fields, or implementing patterns
  like hot potato, capability, borrow, soulbound, or inventory.
---

# Sui Object Model

## Ownership types

| Type | Description | Execution |
|------|-------------|-----------|
| Address-owned | Owned by a Sui address | Parallel |
| Shared | Accessible by anyone | Requires consensus |
| Immutable | Frozen, read-only | Parallel |
| Wrapped | Stored inside another object | Via parent |

## Object versioning

Every object has a version number incremented on each mutation. Read-only references don't bump versions.

## Dynamic fields

```move
use sui::dynamic_field;
use sui::dynamic_object_field;

// Add a field
dynamic_field::add(&mut obj.id, key, value);

// Borrow
let val = dynamic_field::borrow<Key, Value>(&obj.id, key);

// Remove
let val = dynamic_field::remove<Key, Value>(&mut obj.id, key);

// Object fields (value is a Sui object, accessible independently)
dynamic_object_field::add(&mut obj.id, key, child_obj);
```

## Collections

| Collection | Keys | Values | Notes |
|-----------|------|--------|-------|
| `Table<K,V>` | Any `store` | Any `store` | Homogeneous, size tracked |
| `Bag` | Any `store` | Any `store` | Heterogeneous |
| `VecMap<K,V>` | Any `copy+drop` | Any | Small maps, O(n) lookup |
| `LinkedTable<K,V>` | Any `copy+drop+store` | Any `store` | Ordered iteration |
| `ObjectTable<K,V>` | Any | Objects | Objects remain accessible |
| `ObjectBag` | Any | Objects | Heterogeneous objects |

## Wrapping patterns

```move
// Wrap an object inside another
public struct Vault has key {
    id: UID,
    coin: Coin<SUI>,  // wrapped — not independently accessible
}

// Unwrap
public fun withdraw(vault: Vault, ctx: &mut TxContext): Coin<SUI> {
    let Vault { id, coin } = vault;
    object::delete(id);
    coin
}
```

## Common patterns

### Hot potato

No abilities — must be consumed in the same PTB:

```move
public struct FlashLoanReceipt { amount: u64 }

public fun borrow(pool: &mut Pool, amount: u64): (Coin<SUI>, FlashLoanReceipt) { ... }
public fun repay(pool: &mut Pool, coin: Coin<SUI>, receipt: FlashLoanReceipt) { ... }
```

### Capability

```move
public struct AdminCap has key, store { id: UID }

public fun admin_only(_cap: &AdminCap, ...) { ... }
```

### Soulbound (non-transferable)

```move
public struct SoulboundBadge has key { id: UID }  // no `store`
// Cannot be transferred with public_transfer — only within defining module
```

### Object Display (V2)

```move
use sui::display;

let mut d = display::new<MyNFT>(&publisher, ctx);
d.add(b"name", b"{name}");
d.add(b"image_url", b"https://example.com/{id}");
display::update_version(&mut d);
transfer::public_freeze_object(d);
```

## Sources

- https://docs.sui.io/concepts/object-model
- https://move-book.com/programmability/

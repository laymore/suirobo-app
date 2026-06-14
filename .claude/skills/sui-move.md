---
name: sui-move
description: >
  Write and debug Move smart contracts covering abilities, init functions,
  one-time witnesses, upgrades, and custom coins. Use when writing Move code,
  reviewing contracts, debugging issues, creating fungible tokens, or working
  with TxContext and Clock objects.
---

# Sui Move

## Object Abilities

| Ability | Meaning |
|---------|---------|
| `key` | Can be stored as a Sui object (requires `id: UID` field) |
| `store` | Can be stored inside other objects |
| `copy` | Can be copied |
| `drop` | Can be silently discarded |

## Creating objects

```move
use sui::object::{Self, UID};
use sui::tx_context::TxContext;

public struct MyObject has key {
    id: UID,
    value: u64,
}

public fun create(ctx: &mut TxContext): MyObject {
    MyObject {
        id: object::new(ctx),  // Always use object::new(ctx) for UIDs
        value: 0,
    }
}
```

## init function

Runs once at publish time:

```move
fun init(ctx: &mut TxContext) {
    // Create and transfer initial objects
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}
```

## One-Time Witness (OTW)

Used for creating unique coin types or registering with protocols:

```move
public struct MY_COIN has drop {}

fun init(witness: MY_COIN, ctx: &mut TxContext) {
    let (treasury, metadata) = coin::create_currency(
        witness, 9, b"MC", b"MyCoin", b"", option::none(), ctx
    );
    transfer::public_freeze_object(metadata);
    transfer::public_transfer(treasury, ctx.sender());
}
```

## Transfers

```move
// For objects with store ability, called outside defining module
transfer::public_transfer(obj, recipient);

// For objects without store, within defining module
transfer::transfer(obj, recipient);

// Share an object
transfer::share_object(obj);

// Freeze an object
transfer::public_freeze_object(obj);
```

## Events

```move
use sui::event;

// Event structs require copy and drop abilities
public struct MyEvent has copy, drop {
    value: u64,
}

event::emit(MyEvent { value: 42 });
```

## Destroying objects

Objects without `drop` must be explicitly unpacked:

```move
public fun destroy(obj: MyObject) {
    let MyObject { id, value: _ } = obj;
    object::delete(id);
}
```

## Key rules

- Always use `object::new(ctx)` for UIDs
- Use `public_transfer` for `store` objects called outside the defining module
- Event structs require `copy` and `drop` abilities
- No numeric `as` casts — use `from`/`into` or `try_from`/`try_into`
- `public entry` is prohibited — use `public` or `entry` separately

## Sources

- https://docs.sui.io/concepts/sui-move-concepts
- https://move-book.com

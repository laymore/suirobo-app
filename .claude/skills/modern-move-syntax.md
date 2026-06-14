---
name: modern-move-syntax
description: >
  Write idiomatic Move with 2024 edition syntax: method calls, string literals,
  vectors, options, and more. Use when modernizing Move code, using dot notation,
  macros like do!, match expressions, positional structs, or enums.
---

# Modern Move Syntax (2024 Edition)

Requires `edition = "2024"` in `Move.toml`.

## Module declaration

```move
// New: file is the module body
module my_project::my_module;

use sui::object::UID;
// imports, structs, functions follow at top level
```

## Method call syntax

```move
// Old
coin::value(&payment)
tx_context::sender(ctx)
vector::length(&v)

// New (dot notation)
payment.value()
ctx.sender()
v.length()
```

## String literals

```move
// Old
string::utf8(b"hello")

// New
"hello"
```

## Vector literals

```move
// Old
let v = vector::empty<u64>();
vector::push_back(&mut v, 10);

// New
let v = vector[10u64];
v.push_back(20);
```

## Iteration macros

```move
// Numeric loop (replaces manual counter while loops)
10u64.do!(|i| {
    // i = 0..9
});

// Vector iteration (immutable)
v.do_ref!(|elem| {
    // use elem
});

// Create a vector: [0, 1, 2, 3, 4]
let v = vector::tabulate!(5, |i| i);
```

## Struct unpacking with `..`

```move
// Old
let S { id, field_1: _, field_2: _ } = value;

// New
let S { id, .. } = value;
```

## Positional structs

```move
public struct Wrapper(u64) has copy, drop;

let w = Wrapper(42);
let Wrapper(inner) = w;
```

## Enums with pattern matching

```move
public enum Direction has copy, drop {
    North,
    South,
    East,
    West,
}

let dir = Direction::North;
let label = match (dir) {
    Direction::North => "north",
    Direction::South => "south",
    _ => "other",
};
```

> Enums cannot have the `key` ability. Use them as stored fields, not top-level objects.

## Sources

- https://move-book.com/reference/move-2024-migration.html
- https://docs.sui.io/concepts/sui-move-concepts/move-2024

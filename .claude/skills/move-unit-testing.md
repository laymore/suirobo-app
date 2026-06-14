---
name: move-unit-testing
description: >
  Write and structure Move unit tests with proper naming, assertions, context
  usage, and cleanup. Use when writing tests, using test_scenario, assert_eq!,
  expected_failure, or testing init functions and shared objects.
---

# Move Unit Testing

## Naming

Use descriptive statement names **without** the `test_` prefix:

```move
// Good
#[test]
fun create_pool_with_initial_liquidity() { ... }

// Bad
#[test]
fun test_create_pool() { ... }
```

## Assertions

```move
// Preferred — displays both values on failure
assert_eq!(actual, expected);

// Only for boolean conditions
assert!(condition);

// Don't pass numeric abort codes in tests — they can collide with app error codes
```

## Attributes

Merge `#[test]` and `#[expected_failure]` on a single line:

```move
#[test, expected_failure(abort_code = ENotAuthorized, location = my_module)]
fun unauthorized_caller_is_rejected() {
    // No cleanup needed after the expected abort — unreachable code
}
```

Include `location` when testing aborts from another module.

## Context Usage

```move
// Simple tests — use dummy context
let ctx = tx_context::dummy();

// Multi-tx, shared objects, auth testing, init validation — use test_scenario
use sui::test_scenario;

let mut scenario = test_scenario::begin(@alice);
{
    let ctx = scenario.ctx();
    // ... setup
};
scenario.next_tx(@alice);
{
    // ... next transaction
};
scenario.end();
```

## Cleanup

```move
// Preferred for destroying objects in tests
use sui::test_utils;
test_utils::destroy(obj);
```

## Testing init functions

Use `test_scenario` to validate `init` — it runs `init` on `begin`:

```move
let mut scenario = test_scenario::begin(@admin);
// init is called here automatically
scenario.next_tx(@admin);
{
    // assert objects created by init
};
scenario.end();
```

## Sources

- https://move-book.com/testing/
- https://docs.sui.io/guides/developer/first-app/write-package

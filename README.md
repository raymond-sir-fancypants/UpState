# UpState

A lightweight, dependency-free JavaScript state management library for the browser.

UpState gives you a simple, predictable way to manage application state — with optional persistence to `localStorage` or `sessionStorage`, automatic date hydration on load, an event-driven API built on native `EventTarget`, and safe result handling that never throws on missing data.

---

## What's new in v1.2.0

- **Automatic date hydration** — ISO 8601 date strings stored in `localStorage` or `sessionStorage` are automatically revived as native `Date` objects when UpState loads. No manual conversion needed.
- **Rewritten `deepMerge`** — cleaner implementation that correctly clones both sides before merging, preventing any reference leakage.
- **Synchronous events** — `update` events fire synchronously, immediately after the state is updated. Calling `UpState.get()` inside a listener always returns the new value.
- **Batch events no longer include `state`** — removed from `batchSet` and `batchRemove` event detail for performance. Use `UpState.get()` inside the listener if you need the current state.

---

## Features

- 📦 Zero dependencies
- 🔒 Fully encapsulated state — enforced by private class fields
- 📅 Automatic ISO date hydration on load
- 🧠 In-memory state tree with optional persistence
- 🔁 Synchronous event-driven API — state is always up-to-date when listeners run
- 🛡️ Safe, immutable `Result` wrapper — never throws on missing data
- 📂 Nested state support via dot or slash routes (`"user/profile/name"`)
- ⚡ Batch operations for efficient multi-value reads and writes

---

## Installation

Copy `UpState.js` into your project and import it:

```js
import UpState from './UpState.js';
```

---

## Recommended — Call `config()` First

`config()` should ideally be the **first call** before any `set`, `get`, or `remove` operations. This ensures persistence rules are in place from the start.

Calling `config()` after state already exists is safe — any collections matching `persistantCollections` will be persisted immediately when `config()` runs.

```js
// ✅ Recommended
import UpState from './UpState.js';

UpState.config({
  persistantCollections: [{ user: "permanent" }, { cart: "session" }]
});

UpState.set({ collection: "user", state: { name: "Alice" } });
```

```js
// ✅ Also valid — existing state is persisted when config() runs
UpState.set({ collection: "user", state: { name: "Alice" } });
UpState.config({ persistantCollections: [{ user: "permanent" }] });
```

---

## Quick Start

```js
import UpState from './UpState.js';

UpState.config({
  persistantCollections: [{ user: "permanent" }, { cart: "session" }]
});

// Set state
UpState.set({ collection: "user", state: { name: "Alice", joined: new Date() } });

// Get state
const user = UpState.get("user").raw;
console.log(user.name);   // "Alice"
console.log(user.joined); // Date object — even after a page reload

// Get full state snapshot
const everything = UpState.get().raw;

// Listen for changes — state is already updated when this fires
UpState.addEventListener("update", (e) => {
  console.log(e.detail.action);     // "set"
  console.log(e.detail.collection); // "user"
});

// Remove state
UpState.remove("user");
```

---

## State Encapsulation

The internal state tree is stored in a **private class field** (`#state`), enforced at the language level.

```js
UpState.#state;        // SyntaxError — always, no workaround
UpState.state = {};    // Silently ignored — Object.freeze blocks this
```

All reads and writes must go through the public methods. This guarantees events always fire, persistence always runs, and the state tree is never accidentally corrupted.

---

## Date Hydration

When UpState restores persisted state on page load, it automatically converts any ISO 8601 date strings back into native `Date` objects. This means dates survive `localStorage` and `sessionStorage` without any manual handling.

```js
// First visit
UpState.set({
  collection: "user",
  state: { name: "Alice", joined: new Date() },
  persistence: "permanent"
});

// After a page reload — `joined` is a Date, not a string
const user = UpState.get("user").raw;
user.joined instanceof Date; // true
```

Only strings matching the ISO 8601 format (`YYYY-MM-DDTHH:MM:SS...`) are converted. Other date-like strings are left as-is:

```js
// These are NOT converted
{ label: "April 26, 2026" }   // plain string — left alone
{ label: "04-26-2026 14:00" } // non-ISO — left alone

// This IS converted
{ created: "2026-04-26T14:55:00.000Z" } // → Date object
```

---

## API

### `UpState.config(options)`

Configures UpState behaviour. Recommended as the first call, but safe to call at any point.

| Option | Type | Default | Description |
|---|---|---|---|
| `persistantCollections` | `Array<Object>` | `[]` | Maps collection names to their persistence type |
| `allowEventDispatches` | `boolean` | `true` | Set to `false` to disable all `update` events globally |

```js
UpState.config({
  persistantCollections: [
    { user: "permanent" },  // saved to localStorage
    { cart: "session" }     // saved to sessionStorage
  ]
});
```

---

### `UpState.set({ collection, state, route?, persistence? })`

Sets a value in the state tree.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `collection` | `string` | ✅ | Top-level collection name |
| `state` | `*` | ✅ | The value to store (anything except `undefined`) |
| `route` | `string` | ❌ | Dot or slash path within the collection |
| `persistence` | `"session"` \| `"permanent"` | ❌ | Overrides config-level persistence for this call only |

**Persistence priority:** call-level `persistence` takes priority over config-level. If no valid call-level value is provided, the method falls back to `persistantCollections`.

```js
UpState.set({ collection: "user", state: { name: "Alice" } });
UpState.set({ collection: "user", route: "profile/age", state: 30 });

// Override config-level persistence for this call only
UpState.set({ collection: "cache", state: {}, persistence: "session" });
```

---

### `UpState.get(collection?, route?)`

Retrieves a value from the state tree. Returns a [`Result`](#the-result-object). Never throws on missing data — returns a `Result` wrapping `null` instead.

Calling `get()` with no arguments returns a full deep clone of the entire state tree.

```js
const user    = UpState.get("user").raw;
const age     = UpState.get("user", "profile/age").raw;
const allData = UpState.get().raw; // full state snapshot
```

---

### `UpState.remove(collection, route?)`

Removes a value from the state tree and from both storage drivers.

```js
UpState.remove("user");                // removes entire collection
UpState.remove("user", "profile/age"); // removes a specific nested value
```

---

### `UpState.batchSet(array)`

Sets multiple values in one call. Fires a single `update` event when all writes are done.

```js
UpState.batchSet([
  { collection: "user", state: { name: "Alice" } },
  { collection: "settings", route: "theme", state: "dark" }
]);
```

---

### `UpState.batchGet(array)`

Retrieves multiple values in one call. Returns a `Result` wrapping an object keyed by collection name.

```js
const result = UpState.batchGet([
  { collection: "user" },
  { collection: "settings", route: "theme" }
]);

result.raw; // { user: [{ name: "Alice", ... }], settings: ["dark"] }
```

---

### `UpState.batchRemove(array)`

Removes multiple values in one call. Fires a single `update` event when all removals are done.

```js
UpState.batchRemove([
  { collection: "cart" },
  { collection: "user", route: "profile/age" }
]);
```

---

## The `Result` Object

All `get` calls return an **immutable** `Result`. The wrapped value is in a private field and the instance is frozen — it cannot be modified from outside. Three getters let you consume the data in different formats, all null-safe:

| Getter | Returns | Null-safe? |
|---|---|---|
| `.raw` | The value as-is, or `null` | ❌ |
| `.list` | Always an array | ✅ |
| `.map` | Always a plain object | ✅ |

```js
const result = UpState.get("tags"); // stored as ["js", "css"]

result.raw;  // ["js", "css"]
result.list; // ["js", "css"]
result.map;  // { 0: "js", 1: "css" }

const empty = UpState.get("doesNotExist");
empty.raw;   // null
empty.list;  // []
empty.map;   // {}
```

### Iteration Methods

Two methods let you transform state without extra boilerplate. Both return a **new** value — they never mutate the `Result`. If the callback returns `undefined`, the item is set to `null`.

#### `result.iterateAsMap(callback)`

Iterates over the value as a plain object. Callback receives `(key, value)`.

```js
const prices = UpState.get("prices");
// raw: { apple: 1.00, banana: 0.50 }

const discounted = prices.iterateAsMap((key, value) => value * 0.9);
// { apple: 0.9, banana: 0.45 }
```

#### `result.iterateAsList(callback)`

Iterates over the value as an array. Callback receives `(index, value)`.

```js
const tags = UpState.get("tags");
// raw: ["js", "css", "html"]

const upper = tags.iterateAsList((i, value) => value.toUpperCase());
// ["JS", "CSS", "HTML"]
```

---

## Routes

Nested state can be accessed using dot (`.`) or slash (`/`) notation interchangeably:

```js
UpState.set({ collection: "app", route: "user/profile/name", state: "Alice" });

UpState.get("app", "user/profile/name").raw; // "Alice"
UpState.get("app", "user.profile.name").raw; // "Alice"
```

---

## Events

UpState fires a **synchronous** `update` event after every state change. The state is fully updated before the event fires — calling `UpState.get()` inside a listener always returns the new value.

### `set`
```js
UpState.addEventListener("update", (e) => {
  const { action, collection, route, state, destination } = e.detail;
});
```

### `remove`
Same shape as `set`, with `state` being the parent object after deletion.

### `batchSet`
```js
UpState.addEventListener("update", (e) => {
  const { action, count, collections, stateInputs } = e.detail;
  // Use UpState.get() if you need the current state values
});
```

### `batchRemove`
```js
UpState.addEventListener("update", (e) => {
  const { action, count, collections } = e.detail;
});
```

> **Note:** `batchSet` and `batchRemove` events do not include a `state` snapshot in `detail`. This is intentional — cloning the entire state tree on every batch operation is expensive. Call `UpState.get()` inside the listener if you need the current values.

---

## Error Handling

UpState throws `UpStateError` for invalid usage. Each error has a `code` property for programmatic handling:

| Code | Thrown by | Reason |
|---|---|---|
| `MISSING_COLLECTION_REF` | `set`, `get`, `remove` | `collection` is missing or an empty string |
| `INVALID_COLLECTION_REF` | `set`, `get`, `remove` | `collection` is not a string |
| `INVALID_STATE_VALUE` | `set` | `state` is `undefined` |
| `INVALID_PERSISTENCE_VALUE` | `set` | `persistence` is not `"session"` or `"permanent"` |
| `MISSING_CONFIG_ERR` | `config` | `persistantCollections` is not an array |
| `INVALID_BATCH_SET_ARGUMENT` | `batchSet` | argument is not an array |
| `INVALID_BATCH_GET_ARGUMENT` | `batchGet` | argument is not an array |
| `INVALID_BATCH_REMOVE_ARGUMENT` | `batchRemove` | argument is not an array |

```js
try {
  UpState.set({ collection: "", state: "test" });
} catch (e) {
  console.log(e.name);    // "UpStateError"
  console.log(e.code);    // "MISSING_COLLECTION_REF"
  console.log(e.message); // "collection name is required"
}
```

---

## Persistence

State is stored under a single `"UpState"` key in storage. On page load, UpState restores state from both `localStorage` and `sessionStorage`, merges them (localStorage takes priority), and hydrates any ISO date strings back into `Date` objects.

**Persistence priority — highest to lowest:**
1. **Call-level** — `persistence` passed directly to `set()`
2. **Config-level** — collection listed in `persistantCollections`
3. **None** — in-memory only, cleared on page unload

```js
UpState.config({
  persistantCollections: [{ cart: "session" }]
});

// Call-level overrides config for this one write only
UpState.set({ collection: "cart", state: { item: "shoes" }, persistence: "permanent" });
```

---

## Browser Support

UpState uses private class fields (`#field`), supported in all modern browsers since 2021. It is not compatible with Internet Explorer.

---

## License

MIT

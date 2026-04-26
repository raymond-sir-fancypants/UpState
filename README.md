# UpState

A lightweight, dependency-free JavaScript state management library for the browser.

UpState gives you a simple, predictable way to manage application state — with optional persistence to `localStorage` or `sessionStorage`, an event-driven API built on native `EventTarget`, and safe result handling that never throws on missing data.

---

## What's new in v1.0.1

- **Hot config plugging** — calling `config()` after state already exists is now fully supported. Any collections listed in `persistantCollections` that are already in state will be persisted immediately when `config()` runs.
- **Immutable `Result` objects** — `Result` instances are now frozen. The wrapped value is stored in a private field and cannot be modified from outside.
- **`Result` iteration methods** — `iterateAsMap()` and `iterateAsList()` reduce boilerplate when transforming state.
- **`get()` with no arguments** — calling `UpState.get()` now returns a full clone of the entire state tree.
- **Call-level persistence priority** — passing `persistence` directly to `set()` now correctly overrides the collection's config-level persistence for that call.

---

## Features

- 📦 Zero dependencies
- 🔒 Fully encapsulated state — enforced by private class fields
- 🧠 In-memory state tree with optional persistence
- 🔁 Event-driven — listen for any state change via the `update` event
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

`config()` should ideally be the **first call** you make, before any `set`, `get`, or `remove` operations. This ensures persistence rules and event settings are in place from the start.

As of v1.0.1, calling `config()` after state already exists is safe — any matching collections already in state will be persisted immediately.

```js
// ✅ Recommended
import UpState from './UpState.js';

UpState.config({
  persistantCollections: [{ user: "permanent" }, { cart: "session" }]
});

UpState.set({ collection: "user", state: { name: "Alice" } });
```

```js
// ✅ Also valid in v1.0.1 — existing state is persisted when config() runs
UpState.set({ collection: "user", state: { name: "Alice" } });
UpState.config({ persistantCollections: [{ user: "permanent" }] });
```

---

## Quick Start

```js
import UpState from './UpState.js';

// 1. Configure first (recommended)
UpState.config({
  persistantCollections: [{ user: "permanent" }, { cart: "session" }]
});

// 2. Set state
UpState.set({ collection: "user", state: { name: "Alice", age: 30 } });

// 3. Get state
const user = UpState.get("user").raw;
console.log(user.name); // "Alice"

// 4. Get full state snapshot
const everything = UpState.get().raw;

// 5. Listen for changes
UpState.addEventListener("update", (e) => {
  console.log(e.detail.action);     // "set"
  console.log(e.detail.collection); // "user"
});

// 6. Remove state
UpState.remove("user");
```

---

## State Encapsulation

The internal state tree is stored in a **private class field** (`#state`). This is enforced at the language level — there is no workaround.

```js
UpState.#state;        // SyntaxError — always
UpState.state = {};    // Silently ignored — Object.freeze blocks this
```

All reads and writes must go through the provided methods. This guarantees that events always fire, persistence always runs, and the state tree is never accidentally corrupted.

---

## API

### `UpState.config(options)`

Configures UpState behaviour. Recommended as the first call, but safe to call at any point.

| Option | Type | Default | Description |
|---|---|---|---|
| `persistantCollections` | `Array<Object>` | `[]` | Maps collection names to their persistence type |
| `allowEventDispatches` | `boolean` | `true` | Set to `false` to disable all `update` events |

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

```js
UpState.set({ collection: "user", state: { name: "Alice" } });
UpState.set({ collection: "user", route: "profile/age", state: 30 });

// Override config-level persistence for this call only
UpState.set({ collection: "cache", state: {}, persistence: "session" });
```

---

### `UpState.get(collection?, route?)`

Retrieves a value from the state tree. Returns a [`Result`](#the-result-object) — never throws on missing data.

Calling `get()` with no arguments returns a full clone of the entire state tree.

```js
const user    = UpState.get("user").raw;
const age     = UpState.get("user", "profile/age").raw;
const allData = UpState.get().raw; // full state snapshot
```

---

### `UpState.remove(collection, route?)`

Removes a value from the state tree and from storage.

```js
UpState.remove("user");                // removes entire collection
UpState.remove("user", "profile/age"); // removes a specific nested value
```

---

### `UpState.batchSet(array)`

Sets multiple values in one call. Fires a single `update` event when done.

```js
UpState.batchSet([
  { collection: "user", state: { name: "Alice" } },
  { collection: "settings", route: "theme", state: "dark" }
]);
```

---

### `UpState.batchGet(array)`

Retrieves multiple values in one call. Returns a `Result` wrapping an object keyed by collection.

```js
const result = UpState.batchGet([
  { collection: "user" },
  { collection: "settings", route: "theme" }
]);

result.raw; // { user: [{...}], settings: ["dark"] }
```

---

### `UpState.batchRemove(array)`

Removes multiple values in one call. Fires a single `update` event when done.

```js
UpState.batchRemove([
  { collection: "cart" },
  { collection: "user", route: "profile/age" }
]);
```

---

## The `Result` Object

All `get` calls return an immutable `Result` object. The wrapped value is stored in a private field and cannot be changed from outside. Three getters let you consume the data in different formats:

| Getter | Returns | Null-safe? |
|---|---|---|
| `.raw` | The value as-is, or `null` | ✅ |
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

Two methods let you transform state without extra boilerplate. Both return a new value — they do not mutate the `Result`.

#### `result.iterateAsMap(callback)`

Iterates over the value as a plain object. The callback receives `(key, value)` and its return value becomes the new value for that key. If the callback returns `undefined`, the key is set to `null`.

```js
const prices = UpState.get("prices");
// { apple: 1.00, banana: 0.50 }

const discounted = prices.iterateAsMap((key, value) => value * 0.9);
// { apple: 0.9, banana: 0.45 }
```

#### `result.iterateAsList(callback)`

Iterates over the value as an array. The callback receives `(index, value)` and its return value becomes the new item at that index. If the callback returns `undefined`, the item is set to `null`.

```js
const tags = UpState.get("tags");
// ["js", "css", "html"]

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

UpState fires an `update` event on every state change. The `event.detail` object varies by action:

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
  const { action, count, collections, stateInputs, state } = e.detail;
});
```

### `batchRemove`
```js
UpState.addEventListener("update", (e) => {
  const { action, count, collections, state } = e.detail;
});
```

---

## Error Handling

UpState throws `UpStateError` for invalid usage. Each error has a `code` property for programmatic handling:

| Code | Thrown by | Reason |
|---|---|---|
| `MISSING_COLLECTION_REF` | `set`, `get`, `remove` | `collection` is missing or empty string |
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

State is stored under a single `"UpState"` key in storage to keep things tidy. On page load, UpState automatically restores any previously persisted state from both `localStorage` and `sessionStorage` and merges them into the initial state.

Persistence priority — from highest to lowest:
1. **Call-level** — `persistence` passed directly to `set()`
2. **Config-level** — collection listed in `persistantCollections`
3. **None** — in-memory only

```js
UpState.config({
  persistantCollections: [{ cart: "session" }] // config-level
});

// Call-level overrides config for this one call
UpState.set({ collection: "cart", state: { item: "shoes" }, persistence: "permanent" });
```

---

## Browser Support

UpState uses private class fields (`#field`), which are supported in all modern browsers since 2021. It is not compatible with Internet Explorer.

---

## License

MIT

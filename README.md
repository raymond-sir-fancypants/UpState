# UpState

A lightweight, dependency-free JavaScript state management library for the browser.

UpState gives you a simple, predictable way to manage application state — with optional persistence to `localStorage` or `sessionStorage`, an event-driven API built on native `EventTarget`, and safe result handling that never throws on missing data.

---

## Features

- 📦 Zero dependencies
- 🔒 Fully encapsulated state — enforced by private class fields
- 🧠 In-memory state tree with optional persistence
- 🔁 Event-driven — listen for any state change via the `update` event
- 🛡️ Safe `Result` wrapper — never throws on missing data
- 📂 Nested state support via dot or slash routes (`"user/profile/name"`)
- ⚡ Batch operations for efficient multi-value reads and writes

---

## Installation

Copy `UpState.js` into your project and import it:

```js
import UpState from './UpState.js';
```

---

## Important — Call `config()` First

`config()` should be the **very first call** you make, before any `set`, `get`, or `remove` operations. This ensures persistence rules and event settings are in place from the start.

Calling `config()` after state has already been written will not retroactively persist existing data.

```js
// ✅ Correct — config before anything else
import UpState from './UpState.js';

UpState.config({
  persistantCollections: [{ user: "permanent" }, { cart: "session" }]
});

UpState.set({ collection: "user", state: { name: "Alice" } }); // will persist
```

```js
// ⚠️ Avoid — set runs before config, persistence won't apply
UpState.set({ collection: "user", state: { name: "Alice" } });
UpState.config({ persistantCollections: [{ user: "permanent" }] });
```

---

## Quick Start

```js
import UpState from './UpState.js';

// 1. Configure first
UpState.config({
  persistantCollections: [{ user: "permanent" }, { cart: "session" }]
});

// 2. Set state
UpState.set({ collection: "user", state: { name: "Alice", age: 30 } });

// 3. Get state
const user = UpState.get("user").raw;
console.log(user.name); // "Alice"

// 4. Listen for changes
UpState.addEventListener("update", (e) => {
  console.log(e.detail.action);     // "set"
  console.log(e.detail.collection); // "user"
});

// 5. Remove state
UpState.remove("user");
```

---

## State Encapsulation

The internal state tree is stored in a **private class field** (`#state`). This means it is completely inaccessible from outside the class — the JavaScript engine enforces this at a language level, not just by convention.

```js
UpState.#state;        // SyntaxError — always, no workaround
UpState.state = {};    // Silently ignored — Object.freeze blocks this
```

All reads and writes must go through the provided methods (`set`, `get`, `remove`, and their batch equivalents). This guarantees that events always fire, persistence always runs, and the state tree is never accidentally corrupted.

---

## API

### `UpState.config(options)`

Configures UpState behaviour. **Should be called first, before any other method.**

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
| `persistence` | `"session"` \| `"permanent"` | ❌ | Persist to storage. Overridden by `config()` if the collection is listed there. |

```js
// Set an entire collection
UpState.set({ collection: "user", state: { name: "Alice" } });

// Set a nested value
UpState.set({ collection: "user", route: "profile/age", state: 30 });

// Set with persistence (only needed if not already in config)
UpState.set({ collection: "cart", state: [], persistence: "session" });
```

---

### `UpState.get(collection, route?)`

Retrieves a value from the state tree. Returns a [`Result`](#the-result-object) — never throws on missing data.

```js
const result = UpState.get("user");
const age    = UpState.get("user", "profile/age").raw;
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

All `get` calls return a `Result` object with three ways to consume the data:

| Getter | Returns | Null-safe? |
|---|---|---|
| `.raw` | The value as-is, or `null` | ✅ |
| `.list` | Always an array | ✅ |
| `.map` | Always a plain object | ✅ |

```js
const result = UpState.get("tags"); // e.g. stored as ["js", "css"]

result.raw;  // ["js", "css"]
result.list; // ["js", "css"]
result.map;  // { 0: "js", 1: "css" }

const empty = UpState.get("doesNotExist");
empty.raw;   // null
empty.list;  // []
empty.map;   // {}
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
  const { action, count, collections, stateInput, state } = e.detail;
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
| `MISSING_COLLECTION_REF` | `set`, `get`, `remove` | `collection` is missing or empty |
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

State is persisted under a single `"UpState"` key in storage to keep things tidy. On page load, UpState automatically restores any previously saved state from both `localStorage` and `sessionStorage`.

Persistence can be set per-call or globally via `config()`. Config-level persistence takes priority:

```js
// Globally via config (recommended — takes priority over per-call)
UpState.config({
  persistantCollections: [{ cart: "session" }]
});

// Per-call (only needed for collections not in config)
UpState.set({ collection: "cart", state: [], persistence: "session" });
```

---

## Browser Support

UpState uses private class fields (`#field`), which are supported in all modern browsers since 2021. It is not compatible with Internet Explorer.

---

## License

MIT

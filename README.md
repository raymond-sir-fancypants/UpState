# UpState

A lightweight, dependency-free JavaScript state management library for the browser.

UpState gives you a simple, predictable way to manage application state — with optional persistence to `localStorage` or `sessionStorage`, reactive subscriptions at any depth of your state tree, and safe result handling that never throws on missing data.

No dependencies. No build step. Just import and go.
```js
import UpState from './upstate.js';

UpState.set({ collection: 'user', state: { name: 'Alice' } });
UpState.get('user').raw; // { name: 'Alice' }
```

---

## Features

- 📦 Zero dependencies
- 🔒 Fully encapsulated state — enforced by private class fields
- 🧠 In-memory state tree with optional persistence
- 🔔 Granular subscriptions — subscribe to a whole collection or a specific nested route
- 🔑 Named unsubscribe keys — clean up listeners from anywhere without holding a reference
- 🔁 Event-driven — listen for any state change via the `update` event
- 🛡️ Safe `Result` wrapper — never throws on missing data, with `.asArray`, `.asObject`, `.mapArray` and `.mapObject` helpers
- 📂 Nested state support via dot or slash routes (`"user/profile/name"`)
- ⚡ Batch operations — `batchSet`, `batchGet`, `batchRemove` and `batchSubscriptions` for efficient multi-value operations
- 💾 Two-tier persistence — store state as `"session"` (sessionStorage) or `"permanent"` (localStorage), per collection or per write
- 📅 Auto date hydration — ISO 8601 strings are automatically revived as `Date` objects on load
- 🧬 Configurable cloning — choose `"deep"`, `"shallow"`, or `"off"` globally or individually for get, set, and subscribe operations

---

## Browser Support

| Browser | Version |
|---|---|
| Chrome | 98+ |
| Firefox | 94+ |
| Safari | 15.4+ |
| Edge | 98+ |

Requires: ES2022 private class fields, `structuredClone`, `EventTarget`, `localStorage`, `sessionStorage`.

> UpState includes a manual deep-clone fallback if `structuredClone` fails, so it degrades gracefully with a polyfill for older targets.


## Installation

Copy `upstate.js` into your project and import it as an ES module:

```js
import UpState from './upstate.js';
```

No npm, no bundler required.

---

## Quick Start

```js
import UpState from './upstate.js';

// Optional but recommended — configure before any operations
UpState.config({
  persistentCollections: { settings: 'permanent', auth: 'session' },
  cloning: 'deep'
});

// Write state
UpState.set({ collection: 'user', state: { name: 'Alice', age: 30 } });

// Read state
const user = UpState.get('user').raw;            // { name: 'Alice', age: 30 }
const name = UpState.get('user', 'name').raw;    // 'Alice'

// React to changes
const unsub = UpState.subscribe({
  collection: 'user',
  callback: (result) => console.log('user changed:', result.raw)
});

UpState.set({ collection: 'user', route: 'name', state: 'Bob' }); // triggers callback

unsub(); // stop listening
```

---

## Config

Call `config()` before any other operations to customise behaviour.

```js
UpState.config({
  persistentCollections: {
    settings: 'permanent', // survives tab close (localStorage)
    auth:     'session'    // survives refresh, cleared on tab close (sessionStorage)
  },
  cloning: 'deep',
  allowEventDispatches: true,
  silenceWarnings: false
});
```

### Cloning modes

Controls how state is cloned on `set`, `get`, and subscription callbacks.

| Mode | Behaviour | Use case |
|---|---|---|
| `"deep"` | Full `structuredClone` — no shared references (default) | Safety first |
| `"shallow"` | Top-level spread only — nested objects are shared | Large flat objects |
| `"off"` | No cloning — direct reference to internal state | Maximum performance |

Apply one mode to all operations, or configure per-operation:

```js
UpState.config({
  cloning: { onSet: 'deep', onGet: 'shallow', onSubscribe: 'off' }
});
```

### Benchmark (realistic app-scale state)

Tested on 1000 users + nested settings + 500 log entries, 100 cycles:

| Mode | Avg Set | Avg Get |
|---|---|---|
| `deep` | 14.50ms | 0.01ms |
| `shallow` | 0.003ms | 0.003ms |
| `off` | 0.002ms | 0.001ms |

`get` is fast across all modes — UpState only clones the retrieved value, not the whole state.

---

## API

### `UpState.set(setObject)`

Writes a value to a collection.

```js
// Set a whole collection
UpState.set({ collection: 'cart', state: { items: [], total: 0 } });

// Set a nested property using dot or slash notation
UpState.set({ collection: 'cart', route: 'items.0.qty', state: 2 });
UpState.set({ collection: 'cart', route: 'items/0/qty', state: 2 }); // equivalent

// Persist to storage
UpState.set({ collection: 'auth', state: { token: 'abc' }, persistence: 'session' });

// Falsy values are valid
UpState.set({ collection: 'flags', state: false });
UpState.set({ collection: 'count', state: 0 });
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `collection` | `string` | ✅ | Top-level namespace |
| `state` | `*` | ✅ | Any value except `undefined` |
| `route` | `string` | — | Dot/slash path to a nested property |
| `persistence` | `"session"` \| `"permanent"` | — | Persists to browser storage. Overrides collection-level config |

---

### `UpState.get(collection?, route?)`

Reads a value. Always returns a [`Result`](#result).

```js
UpState.get('cart').raw;            // { items: [], total: 0 }
UpState.get('cart', 'total').raw;   // 0
UpState.get('nonExistent').raw;     // null
UpState.get().raw;                  // entire state tree
```

---

### `UpState.remove(collection, route?)`

Removes a collection or a nested property from state and all storage.

```js
UpState.remove('cart', 'items.0'); // removes one item
UpState.remove('cart');            // removes the entire cart collection
```

---

### `UpState.subscribe(options)`

Subscribes to changes on a collection or route. Returns an unsubscribe function.

```js
// Watch an entire collection
const unsub = UpState.subscribe({
  collection: 'cart',
  callback: (result) => renderCart(result.raw)
});

// Watch a specific nested path
UpState.subscribe({
  collection: 'cart',
  route: 'total',
  callback: (result) => updateTotal(result.raw)
});

// Named key — unsubscribe without holding a reference
UpState.subscribe({
  collection: 'cart',
  callback: (result) => renderCart(result.raw),
  unsubscribeKey: 'cartWatcher'
});

unsub();                             // via returned function
UpState.unsubscribe('cartWatcher');  // or by named key
```

**Bidirectional propagation** — the callback fires when:
- The subscribed path changes directly
- A **parent** of the subscribed path is updated
- A **child** of the subscribed path changes

The callback always receives the value **at the subscribed route**, regardless of where the change originated.

```js
// Subscribed to 'user.name'
UpState.set({ collection: 'user', state: { name: 'Alice' } }); // fires — parent changed
UpState.set({ collection: 'user', route: 'name', state: 'Bob' }); // fires — direct
```

---

### `UpState.unsubscribe(keys)`

Unsubscribes named subscriptions registered with `unsubscribeKey`.

```js
UpState.unsubscribe('cartWatcher');
UpState.unsubscribe(['cartWatcher', 'userWatcher']); // batch
```

---

### Batch Operations

All batch operations fire subscriptions and dispatch a single `"update"` event when done.

```js
// batchSet — subscriptions fire once per unique changed route
UpState.batchSet([
  { collection: 'user', route: 'name',  state: 'Alice' },
  { collection: 'user', route: 'age',   state: 30 },
  { collection: 'settings', state: { theme: 'dark' } }
]);

// batchGet — returns a Result wrapping { collectionName: [value, ...] }
const result = UpState.batchGet([
  { collection: 'user', route: 'name' },
  { collection: 'user', route: 'age' }
]);
result.raw; // { user: ['Alice', 30] }

// batchRemove
UpState.batchRemove([
  { collection: 'user', route: 'token' },
  { collection: 'cache' }
]);

// batchSubscriptions — returns array of unsub functions
const unsubs = UpState.batchSubscriptions([
  { collection: 'user',     callback: (r) => console.log(r.raw) },
  { collection: 'settings', callback: (r) => console.log(r.raw) }
]);
unsubs.forEach(fn => fn());
```

---

### `"update"` Event

UpState extends `EventTarget`. Listen for all state changes globally:

```js
UpState.addEventListener('update', (event) => {
  const { action, collection, route, state } = event.detail;
  console.log(action, collection); // "set" "user"
});
```

`event.detail` fields by action:

| Action | Fields |
|---|---|
| `"set"` | `action, collection, route, state, destination` |
| `"remove"` | `action, collection, route, state, destination` |
| `"batchSet"` | `action, count, routeMap` |
| `"batchRemove"` | `action, count, collections` |

---

## Result

All `get` calls and subscription callbacks return a frozen `Result` object.

```js
const result = UpState.get('user');

result.raw;      // raw value, or null if missing
result.asArray;  // array, or [] if null
result.asObject; // plain object, or {} if null

result.mapArray((value, index) => value * 2);
result.mapObject((value, key) => value.toUpperCase());
```

| Accessor / Method | Null behaviour |
|---|---|
| `.raw` | Returns `null` |
| `.asArray` | Returns `[]` |
| `.asObject` | Returns `{}` |
| `.mapArray(fn)` | Maps over `[]`, returns `[]` |
| `.mapObject(fn)` | Maps over `{}`, returns `{}` |

---

## Error Handling

All errors are `UpStateError` instances with a `code` property for programmatic handling.

```js
try {
  UpState.set({ collection: '', state: 1 });
} catch (e) {
  if (e instanceof UpStateError) {
    console.log(e.message); // "'collection' value has to be a String"
    console.log(e.code);    // "MISSING_COLLECTION_REF"
  }
}
```

| Code | Thrown by | Cause |
|---|---|---|
| `MISSING_COLLECTION_REF` | `set`, `get`, `remove`, `subscribe` | `collection` is empty or missing |
| `INVALID_COLLECTION_REF` | `set`, `get`, `remove`, `subscribe` | `collection` is not a string |
| `INVALID_STATE_VALUE` | `set` | `state` is `undefined` |
| `INVALID_PERSISTENCE_VALUE` | `set` | `persistence` is not `"session"` or `"permanent"` |
| `MISSING_SUB_CALLBACK_REF` | `subscribe` | `callback` is missing |
| `INVALID_SUB_CALLBACK` | `subscribe` | `callback` is not a function |
| `INVALID_UNSUB_KEY` | `subscribe`, `unsubscribe` | key not a string or not found |
| `MISSING_CONFIG_ERR` | `config` | Invalid `cloning` value or `persistentCollections` type |
| `INVALID_BATCH_*` | batch methods | Argument is not an array |

---

## Persistence

State is persisted under a single `"UpState"` key in `localStorage` or `sessionStorage`.

On page load, UpState automatically merges persisted state — `localStorage` takes priority over `sessionStorage` on key conflicts.

ISO 8601 date strings are automatically revived as `Date` objects when reading from storage.

```js
UpState.config({
  persistentCollections: {
    user:     'session',   // cleared when tab closes
    settings: 'permanent'  // survives tab close
  }
});

// Call-level persistence overrides collection-level config
UpState.set({
  collection: 'auth',
  route:      'token',
  state:      'abc123',
  persistence: 'session'
});
```

---

## Route Syntax

Use `.` or `/` as path separators — they are interchangeable.

```js
UpState.set({ collection: 'app', route: 'user.profile.name', state: 'Alice' });
UpState.set({ collection: 'app', route: 'user/profile/name', state: 'Alice' }); // same

UpState.get('app', 'user.profile.name').raw; // 'Alice'
```

Missing segments are created automatically on write and return `null` safely on read.

---

## Third-party Object Warning

Objects from SDKs like Firebase contain methods and internal references that cannot be cloned. Store plain data only:

```js
// ❌ Raw Firebase User — will lose internal properties
UpState.set({ collection: 'auth', state: firebaseUser });

// ✅ Extract plain data first
UpState.set({
  collection: 'auth',
  persistence: 'session',
  state: {
    uid:           firebaseUser.uid,
    email:         firebaseUser.email,
    displayName:   firebaseUser.displayName,
    emailVerified: firebaseUser.emailVerified
  }
});
```

---

## License

MIT

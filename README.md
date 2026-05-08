# UpState

**Version 4.2.0** — A lightweight, dependency-free reactive state management library for the browser.

UpState gives you a simple, predictable way to manage application state — with optional persistence to `localStorage` or `sessionStorage`, reactive subscriptions at any depth of your state tree, a decoupled request/response bus, a fire-and-forget emit bus, and safe result handling that never throws on missing data.

No dependencies. No build step. Just import and go.

```js
import UpState from './upstate.js';

UpState.set({ collection: 'user', state: { name: 'Alice' } });
UpState.get('user').raw; // { name: 'Alice' }
```

---

## Table of Contents

- [Features](#features)
- [Browser Support](#browser-support)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Architecture Overview](#architecture-overview)
- [Config](#config)
- [API Reference](#api-reference)
  - [set](#upstatesetsetobject)
  - [get](#upstategetcollection-route)
  - [remove](#upstateremovecollection-route)
  - [subscribe](#upstatesubscribeoptions)
  - [unsubscribe](#upstateunsubscribekeys)
  - [batchSet](#upstatebatchsetarrayofsetobjects)
  - [batchGet](#upstatebatchgetarrayofgetrequests)
  - [batchRemove](#upstatebatchremovearrayofremoverequests)
  - [batchSubscriptions](#upstatebatchsubscriptionsarrayofsubscriptionobjects)
  - [batchUnsubscribe](#upstatebatchunsubscribekeys)
- [Result](#result)
- [Persistence](#persistence)
- [Subscriptions In Depth](#subscriptions-in-depth)
- [Emit Bus](#emit-bus)
- [Request / Response Bus](#request--response-bus)
- [The `update` Event](#the-update-event)
- [EventTarget Aliases](#eventtarget-aliases)
- [Creating Isolated Instances](#creating-isolated-instances)
- [Error Handling](#error-handling)
- [Route Syntax](#route-syntax)
- [Cloning Modes](#cloning-modes)
- [Third-party Object Warning](#third-party-object-warning)
- [Known Limitations](#known-limitations)
- [License](#license)

---

## Features

- 📦 Zero dependencies
- 🔒 Fully encapsulated state — enforced by private class fields
- 🧠 In-memory state tree with optional persistence
- 🔔 Granular subscriptions — subscribe to a whole collection or a specific nested route
- 🔑 Named subscription keys — clean up listeners from anywhere without holding a reference
- 🔁 Event-driven — listen for any state change via the `update` event
- 🛡️ Safe `Result` wrapper — never throws on missing data, with `.asArray`, `.asObject`, `.mapArray` and `.mapObject` helpers
- 📂 Nested state support via dot or slash routes (`"user/profile/name"`)
- ⚡ Batch operations — `batchSet`, `batchGet`, `batchRemove`, `batchSubscriptions`, and `batchUnsubscribe` for efficient multi-value operations
- 💾 Two-tier persistence — store state as `"session"` (sessionStorage) or `"permanent"` (localStorage), per collection or per write
- 📅 Auto date hydration — ISO 8601 strings are automatically revived as `Date` objects on load
- 🧬 Configurable cloning — choose `"deep"`, `"shallow"`, or `"off"` globally or individually for `set`, `get`, and `subscribe` operations
- 📡 Emit bus — fire-and-forget state broadcasts with optional transform and callback
- 🔄 Request/response bus — decoupled cross-module communication with TTL, abort, and auto-write-to-state

---

## Browser Support

| Browser | Version |
|---|---|
| Chrome | 98+ |
| Firefox | 94+ |
| Safari | 15.4+ |
| Edge | 98+ |

Requires: ES2022 private class fields, `structuredClone`, `EventTarget`, `localStorage`, `sessionStorage`, `crypto.randomUUID`.

> UpState includes a manual deep-clone fallback if `structuredClone` fails, so it degrades gracefully with a polyfill for older targets.

---

## Installation

Copy `upstate.js` into your project and import it as an ES module:

```js
import UpState from './upstate.js';
```

You can also import the `State` class directly for isolated instances (see [Creating Isolated Instances](#creating-isolated-instances)):

```js
import UpState, { State } from './upstate.js';
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
const user = UpState.get('user').raw;           // { name: 'Alice', age: 30 }
const name = UpState.get('user', 'name').raw;   // 'Alice'

// React to changes
const unsub = UpState.subscribe({
  collection: 'user',
  key: 'userWatcher',
  callback: (value) => console.log('user changed:', value)
});

UpState.set({ collection: 'user', route: 'name', state: 'Bob' }); // triggers callback

unsub(); // stop listening
```

> **Note:** Subscription callbacks receive the raw cloned value at the subscribed route — not a `Result` wrapper. Use `UpState.get()` if you need a `Result`.

---

## Architecture Overview

UpState has two separate event surfaces:

**1. Public `EventTarget` (`UpState` itself)**
Used for the `"update"` CustomEvent, which fires after every `set`, `remove`, `batchSet`, and `batchRemove` operation. You attach listeners here with `addEventListener` (or the `.on` alias).

**2. Internal `#bus` (`EventTarget`)**
A private, encapsulated event target used exclusively by the [Emit Bus](#emit-bus) and [Request/Response Bus](#request--response-bus). This keeps those channels isolated from the public `"update"` event and from any user-defined event names.

You never interact with `#bus` directly — it is accessed only through `emitState`/`onEmit` and `request`/`onRequest`/`response`/`onResponse`.

---

## Config

Call `config()` before any other operations to customise behaviour. Settings apply to the entire instance.

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

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `persistentCollections` | `Object` | `{}` | Map of `collectionName → "session" \| "permanent"`. Only collections that **already exist in state** at the time `config()` is called are registered. For collections written after `config()`, pass `persistence` directly to `set()`. |
| `cloning` | `"deep" \| "shallow" \| "off" \| Object` | `"deep"` | Controls value cloning. See [Cloning Modes](#cloning-modes). |
| `allowEventDispatches` | `boolean` | `true` | When `false`, the `"update"` CustomEvent is never dispatched. Useful in environments without a DOM or in tests. |
| `silenceWarnings` | `boolean` | `false` | When `true`, suppresses non-critical internal console warnings. |

### Cloning Modes

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

#### Benchmark (realistic app-scale state)

Tested on 1000 users + nested settings + 500 log entries, 100 cycles:

| Mode | Avg Set | Avg Get |
|---|---|---|
| `deep` | 14.50ms | 0.01ms |
| `shallow` | 0.003ms | 0.003ms |
| `off` | 0.002ms | 0.001ms |

`get` is fast across all modes — UpState only clones the retrieved value, not the whole state.

---

## API Reference

### `UpState.set(setObject)`

Writes a value to a collection. If `route` is omitted the entire collection is replaced. If `route` is provided, only the nested key at that path is updated; missing intermediate path segments are created automatically.

After writing, matching subscriptions are fired and an `"update"` event is dispatched.

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
| `persistence` | `"session" \| "permanent"` | — | Persists to browser storage. Overrides collection-level config. |

---

### `UpState.get(collection?, route?)`

Reads a value. Always returns a [`Result`](#result). The value is cloned according to the `onGet` cloning option before being wrapped.

Supports multiple call signatures:

```js
UpState.get('cart').raw;               // entire collection
UpState.get('cart', 'total').raw;      // nested path (positional)
UpState.get({ collection: 'cart', route: 'total' }).raw; // object form
UpState.get().raw;                     // entire state tree
UpState.get('nonExistent').raw;        // null — never throws
```

If the collection or path does not exist, `Result.raw` is `null`.

---

### `UpState.remove(collection, route?)`

Removes a collection or a nested property from state and from both `localStorage` and `sessionStorage`.

Supports both positional and object-form arguments.

```js
UpState.remove('cart', 'items.0');              // removes one item
UpState.remove('cart');                         // removes entire collection
UpState.remove({ collection: 'cart', route: 'items.0' }); // object form
```

Fires matching subscriptions and dispatches an `"update"` event after removal.

---

### `UpState.subscribe(options)`

Subscribes to changes on a collection or route. Returns an unsubscribe function.

```js
// Watch an entire collection
const unsub = UpState.subscribe({
  collection: 'cart',
  key: 'cartWatcher',
  callback: (value) => renderCart(value)
});

// Watch a specific nested path
UpState.subscribe({
  collection: 'cart',
  route: 'total',
  key: 'cartTotalWatcher',
  callback: (value) => updateTotal(value)
});

unsub();                             // via returned function
UpState.unsubscribe('cartWatcher'); // or by key
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `collection` | `string` | ✅ | Collection to watch |
| `key` | `string` | ✅ | Unique identifier for this subscription. Must not already be in use. Used to unsubscribe later. |
| `callback` | `Function` | ✅ | `(value) => void`. Receives the raw cloned value at the subscribed route. **Not** a `Result` wrapper. |
| `route` | `string` | — | Dot/slash path within the collection. Omit to subscribe to the whole collection. |
| `propagation` | `string` | — | Controls which changes trigger the callback. See below. Defaults to `"exact"`. |

#### Callback Value

The callback receives the **raw cloned value** at the subscribed route — not a `Result`. The value is cloned according to the `onSubscribe` cloning option.

```js
UpState.subscribe({
  collection: 'user',
  route: 'name',
  key: 'nameWatcher',
  callback: (value) => {
    console.log(value); // 'Alice' — raw string, not a Result
  }
});
```

If you need a `Result`, call `UpState.get()` inside the callback.

#### Propagation Modes

The `propagation` option controls which state changes trigger the callback:

| Value | Fires when… |
|---|---|
| `"exact"` (default) | Only the exact subscribed path changes directly |
| `"ancestors"` | The subscribed path **or any ancestor** of it changes |
| `"descendants"` | The subscribed path **or any descendant** of it changes |
| `"related"` | Any ancestor **or** descendant change (both directions) |

```js
// Only fires when 'user.name' is set directly
UpState.subscribe({
  collection: 'user',
  route: 'name',
  key: 'exactName',
  propagation: 'exact',
  callback: (value) => console.log(value)
});

// Fires when 'user.name' changes OR when the entire 'user' collection is replaced
UpState.subscribe({
  collection: 'user',
  route: 'name',
  key: 'ancestorName',
  propagation: 'ancestors',
  callback: (value) => console.log(value)
});
```

**Collection-level subscribers** (no `route`) with `propagation: "exact"` only fire when the entire collection is replaced, not when a nested key changes. Use `"descendants"` or `"related"` to also fire on nested changes.

#### Subscription best practices

Subscribe as deep as possible — at the exact value you care about — to avoid unnecessary callback invocations:

```js
// ❌ Too broad — fires for any change under 'profile'
UpState.subscribe({
  collection: 'users',
  route: 'profile',
  key: 'profileWatcher',
  callback: (value) => { ... }
});

// ✅ Targeted — each callback only fires when its value changes
UpState.subscribe({ collection: 'users', route: 'profile/avatar', key: 'avatarWatcher', callback: updateAvatar });
UpState.subscribe({ collection: 'users', route: 'profile/name',   key: 'nameWatcher',   callback: updateName  });
```

Broad subscriptions tend to grow into defensive callbacks that manually check what actually changed — which is a sign the subscription is too high in the tree.

---

### `UpState.unsubscribe(keys)`

Removes one or more subscriptions by their `key`.

```js
UpState.unsubscribe('cartWatcher');
UpState.unsubscribe(['cartWatcher', 'userWatcher']); // batch
```

Throws if a key is not a string or is not found in the registry.

---

### `UpState.batchSet(arrayOfSetObjects)`

Writes multiple state values efficiently. Individual subscription callbacks and `"update"` events are suppressed during the writes, then subscriptions fire once per unique changed route, and a single `"update"` event is dispatched.

```js
UpState.batchSet([
  { collection: 'user', route: 'name',  state: 'Alice' },
  { collection: 'user', route: 'age',   state: 30 },
  { collection: 'settings', state: { theme: 'dark' } }
]);
```

---

### `UpState.batchGet(arrayOfGetRequests)`

Reads multiple values in one call. Returns a single `Result` whose `.raw` value is an object keyed by collection name, where each value is an array of the requested values in the order they were specified.

```js
const result = UpState.batchGet([
  { collection: 'user' },
  { collection: 'user', route: 'address.city' },
  { collection: 'cart' }
]);
result.raw; // { user: [{ name: 'Alice', age: 30 }, 'London'], cart: [{ items: [] }] }
```

---

### `UpState.batchRemove(arrayOfRemoveRequests)`

Removes multiple values efficiently. Works analogously to `batchSet` — subscriptions are suppressed during deletion then fired once per affected collection, and a single `"update"` event is dispatched.

```js
UpState.batchRemove([
  { collection: 'cart' },
  { collection: 'user', route: 'session.token' }
]);
```

---

### `UpState.batchSubscriptions(arrayOfSubscriptionObjects)`

Registers multiple subscriptions in a single call. Each item in the array matches the signature of `subscribe()`. Returns a **keyed object** (not an array) mapping each subscription's `key` to its `unsub` function.

```js
const unsubs = UpState.batchSubscriptions([
  { collection: 'user',    key: 'userSub',    callback: onUser    },
  { collection: 'cart',    key: 'cartSub',    callback: onCart    },
  { collection: 'session', key: 'sessionSub', callback: onSession },
]);

// Unsubscribe individually
unsubs.cartSub();

// Or unsubscribe all
Object.values(unsubs).forEach(fn => fn());
```

---

### `UpState.batchUnsubscribe(keys)`

Removes multiple subscriptions in one call. Requires an array — throws a specific error if the argument is not an array.

```js
UpState.batchUnsubscribe(['userSub', 'cartSub', 'sessionSub']);
```

---

## Result

All `get` and `batchGet` calls return a **frozen** `Result` object. It normalises the underlying data so consumers never have to guard against `null` or `undefined`.

```js
const result = UpState.get('user');

result.raw;      // raw value, or null if missing
result.asArray;  // always an array
result.asObject; // always a plain object

result.mapArray((value, index) => value * 2);
result.mapObject((value, key) => value.toUpperCase());
```

### Coercion rules

| Accessor | If null | If array | If object | If primitive |
|---|---|---|---|---|
| `.raw` | `null` | array | object | primitive |
| `.asArray` | `[]` | returned as-is | `Object.values(data)` | `[data]` |
| `.asObject` | `{}` | index-keyed: `{ 0: item0, ... }` | returned as-is | `{ 0: data }` |

### Methods

| Method | Null behaviour |
|---|---|
| `.mapArray(fn)` | Maps over `[]`, returns `[]` |
| `.mapObject(fn)` | Maps over `{}`, returns `{}` |

`mapArray` receives `(value, index)`. `mapObject` receives `(value, key)`. Undefined/null return values from the callback are coerced to `null`.

```js
UpState.get('users').mapArray(user => user.name);
// → ['Alice', 'Bob', 'Charlie']

UpState.get('users').mapObject((user, id) => `${id}:${user.name}`);
// → { alice: 'alice:Alice', bob: 'bob:Bob' }
```

---

## Persistence

State is persisted under a single `"UpState"` key in `localStorage` or `sessionStorage`.

On page load, UpState automatically merges persisted state. The merge order is: **session storage data wins over permanent data** on key conflicts. This means values persisted to `sessionStorage` take precedence over values persisted to `localStorage` when the same key exists in both.

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

> **Important:** `persistentCollections` in `config()` only registers collections that **already exist in state** at the time `config()` is called. If you set a collection after calling `config()`, pass `persistence` directly to `set()`.

### Persistence limitations

UpState uses `JSON.stringify` for persistence. Only JSON-safe data can be stored. The following types work at runtime but are **not restored correctly after a page reload**:

- `Map` and `Set` — converted to JSON-compatible structures
- `Function`, `Symbol`, `BigInt` — stripped entirely
- Class instances — lose prototype chains
- DOM nodes (`window`, `HTMLElement`, `File`, etc.) — cannot be cloned or serialised
- Circular references — not supported in persistence (JSON limitation)

---

## Subscriptions In Depth

### How propagation works

UpState compares the path that changed against the path each subscription is watching. Two paths are "related" if they share a common prefix (the shorter of the two). Given that shared prefix:

- `"ancestors"` fires when the subscription's path is **shorter or equal** to the changed path (the subscription watches a node above or at the change).
- `"descendants"` fires when the changed path is **shorter or equal** to the subscription's path (the subscription watches a node at or below the change).
- `"related"` fires for any shared prefix (either direction).
- `"exact"` fires only when both paths are identical.

The callback always receives the value **at the subscribed route**, not the value at the route that changed.

```js
// Subscribed to 'user' (whole collection) with propagation: 'descendants'
UpState.set({ collection: 'user', state: { name: 'Alice' } }); // fires — collection set
UpState.set({ collection: 'user', route: 'name', state: 'Bob' }); // fires — descendant changed

// Subscribed to 'user.name' with propagation: 'ancestors'
UpState.set({ collection: 'user', state: { name: 'Alice' } }); // fires — ancestor replaced
UpState.set({ collection: 'user', route: 'name', state: 'Bob' }); // fires — exact match also triggers ancestors
```

### Route-split cache

UpState maintains an LRU cache per collection of up to 1000 pre-split route strings. This avoids redundant `String.split` work on hot subscription paths in high-frequency update scenarios.

---

## Emit Bus

The emit bus is a fire-and-forget state broadcast system. Use it to push state snapshots or arbitrary payloads to listeners registered elsewhere in your application, without those listeners needing a direct reference to the sender.

The emit bus uses an internal private `EventTarget` (`#bus`), separate from the public `"update"` event channel.

### `UpState.emitState(options)`

Broadcasts a payload (and optionally a state snapshot) to all `onEmit` listeners registered under `name`.

```js
// Broadcast current user state to all 'userChanged' listeners
UpState.emitState({
  name: 'userChanged',
  collection: 'user',
  transform: (result) => result.raw
});

// Broadcast an arbitrary payload with no state snapshot
UpState.emitState({
  name: 'appReady',
  payload: { timestamp: Date.now() }
});

// Include a callback listeners can call to reply back
UpState.emitState({
  name: 'requestData',
  payload: { page: 1 },
  callback: (replyData) => console.log('Listener replied:', replyData)
});
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Event name to broadcast on |
| `payload` | `*` | — | Arbitrary data passed to the listener |
| `collection` | `string` | — | Collection to snapshot and include in the broadcast |
| `route` | `string` | — | Route within the collection to snapshot |
| `transform` | `Function` | — | `(Result) => *` applied to the state snapshot before dispatching. Useful for reshaping without mutating state. |
| `callback` | `Function` | — | A function listeners can invoke to send data back to the emitter |
| `id` | `string \| number` | — | Optional identifier (available to listeners but not used internally) |

### `UpState.onEmit(options)`

Registers a listener for `emitState` broadcasts on `name`. Only **one** listener per `name` is allowed at a time — call `killOnEmit` before re-registering.

The callback receives `{ payload, data, callback }`:
- `payload` — the arbitrary data from `emitState`
- `data` — the (optionally transformed) state snapshot, or a `Result` if no transform was applied
- `callback` — the reply function from `emitState`, if one was provided

```js
UpState.onEmit({
  name: 'userChanged',
  callback: ({ payload, data, callback }) => {
    renderUserBadge(data);
    if (callback) callback({ acknowledged: true });
  }
});
```

### `UpState.killOnEmit(name)`

Removes the `onEmit` listener registered under `name`.

```js
UpState.killOnEmit('userChanged');
```

---

## Request / Response Bus

The request/response bus enables **decoupled cross-module communication**. A module can make a typed request without knowing which module will fulfil it. The fulfilling module handles the request and calls `response()` when ready. This is useful for lazy data loading, service-style modules, and keeping modules from directly importing each other.

Like the emit bus, this uses the internal `#bus` (not the public `"update"` event channel).

### Flow

```
Module A                                Module B
─────────────────────────────────────────────────────────
1. request({ name: 'fetchUser', ... })
                                 ─────→ onRequest fires
                                        callback(uid, payload)
                                        ... fetch data ...
                                        response(uid, data)
   onResponse fires ←─────
   callback({ error, payload })
```

### `UpState.request(options)`

Sends a typed request on the internal bus. Returns a unique UID string that identifies this request.

```js
const uid = UpState.request({
  name: 'fetchUser',
  payload: { userId: 42 },
  destination: { collection: 'user' }, // auto-write response to state
  ttl: 30,                              // timeout in seconds (default: 120)
  callback: ({ error, payload }) => {
    if (!error) console.log('User loaded:', payload);
  }
});
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Request type / channel name |
| `payload` | `*` | — | Data to send to the handler |
| `destination` | `Object` | — | `{ collection, route? }`. If provided, the resolved response is automatically written to state via `set()` after the response arrives. |
| `callback` | `Function` | — | `({ error, payload }) => void`. Called with the resolved response when it arrives. |
| `transform` | `Function` | — | `(data) => *` applied to the response before passing to `callback` and writing to `destination`. |
| `ttl` | `number` | — | Time-to-live in seconds. Defaults to `120`. On expiry, `onResponse` is called with `{ error: true, payload: null }`. |
| `id` | `string \| number` | — | Custom UID. If omitted, `crypto.randomUUID()` is used. |

### `UpState.onRequest(options)`

Registers a handler for a specific request type. Only **one** handler per `name` is allowed at a time.

The callback receives `(uid, payload)`:
- `uid` — the unique request ID; **pass this to `response(uid, data)`**
- `payload` — the data sent by the requester

```js
UpState.onRequest({
  name: 'fetchUser',
  callback: async (uid, payload) => {
    const user = await api.getUser(payload.userId);
    UpState.response(uid, user);
  }
});
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Request type to handle |
| `callback` | `Function` | ✅ | `(uid, payload) => void` |
| `id` | `string \| number` | — | Override the UID used for routing (advanced use) |

### `UpState.response(id, data)` or `UpState.response({ id, data })`

Resolves a pending request with data. Must be called by the `onRequest` handler once it has a result.

Supports both positional `(id, data)` and object-form `({ id, data })` calls.

```js
// Positional form
UpState.response(uid, { name: 'Alice', age: 30 });

// Object form
UpState.response({ id: uid, data: { name: 'Alice', age: 30 } });
```

After calling `response()`:
1. Any `transform` registered by the requester is applied to `data`.
2. The requester's `callback` (if any) is called with the resolved value.
3. The value is written to `destination` in state (if any was specified).
4. The TTL timeout for this request is cleared.
5. The `onResponse` listener is invoked.

Throws if `id` is not found in the pending request cache (already resolved, timed out, or unknown).

### `UpState.onResponse(options)`

Listens for the response to a specific request by UID. By default, the listener removes itself after one invocation (`once: true`).

```js
const uid = UpState.request({ name: 'loadData', payload: { page: 1 } });

UpState.onResponse({
  id: uid,
  callback: ({ error, payload }) => {
    if (error) return console.error('Request timed out');
    renderData(payload);
  }
});
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | `string \| number` | ✅ | The UID returned by `request()` |
| `callback` | `Function` | ✅ | `({ error, payload }) => void`. `error` is `true` on TTL timeout. |
| `once` | `boolean` | — | Auto-remove after first invocation. Defaults to `true`. |
| `abortController` | `AbortController` | — | External abort signal for manual cleanup. |

### `UpState.killOnRequest(name)`

Removes the `onRequest` handler registered under `name`.

```js
UpState.killOnRequest('fetchUser');
```

### `UpState.killOnResponse(id)`

Removes the `onResponse` listener registered for request `id`.

```js
UpState.killOnResponse(uid);
```

---

## The `update` Event

UpState extends `EventTarget`. Listen for all state changes globally on the instance:

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

> The `"update"` event can be disabled globally with `config({ allowEventDispatches: false })`.

---

## EventTarget Aliases

For convenience, three shorthand aliases are attached to the UpState instance during construction:

```js
UpState.on('update', handler);   // alias for addEventListener
UpState.off('update', handler);  // alias for removeEventListener
UpState.emit(new CustomEvent('update', { ... })); // alias for dispatchEvent
```

These are direct bindings to the native `EventTarget` methods — no extra behaviour.

---

## Route Syntax

Use `.` or `/` as path separators — they are interchangeable.

```js
UpState.set({ collection: 'app', route: 'user.profile.name', state: 'Alice' });
UpState.set({ collection: 'app', route: 'user/profile/name', state: 'Alice' }); // same

UpState.get('app', 'user.profile.name').raw; // 'Alice'
```

Missing segments are created automatically on write and return `null` safely on read.

> **Limitation:** There is no escape mechanism for `.` or `/` characters within a single key name. Avoid key names that contain these characters, as they will be treated as path separators and may collide with other routes.

---

## Creating Isolated Instances

The default `UpState` export is a shared singleton. For isolated state (e.g. unit tests, micro-frontend boundaries, or multiple independent state trees), import and instantiate the `State` class directly:

```js
import { State } from './upstate.js';

const myState = new State();
myState.set({ collection: 'user', state: { name: 'Alice' } });
console.log(myState.get('user').raw); // { name: 'Alice' }

const anotherState = new State();
anotherState.get('user').raw; // null — completely independent
```

`State` instances share the same `StorageHandler` (since `sessionStorage` and `localStorage` are global), but maintain independent in-memory state trees and subscription registries.

The singleton export is frozen (`Object.freeze`) so its shape cannot be accidentally mutated.

---

## Error Handling

All errors thrown by UpState are `UpStateError` instances with a `code` property for programmatic handling.

```js
try {
  UpState.set({ collection: '', state: 1 });
} catch (e) {
  if (e instanceof UpStateError) {
    console.log(e.message); // "'collection' value has to be be a String"
    console.log(e.code);    // "MISSING_ARG"
  }
}
```

### Error codes

| Code | Thrown by | Cause |
|---|---|---|
| `MISSING_ARG` | most methods | A required argument is missing, or an argument has a wrong type that makes it unusable (e.g. invalid cloning option string) |
| `INVALID_ARG` | most methods | An argument was provided but has an invalid type or value (e.g. duplicate subscription key, unknown persistence value, non-array passed to batch method) |
| `INVALID_BATCH_UNSUB_ARGUMENT` | `batchUnsubscribe` | Argument is not an array |
| `GENERAL_ERROR` | — | Default/uncategorised error |

> **Note:** `UpStateError` extends native `Error`, so standard `try/catch` and `instanceof` checks work as expected. `Error.captureStackTrace` is called when available.

---

## Third-party Object Warning

Objects from SDKs like Firebase contain methods and internal references that cannot be cloned. Store plain data only:

```js
// ❌ Raw Firebase User — will lose internal properties on clone
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

## Known Limitations

### Storage

- All state is stored under a single `"UpState"` key per storage type (session and permanent). There is no per-collection separation in storage.
- **Cross-tab writes:** Multiple tabs writing at the same time will overwrite the full state blob. There is no merge strategy — last write wins.
- **Corrupted JSON:** If the stored JSON is invalid on load, UpState silently falls back to an empty state `{}`. No warning or recovery system is triggered.

### Persistence data types

Only JSON-safe types survive a page reload. See [Persistence Limitations](#persistence-limitations).

### Circular references

Supported in runtime state via fallback cloning, but not supported in persistence (JSON limitation). Cannot be restored after reload.

### Date handling

UpState hydrates ISO 8601 strings into `Date` objects on load. Any string that happens to match the ISO 8601 format (e.g. an ID or serial number like `"2024-01-15T10:30:00.000Z"`) will be silently converted to a `Date` object.

### Subscriptions

- Large numbers of subscriptions may impact performance. Callback execution time scales with subscription count.
- No middleware, priority ordering, or interception system.

### Request / Response bus

- Includes TTL expiration and manual cancellation via `AbortController`.
- Does **not** include automatic retry. Implement retry logic in the `onRequest` handler if needed.

### Event system

- Built on native `EventTarget`.
- No cross-tab event syncing — each tab maintains independent runtime state (only persisted storage is shared).

### Object cloning

- DOM nodes and browser objects may not clone correctly.
- Functions are removed during deep clone.
- Class instances lose their prototype chains after cloning.
- Strict equality (`===`) is not preserved after retrieval.

### Route system

- No escape system for `.` or `/` in key names.
- Poorly structured routes may collide.

---

## License

MIT
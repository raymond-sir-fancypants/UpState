# UpState

**Version 5.0.0** — A lightweight, dependency-free reactive state management library for the browser.

UpState gives you a simple, predictable way to manage application state — with optional persistence to `localStorage` or `sessionStorage`, reactive subscriptions at any depth of your state tree, a rich debug and introspection API, and safe result handling that never throws on missing data, all with zero dependencies.

No dependencies. No build step. Just import and go.

```js
import UpState from './upstate.js';

UpState.set({ collection: 'user', state: { name: 'Alice' } });
UpState.get('user').raw; // { name: 'Alice' }
```

---

## Table of Contents

- [Features](#features)
- [What's New in v5.0.0](#whats-new-in-v500)
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
  - [unsubscribe](#upstateunsubscribekey)
  - [batchSet](#upstatebatchsetarrayofsetobjects)
  - [batchGet](#upstatebatchgetarrayofgetrequests)
  - [batchRemove](#upstatebatchremovearrayofremoverequests)
  - [batchSubscribe](#upstatebatchsubscribearrayofsubscriptionobjects)
  - [batchUnsubscribe](#upstatebatchunsubscribekeys)
  - [purge](#upstatepurgeoptions)
- [The Debug API](#the-debug-api)
- [Result](#result)
- [Persistence](#persistence)
- [Subscriptions In Depth](#subscriptions-in-depth)
- [The `update` Event](#the-update-event)
- [EventTarget Aliases](#eventtarget-aliases)
- [Creating Isolated Instances](#creating-isolated-instances)
- [Error Handling](#error-handling)
- [Route Syntax](#route-syntax)
- [Cloning Modes](#cloning-modes)
- [structuredClone Warning](#structuredclone-warning)
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
- ⚡ Batch operations — `batchSet`, `batchGet`, `batchRemove`, `batchSubscribe`, and `batchUnsubscribe` for efficient multi-value operations
- 💾 Two-tier persistence — store state as `"session"` (sessionStorage) or `"permanent"` (localStorage), per collection or per write
- ⏳ Expiring persistence — set TTL on any persisted value using shorthands like `"30d"`, `"12h"`, `"30m"`
- 📅 Auto date hydration — ISO 8601 strings are automatically revived as `Date` objects on load
- 🧬 Configurable cloning — choose `"deep"`, `"shallow"`, or `"off"` globally or per-operation for `set`, `get`, and `subscribe`
- 🔍 Built-in debug API — inspect state, routes, subscriptions, metrics, persistence, and live trace changes

---

## What's New in v5.0.0

### ✅ Added — Debug API

A frozen `debug` object is now available on the UpState instance (and all `State` instances) with a suite of introspection methods. See [The Debug API](#the-debug-api) for full reference.

### ✅ Added — `purge()`

A new `purge()` method wipes all in-memory state, subscriptions, caches, and (optionally) storage in one operation. Useful for logout flows or full application resets. See [purge](#upstatepurgeoptions).

### ✅ Added — `unsubscribeOnDelete` config option

When `true` (the default), removing a collection via `remove()` automatically unsubscribes all of its active listeners. Set to `false` to opt out if you manage those subscriptions yourself.

### ✅ Added — Expiring persistence

The `expiry` field on persistence objects now supports time shorthands: `"30d"`, `"12h"`, `"30m"`, `"60s"`, `"500ms"`, or a raw number in milliseconds. Expired entries are silently stripped on load.

```js
UpState.set({
  collection: 'auth',
  state: { token: 'abc123' },
  persistence: { type: 'permanent', expiry: '7d' }
});
```

### ❌ Removed — Bus system

The emit bus (`emitState`, `onEmit`) and the request/response bus (`request`, `onRequest`, `response`, `onResponse`, `killOnRequest`, `killOnResponse`) have been removed.

---

## Browser Support

| Browser | Version |
|---|---|
| Chrome | 98+ |
| Firefox | 94+ |
| Safari | 15.4+ |
| Edge | 98+ |

Requires: ES2022 private class fields, `structuredClone`, `EventTarget`, `localStorage`, `sessionStorage`, `crypto.randomUUID`.

> UpState includes a manual deep-clone fallback if `structuredClone` fails, but see the [structuredClone Warning](#structuredclone-warning) for the performance implications.

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

UpState is a single `EventTarget` instance (the public `UpState` export, which is a frozen `State` singleton). Its event surface is:

**Public `EventTarget` (`UpState` itself)**
Used for the `"update"` CustomEvent, which fires after every `set`, `remove`, `batchSet`, and `batchRemove` operation. You attach listeners here with `addEventListener` (or the `.on` alias).

There is no secondary internal bus in v5. Cross-module communication patterns previously handled by the bus system are best achieved via subscriptions or the `"update"` event.

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
  silenceWarnings: false,
  unsubscribeOnDelete: true
});
```

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `persistentCollections` | `Object` | `{}` | Map of `collectionName → "session" \| "permanent" \| { type, expiry }`. Only collections that **already exist in state** at the time `config()` is called are registered. For collections written after `config()`, pass `persistence` directly to `set()`. |
| `cloning` | `"deep" \| "shallow" \| "off" \| Object` | `"deep"` | Controls value cloning. See [Cloning Modes](#cloning-modes). |
| `allowEventDispatches` | `boolean` | `true` | When `false`, the `"update"` CustomEvent is never dispatched. Useful in environments without a DOM or in tests. |
| `silenceWarnings` | `boolean` | `false` | When `true`, suppresses non-critical internal console warnings. |
| `unsubscribeOnDelete` | `boolean` | `true` | When `true`, removing a collection automatically unsubscribes all its active listeners. |

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

// Persist with expiry
UpState.set({
  collection: 'auth',
  state: { token: 'abc' },
  persistence: { type: 'permanent', expiry: '7d' }
});
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `collection` | `string` | ✅ | The top-level state bucket to write to. |
| `state` | `*` | ✅ | The value to write. Any JSON-safe type. Cannot be `undefined`. |
| `route` | `string` | — | Dot or slash-separated path within the collection. |
| `persistence` | `"session" \| "permanent" \| { type, expiry }` | — | Persists this write to storage. Overrides any collection-level default from `config()`. |

---

### `UpState.get(collection, route)`

Reads a value from state and returns it wrapped in a `Result`. Never throws if the path doesn't exist — returns `new Result(null)` instead.

```js
UpState.get('user').raw;               // whole collection
UpState.get('user', 'profile.name').raw; // nested value
UpState.get({ collection: 'user', route: 'profile.name' }).raw; // object form

UpState.get().raw; // returns a clone of the entire state tree
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `collection` | `string` | — | The collection to read from. Omit to get the full state tree. |
| `route` | `string` | — | Dot or slash-separated path within the collection. |

Returns a [`Result`](#result) instance.

---

### `UpState.remove(collection, route)`

Deletes a value from state. If `route` is omitted, the entire collection is deleted. Fires matching subscriptions and dispatches an `"update"` event.

```js
UpState.remove('cart');                        // delete entire collection
UpState.remove('cart', 'items.0');             // delete a nested value
UpState.remove({ collection: 'cart', route: 'items.0' }); // object form
```

When a collection is deleted and `unsubscribeOnDelete` is `true` (the default), all subscriptions for that collection are automatically removed.

---

### `UpState.subscribe(options)`

Registers a callback to fire when a specific piece of state changes. Returns an `unsub` function that removes the subscription when called.

```js
// Watch an entire collection
const unsub = UpState.subscribe({
  collection: 'user',
  key: 'myWatcher',
  callback: (value) => console.log(value)
});

// Watch a specific nested route
UpState.subscribe({
  collection: 'user',
  route: 'profile.name',
  key: 'nameWatcher',
  callback: (name) => renderName(name)
});

// Remove the subscription
unsub();
// or
UpState.unsubscribe('nameWatcher');
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `collection` | `string` | ✅ | The collection to watch. |
| `route` | `string` | — | The nested path to watch. Omit to watch the entire collection. |
| `callback` | `Function` | ✅ | Receives the current value at the subscribed path. Not a `Result`. |
| `key` | `string` | — | A unique identifier for this subscription. Required to use `unsubscribe(key)`. Auto-generated if omitted. |
| `propagation` | `string` | — | Controls which related route changes trigger this callback. See [Subscriptions In Depth](#subscriptions-in-depth). |

---

### `UpState.unsubscribe(key)`

Removes the subscription registered under `key`. Throws if the key is not found.

```js
UpState.unsubscribe('myWatcher');
```

---

### `UpState.batchSet(arrayOfSetObjects)`

Writes multiple values in a single operation. Subscriptions are fired once per affected route after all writes complete, and a single `"update"` event is dispatched.

```js
UpState.batchSet([
  { collection: 'user', route: 'name', state: 'Alice' },
  { collection: 'user', route: 'age', state: 30 },
  { collection: 'settings', state: { theme: 'dark' } }
]);
```

---

### `UpState.batchGet(arrayOfGetRequests)`

Reads multiple values in a single call. Returns an array of `Result` instances in the same order as the input.

```js
const [user, settings] = UpState.batchGet([
  { collection: 'user' },
  { collection: 'settings' }
]);

user.raw;     // { name: 'Alice', age: 30 }
settings.raw; // { theme: 'dark' }
```

---

### `UpState.batchRemove(arrayOfRemoveRequests)`

Removes multiple values in a single operation. Subscriptions are fired once per affected route, and a single `"update"` event is dispatched.

```js
UpState.batchRemove([
  { collection: 'cart' },
  { collection: 'user', route: 'profile.avatar' }
]);
```

---

### `UpState.batchSubscribe(arrayOfSubscriptionObjects)`

Registers multiple subscriptions in a single call. Returns an object mapping each subscription's `key` to its `unsub` function.

```js
const unsubs = UpState.batchSubscribe([
  { collection: 'user', key: 'watchUser', callback: (v) => console.log('user:', v) },
  { collection: 'cart', key: 'watchCart', callback: (v) => console.log('cart:', v) }
]);

unsubs.watchUser(); // unsubscribe individually
```

All objects must include a `key` for the returned map to be useful.

---

### `UpState.batchUnsubscribe(keys)`

Removes multiple subscriptions by key in a single call.

```js
UpState.batchUnsubscribe(['watchUser', 'watchCart']);
```

---

### `UpState.purge(options?)`

Wipes all in-memory state, subscriptions, split-route caches, and persistent collection configuration. By default, also clears `localStorage` and `sessionStorage`.

```js
// Full reset — clears everything including storage
UpState.purge();

// Keep storage — wipes runtime state but leaves persisted data intact
UpState.purge({ keepStorage: true });
```

A `"purge"` CustomEvent is dispatched on the instance after the operation completes:

```js
UpState.on('purge', ({ detail }) => {
  console.log('Purged at', detail.timestamp);
  redirectToLogin();
});
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `keepStorage` | `boolean` | `false` | When `true`, skips clearing `localStorage` and `sessionStorage`. |

---

## The Debug API

The `debug` object on every `State` instance provides read-only introspection into the internal workings of UpState. All methods are frozen and return deep clones — they will never mutate state.

```js
UpState.debug.metrics();
```

### `debug.stateSnapshot()`

Returns a deep clone of the entire internal state tree.

```js
UpState.debug.stateSnapshot();
// { user: { name: 'Alice' }, cart: { items: [] } }
```

### `debug.collections()`

Returns an array of all current collection names.

```js
UpState.debug.collections();
// ['user', 'cart', 'settings']
```

### `debug.routes(collection)`

Returns a flat array of all dot-separated routes within a collection, including nested paths.

```js
UpState.debug.routes('user');
// ['name', 'profile', 'profile.avatar', 'profile.bio']
```

### `debug.activeSubscriptions()`

Returns a breakdown of all active subscriptions grouped by collection and route.

```js
UpState.debug.activeSubscriptions();
// {
//   user: {
//     '<entire-collection>': [{ key: 'watchUser', propagation: 'none' }],
//     'profile.name':        [{ key: 'nameWatcher', propagation: 'none' }]
//   }
// }
```

### `debug.has(collection, route?)`

Returns `true` if the collection (or the specific route within it) exists in state.

```js
UpState.debug.has('user');               // true
UpState.debug.has('user', 'profile.name'); // true
UpState.debug.has('user', 'missing.key'); // false
```

### `debug.routeInspect(collection, route?)`

Returns detailed information about a specific path in state.

```js
UpState.debug.routeInspect('user', 'profile.name');
// {
//   exists:     true,
//   type:       'string',
//   collection: 'user',
//   route:      'profile.name',
//   value:      'Alice'
// }
```

### `debug.metrics()`

Returns a summary of the current state of the UpState instance.

```js
UpState.debug.metrics();
// {
//   version:          '5.0.0',
//   collections:      3,
//   subscriptions:    7,
//   splitRouteCaches: 4
// }
```

### `debug.persistence()`

Returns the persistent collection configuration registered via `config()`.

```js
UpState.debug.persistence();
// { settings: { type: 'permanent', expiry: 'never' }, auth: { type: 'session', expiry: 'never' } }
```

### `debug.splitRouteCacheInfo()`

Returns the current state of the internal split-route cache, which UpState uses to avoid re-splitting route strings on every subscription check.

```js
UpState.debug.splitRouteCacheInfo();
// { splitRouteCache: { size: 4, keys: ['user', 'cart', ...] } }
```

### `debug.clearSplitRouteCache()`

Manually clears the split-route cache. Returns the number of cleared entries. This is rarely needed — the cache self-evicts at 1000 entries per collection.

```js
UpState.debug.clearSplitRouteCache();
// { cleared: 4 }
```

### `debug.trace(options?)`

Subscribes to a collection or route with `propagation: "tree"` and logs every change to the console, including the timestamp and current value. Auto-removes after `ttl` milliseconds (default: 60 seconds).

Returns a `stopTrace` function for manual cleanup.

```js
// Trace an entire collection
const stop = UpState.debug.trace({ collection: 'user' });

// Trace a specific route with a 10-second TTL
UpState.debug.trace({ collection: 'user', route: 'profile.name', ttl: 10000 });

// Stop tracing manually
stop();
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `collection` | `string` | — | The collection to trace. |
| `route` | `string` | — | The nested path to trace. Omit to trace the entire collection. |
| `key` | `string` | — | A unique key for the trace subscription. Auto-generated if omitted. |
| `ttl` | `number` | `60000` | Milliseconds before the trace auto-removes itself. |

### `debug.version()`

Prints the UpState console banner and returns the version string.

```js
UpState.debug.version(); // logs banner, returns '5.0.0'
```

---

## Result

Every `get()` and `batchGet()` call returns a `Result` instance, which wraps the retrieved value and provides safe coercion helpers.

```js
const result = UpState.get('user');

result.raw;         // the raw value as stored, or null if not found
result.asArray;     // always returns an array, never throws
result.asObject;    // always returns an object, never throws

result.mapArray((item, index) => item.name); // map over .asArray
result.mapObject((value, key) => value * 2); // map over .asObject
```

`Result` instances are frozen — they cannot be mutated.

| Accessor | Behaviour when value is `null` |
|---|---|
| `.raw` | Returns `null` |
| `.asArray` | Returns `[]` |
| `.asObject` | Returns `{}` |

---

## Persistence

UpState can persist any collection or individual write to `sessionStorage` or `localStorage`.

### Via `config()`

Register entire collections as persistent at startup:

```js
UpState.config({
  persistentCollections: {
    settings: 'permanent',                          // localStorage, no expiry
    auth:     { type: 'session', expiry: '8h' }    // sessionStorage, expires after 8 hours
  }
});
```

All subsequent `set()` calls to these collections will be automatically persisted.

### Via `set()`

Override persistence on a per-write basis:

```js
UpState.set({
  collection: 'auth',
  state: { token: 'xyz' },
  persistence: { type: 'permanent', expiry: '30d' }
});
```

Call-level `persistence` always takes priority over the collection-level default from `config()`.

### Expiry shorthand

| Shorthand | Duration |
|---|---|
| `"never"` | No expiry (default) |
| `500` | 500 milliseconds |
| `"500ms"` | 500 milliseconds |
| `"30s"` | 30 seconds |
| `"30m"` | 30 minutes |
| `"12h"` | 12 hours |
| `"7d"` | 7 days |

Expired entries are silently stripped when state is loaded from storage on the next page load.

### Persistence limitations

Only JSON-safe types survive a page reload:

| Type | Persisted? |
|---|---|
| `string`, `number`, `boolean`, `null` | ✅ |
| Plain objects and arrays | ✅ |
| `Date` (as ISO 8601 string, auto-revived on load) | ✅ |
| `undefined` | ❌ |
| `Map`, `Set` | ❌ |
| `RegExp` | ❌ |
| Class instances | ❌ |
| Functions | ❌ |
| Circular references | ❌ |

---

## Subscriptions In Depth

### `propagation`

Controls which related route changes will trigger a given callback. Accepts one of four string values:

| Value | Alias (also accepted) | Behaviour |
|---|---|---|
| `"self"` | `"none"` | Only fires when the exact subscribed route is changed (default). |
| `"descendants"` | `"up"` | Fires when the subscribed route **or any child route** is changed. |
| `"ancestors"` | `"down"` | Fires when the subscribed route **or any parent route** is changed. |
| `"tree"` | `"both"` | Fires when the subscribed route or any ancestor or descendant route is changed. |

```js
// Fires whenever anything inside 'user.profile' (or deeper) changes
UpState.subscribe({
  collection: 'user',
  route: 'profile',
  propagation: 'descendants',
  key: 'profileWatcher',
  callback: (value) => console.log('profile subtree changed:', value)
});
```

### Callback value

The callback always receives the value **at the subscribed route**, not at the route that actually changed. This means a `"descendants"` subscription on `"user.profile"` will always receive the `user.profile` object, even if `user.profile.name` was the actual change.

### Unsubscribing

```js
// Via the returned function
const unsub = UpState.subscribe({ ... });
unsub();

// Via key
UpState.unsubscribe('myKey');

// Via batchUnsubscribe
UpState.batchUnsubscribe(['key1', 'key2']);
```

---

## The `update` Event

UpState extends `EventTarget`. Listen for all state changes globally on the instance:

```js
UpState.addEventListener('update', (event) => {
  const { action, collection, route, state } = event.detail;
  console.log(action, collection); // e.g. "set" "user"
});
```

`event.detail` fields by action:

| Action | Fields |
|---|---|
| `"set"` | `action, collection, route, state, destination` |
| `"remove"` | `action, collection, route, state, destination` |
| `"batchSet"` | `action, count, routeMap` |
| `"batchRemove"` | `action, count, routeMap` |

> The `"update"` event can be disabled globally with `config({ allowEventDispatches: false })`.

A separate `"purge"` event is dispatched after `purge()` completes, with `detail: { timestamp }`.

---

## EventTarget Aliases

For convenience, two shorthand aliases are attached to the UpState instance:

```js
UpState.on('update', handler);   // alias for addEventListener
UpState.off('update', handler);  // alias for removeEventListener
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

## Cloning Modes

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

## `structuredClone` Warning

> ⚠️ **Storing values that `structuredClone` cannot handle will make UpState significantly slower.**

UpState's deep clone strategy first attempts `structuredClone`. If the value contains anything `structuredClone` cannot handle — class instances with methods, DOM nodes, `EventTarget`s, `WeakMap`s, functions, and similar — the attempt throws, and UpState falls back to a slower manual recursive clone.

The manual fallback has two consequences:

1. **Performance degrades.** The manual clone is meaningfully slower than `structuredClone`, particularly for large or deeply nested objects.
2. **Uncloneable things are silently dropped.** Functions are removed. Class instances lose their prototype chains and become plain objects. DOM node references are discarded. You will not get an error — you will simply get less data than you put in.

Store plain data. If you are consuming objects from a third-party SDK or library, extract only the primitive fields you need before passing them to `set()`. See [Third-party Object Warning](#third-party-object-warning) for an example.

If you are intentionally storing non-cloneable references and want to opt out of this behaviour entirely, set `cloning: "off"` in config — but note this means all callers share the same object reference, which can cause hard-to-track bugs.

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

- All state is stored under a single namespaced key per storage type (session and permanent). There is no per-collection separation in storage.
- **Cross-tab writes:** Multiple tabs writing at the same time will overwrite the full state blob. There is no merge strategy — last write wins.
- **Corrupted JSON:** If the stored JSON is invalid on load, UpState silently falls back to an empty state. A console error is logged unless `silenceWarnings` is enabled.

### Persistence data types

Only JSON-safe types survive a page reload. See [Persistence Limitations](#persistence-limitations).

### Circular references

Supported in runtime state via fallback cloning, but not supported in persistence (JSON limitation). Cannot be restored after reload.

### Date handling

UpState hydrates ISO 8601 strings into `Date` objects on load. Any string that happens to match the ISO 8601 format (e.g. an ID or serial number like `"2024-01-15T10:30:00.000Z"`) will be silently converted to a `Date` object.

### Subscriptions

- Large numbers of subscriptions may impact performance. Callback execution time scales with subscription count.
- No middleware, priority ordering, or interception system.

### Event system

- Built on native `EventTarget`.
- No cross-tab event syncing — each tab maintains independent runtime state (only persisted storage is shared).

### Object cloning

- DOM nodes and browser objects may not clone correctly. See [structuredClone Warning](#structuredclone-warning).
- Functions are removed during deep clone.
- Class instances lose their prototype chains after cloning.
- Strict equality (`===`) is not preserved after retrieval.

### Route system

- No escape system for `.` or `/` in key names.
- Poorly structured routes may collide.

---

## License

MIT

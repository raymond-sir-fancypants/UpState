"use strict";
/**
 * @fileoverview UpState — a lightweight, framework-agnostic reactive state-management
 * library for the browser.  It provides a single shared singleton ({@link UpState})
 * together with an exported {@link State} class so you can create isolated instances.
 *
 * Core features
 * - Hierarchical key-value state organised into *collections* and *routes*
 * - Fine-grained subscriptions with ancestor/descendant propagation
 * - Optional persistence via `sessionStorage` or `localStorage`
 * - Configurable deep / shallow / off cloning at set, get, and subscribe time
 * - A typed request / response bus for decoupled cross-module communication
 * - A fire-and-forget emit bus for broadcasting state snapshots
 * - Full batch API (batchSet, batchGet, batchRemove, batchSubscriptions)
 *
 * @module UpState
 * @version 4.2.0
 */

// ---------------------------------------------------------------------------
// Internal sentinel — used as a Map key to represent a collection-level
// subscription (i.e. one that has no route restriction).
// ---------------------------------------------------------------------------

/**
 * Internal sentinel symbol.  When used as a route key it signals that a
 * subscription covers an *entire collection* rather than a specific nested
 * path.  Never exposed publicly.
 *
 * @private
 * @type {symbol}
 */
const FIREONENTIRECOLLECTION = Symbol("fireOnEntireCollection");

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * A collection of pure static helpers used throughout the library.
 * Not exported — internal use only.
 *
 * @private
 */
class Utility {

    /**
     * Deserialises a JSON string and automatically converts any ISO 8601
     * date strings (the format emitted by `JSON.stringify`) back into native
     * `Date` objects.
     *
     * Handles both UTC (`Z` suffix) and offset (`±HH:mm`) timestamps.
     * Falls back gracefully on malformed JSON, returning `{}`.
     *
     * @param {string|null|undefined} jsonString - The raw JSON string to parse.
     * @returns {Object} The parsed object with dates hydrated, or `{}` on failure.
     *
     * @example
     * Utility.JSONHydrator('{"createdAt":"2024-01-15T10:30:00.000Z"}');
     * // → { createdAt: Date("2024-01-15T10:30:00.000Z") }
     */
    static JSONHydrator(jsonString) {
        if (!jsonString) return {};

        // Covers the full ISO 8601 spectrum used by JSON.stringify:
        // YYYY-MM-DDTHH:mm:ss.sssZ  or  YYYY-MM-DDTHH:mm:ss+HH:mm
        const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[-+]\d{2}:\d{2})?$/;

        try {
            return JSON.parse(jsonString, (key, value) => {
                if (typeof value === 'string' && isoDateRegex.test(value)) {
                    const potentialDate = new Date(value);
                    // Guard against semantically invalid dates (e.g. Feb 31)
                    return !isNaN(potentialDate.getTime()) ? potentialDate : value;
                }
                return value;
            });
        } catch (e) {
            // Second chance for strings that are valid JSON but triggered the reviver
            try {
                return JSON.parse(jsonString);
            } catch {
                return {};
            }
        }
    }

    /**
     * Recursively merges `source` into `target`, returning a **new** object /
     * array (the originals are never mutated).
     *
     * Merge rules
     * - **Arrays** — source array is *appended* to the target array.
     * - **Plain objects** — merged recursively (source wins on scalar conflicts).
     * - **Scalars / primitives** — source value overwrites the target.
     *
     * @param {Object|Array} target - The base value.
     * @param {Object|Array} source - Values to merge on top.
     * @returns {Object|Array} A new deeply-merged structure.
     *
     * @example
     * Utility.deepMerge({ a: 1, b: { c: 2 } }, { b: { d: 3 }, e: 4 });
     * // → { a: 1, b: { c: 2, d: 3 }, e: 4 }
     */
    static deepMerge(target, source) {
        const isArray = Array.isArray(source);
        const output = isArray ? (Array.isArray(target) ? [...target] : []) : { ...(target || {}) };

        for (const key in source) {
            if (Object.hasOwn(source, key)) {
                const sVal = source[key];
                const tVal = output[key];

                if (Array.isArray(sVal) && Array.isArray(tVal)) {
                    output[key] = [...tVal, ...sVal];
                } else if (sVal && typeof sVal === "object" && !Array.isArray(sVal)) {
                    output[key] = this.deepMerge(tVal || {}, sVal);
                } else {
                    output[key] = sVal;
                }
            }
        }

        return output;
    }

    /**
     * Resolves a dot- or slash-separated `route` string within a `collection`
     * inside `state`, returning the immediate **parent object** and the final
     * **key** so callers can read or write without iterating themselves.
     *
     * Two modes
     * - **Read mode** (`write = false`, default) — if any segment of the path
     *   is missing or not an object the method returns `{ targetParent: {}, targetKey: key }`
     *   as a safe "nothing found" sentinel, leaving the state untouched.
     * - **Write mode** (`write = true`) — missing segments are created as empty
     *   objects, repairing the path in-place.
     *
     * @param {string}  collection - Top-level state collection name.
     * @param {string}  route      - Dot- or slash-separated path, e.g. `"user.address.city"`.
     * @param {Object}  state      - The full state object to traverse.
     * @param {boolean} [write=false] - When `true`, broken path segments are auto-created.
     * @returns {{ targetParent: Object, targetKey: string }}
     *
     * @example
     * const state = { users: { alice: { age: 30 } } };
     * Utility.getPathInfo("users", "alice.age", state);
     * // → { targetParent: { age: 30 }, targetKey: "age" }
     *   // (targetParent is the alice object; read targetParent[targetKey] to get 30)
     */
    static getPathInfo(collection, route, state, write = false) {
        const routeArray = route.split(/[./]/);
        const key = routeArray[routeArray.length - 1];

        if (!Object.hasOwn(state, collection)) {
            if (!write) return { targetParent: {}, targetKey: key };
            state[collection] = {};
        }

        let cursor = state[collection];

        for (let i = 0; i < routeArray.length - 1; i++) {
            const part = routeArray[i];

            if (!(part in cursor) || typeof cursor[part] !== 'object' || cursor[part] === null) {
                if (!write) return { targetParent: {}, targetKey: key };
                cursor[part] = {};
            }

            cursor = cursor[part];
        }

        return { targetParent: cursor, targetKey: key };
    }

    /**
     * Produces a deep clone of `object`, handling circular references via a
     * `WeakMap`.  Delegates to `structuredClone` when available (modern browsers)
     * and falls back to a manual recursive copy that skips functions and the
     * global `window` object.
     *
     * @param {*}       object         - The value to clone.
     * @param {WeakMap} [seen]         - Circular-reference tracker (recursive use).
     * @param {boolean} [warned=false] - Suppresses duplicate console warnings.
     * @returns {*} A deep clone of `object`, or the original primitive / null.
     *
     * @example
     * const orig = { a: { b: 1 } };
     * const copy = Utility.clone(orig);
     * copy.a.b = 99;
     * console.log(orig.a.b); // 1 — orig is untouched
     */
    static clone(object, seen = new WeakMap(), warned = false) {
        if (!object || typeof object !== "object") return object;

        if (seen.has(object)) return seen.get(object);

        try {
            return structuredClone(object);
        } catch (err) {
            if (Array.isArray(object)) {
                const newArr = [];
                seen.set(object, newArr);
                object.forEach((item, index) => {
                    newArr[index] = this.clone(item, seen, true);
                });
                return newArr;
            }

            const newObj = {};
            seen.set(object, newObj);

            for (const key in object) {
                if (Object.prototype.hasOwnProperty.call(object, key)) {
                    const val = object[key];
                    if (typeof val !== 'function' && (typeof window === "undefined" || val !== window)) {
                        newObj[key] = this.clone(val, seen, true);
                    }
                }
            }
            return newObj;
        }
    }
}

// ---------------------------------------------------------------------------
// UpStateError
// ---------------------------------------------------------------------------

/**
 * Custom error class thrown by UpState when an invalid argument is passed or
 * a required argument is missing.  Extends the native `Error` so standard
 * `try/catch` and `instanceof` checks work as expected.
 *
 * @extends {Error}
 *
 * @property {string} name  Always `"UpStateError"`.
 * @property {string} code  A machine-readable error category (see below).
 *
 * Error codes
 * | Code              | Meaning                                                  |
 * |-------------------|----------------------------------------------------------|
 * | `GENERAL_ERROR`   | Default / uncategorised error.                           |
 * | `MISSING_ARG`     | A required argument was not provided.                    |
 * | `INVALID_ARG`     | An argument was provided but has an invalid type/value.  |
 *
 * @example
 * try {
 *   UpState.set({ collection: "", state: 1 });
 * } catch (err) {
 *   if (err instanceof UpStateError) {
 *     console.error(err.code, err.message);
 *   }
 * }
 */
class UpStateError extends Error {
    /**
     * @param {string} message - Human-readable error description.
     * @param {string} [code="GENERAL_ERROR"] - Machine-readable error category.
     */
    constructor(message, code = "GENERAL_ERROR") {
        super(message);
        this.name = "UpStateError";
        this.code = code;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, UpStateError);
        }
    }
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/**
 * An immutable wrapper returned by every `get` / `batchGet` call.
 * It normalises the underlying data so consumers never have to guard against
 * `null` / `undefined` themselves and can choose the shape they need.
 *
 * Instances are frozen via `Object.freeze` — you cannot add or remove
 * properties after construction.
 *
 * @example
 * const result = UpState.get("users");
 *
 * result.raw          // raw value — may be null
 * result.asArray      // always an array
 * result.asObject     // always a plain object
 * result.mapArray(u => u.name)   // ['Alice', 'Bob']
 * result.mapObject((u, id) => u.name)  // { 0: 'Alice', 1: 'Bob' }
 */
class Result {

    /** @type {*} @private */
    #data;

    /**
     * @param {*} input - The raw value to wrap.  `null` and `undefined` are
     *   both normalised to `null`.
     */
    constructor(input) {
        this.#data = (input === undefined || input === null) ? null : input;
        Object.freeze(this);
    }

    /**
     * The unwrapped value exactly as stored — may be `null`, a primitive,
     * an array, or a plain object.
     *
     * @type {*}
     * @readonly
     */
    get raw() {
        return this.#data;
    }

    /**
     * The value coerced to an array.
     *
     * Coercion rules:
     * - `null` → `[]`
     * - Already an array → returned as-is.
     * - Plain object → `Object.values(data)`.
     * - Any other value (primitive) → `[data]`.
     *
     * @type {Array}
     * @readonly
     */
    get asArray() {
        if (this.#data === null) return [];
        if (Array.isArray(this.#data)) return this.#data;
        if (typeof this.#data === "object" && Object.prototype.toString.call(this.#data) === '[object Object]') {
            return Object.values(this.#data);
        }
        return [this.#data];
    }

    /**
     * The value coerced to a plain object.
     *
     * Coercion rules:
     * - `null` → `{}`.
     * - Already a plain object → returned as-is.
     * - Array → index-keyed object `{ 0: item0, 1: item1, … }`.
     * - Any other value (primitive) → `{ 0: data }`.
     *
     * @type {Object}
     * @readonly
     */
    get asObject() {
        if (this.#data === null) return {};
        if (typeof this.#data === "object" && !Array.isArray(this.#data)) return this.#data;
        if (Array.isArray(this.#data)) {
            const map = {};
            this.#data.forEach((item, index) => { map[index] = item; });
            return map;
        }
        return { 0: this.#data };
    }

    /**
     * Maps over `asArray` with `callback`, returning a new plain array.
     * Undefined / null return values from the callback are coerced to `null`.
     *
     * @param {function(*, number): *} callback - `(item, index) => newValue`
     * @returns {Array} A new array of the mapped values.
     *
     * @example
     * UpState.get("users").mapArray(user => user.name);
     * // → ['Alice', 'Bob', 'Charlie']
     */
    mapArray(callback) {
        const newArray = [];
        const currentList = this.asArray;
        for (let i = 0; i < currentList.length; i++) {
            newArray.push(callback(currentList[i], i) ?? null);
        }
        return newArray;
    }

    /**
     * Maps over `asObject` with `callback`, returning a new plain object with
     * the same keys.  Undefined / null return values are coerced to `null`.
     *
     * @param {function(*, string): *} callback - `(value, key) => newValue`
     * @returns {Object} A new object with the same keys and mapped values.
     *
     * @example
     * UpState.get("users").mapObject((user, id) => `${id}:${user.name}`);
     * // → { alice: 'alice:Alice', bob: 'bob:Bob' }
     */
    mapObject(callback) {
        const currentMap = this.asObject;
        const keys = Object.keys(currentMap);
        const newMap = {};
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            newMap[key] = callback(currentMap[key], key) ?? null;
        }
        return newMap;
    }
}

// ---------------------------------------------------------------------------
// StorageHandler
// ---------------------------------------------------------------------------

/**
 * Manages persistence of state slices to `sessionStorage` and `localStorage`.
 *
 * Both storage areas are keyed under a single `"UpState"` JSON blob so the
 * library leaves a minimal footprint.  An in-memory *virtual* mirror of each
 * driver is maintained (`virtualLocalStorage`) to avoid redundant
 * `JSON.parse` calls on every operation.
 *
 * On construction the mirrors are populated from whatever is already stored,
 * so persisted state survives page reloads automatically.
 *
 * @private
 */
class StorageHandler {

    /**
     * Initialises the virtual mirrors from `sessionStorage` and `localStorage`.
     * Invalid JSON is silently discarded and replaced with an empty object.
     */
    constructor() {
        const sessionRaw = sessionStorage.getItem("UpState") || "{}";
        let sessionParsed;
        try { sessionParsed = Utility.JSONHydrator(sessionRaw); }
        catch { sessionParsed = {}; }

        const permanentRaw = localStorage.getItem("UpState") || "{}";
        let permanentParsed;
        try { permanentParsed = Utility.JSONHydrator(permanentRaw); }
        catch { permanentParsed = {}; }

        /**
         * In-memory mirrors of the two storage drivers.
         * @type {{ session: Object, permanent: Object }}
         */
        this.virtualLocalStorage = {
            session: sessionParsed,
            permanent: permanentParsed
        };
    }

    /**
     * Persists a value into the appropriate storage driver and updates the
     * virtual mirror.
     *
     * When `route` is omitted the entire collection is replaced.
     * When `route` is provided only the nested key at that path is updated.
     *
     * @param {Object} options
     * @param {string} options.collection   - Collection name.
     * @param {*}      options.state        - Value to persist.
     * @param {string} [options.route]      - Dot/slash path within the collection.
     * @param {"session"|"permanent"} options.persistence - Target driver.
     */
    set({ collection, state, route, persistence }) {
        const driver = (persistence === "session") ? sessionStorage : localStorage;
        const localState = this.virtualLocalStorage[persistence] ?? {};

        if (!route) {
            localState[collection] = state;
        } else {
            const { targetParent, targetKey } = Utility.getPathInfo(collection, route, localState, true);
            if (targetParent) targetParent[targetKey] = state;
        }

        this.virtualLocalStorage[persistence] = localState;
        driver.setItem("UpState", JSON.stringify(localState));
    }

    /**
     * Removes a value from **both** `sessionStorage` and `localStorage` (and
     * their mirrors) to ensure the key is fully expunged regardless of which
     * driver originally persisted it.
     *
     * @param {string}  collection - Collection name.
     * @param {string}  [route]    - Dot/slash path.  Omit to remove the entire collection.
     */
    remove(collection, route) {
        const remove = (driver, virtualDriver) => {
            const localState = this.virtualLocalStorage[virtualDriver] ?? {};

            if (!route) {
                delete localState[collection];
            } else {
                const { targetParent, targetKey } = Utility.getPathInfo(collection, route, localState, false);
                if (targetParent) delete targetParent[targetKey];
            }

            this.virtualLocalStorage[virtualDriver] = localState;
            driver.setItem("UpState", JSON.stringify(localState));
        };

        remove(localStorage, "permanent");
        remove(sessionStorage, "session");
    }
}

/** @private @type {StorageHandler} */
const storageHandlerInstance = new StorageHandler();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * The main UpState class.  Manages in-memory state, subscriptions, persistence,
 * and the request/response and emit message buses.
 *
 * You will normally import and use the default singleton export `UpState`
 * rather than instantiating this class directly.  However, `State` is also a
 * named export when you need isolated instances (e.g. unit tests or
 * micro-frontend boundaries).
 *
 * Extends `EventTarget` so the instance itself can dispatch and receive DOM
 * events.  Three convenience aliases are attached during construction:
 * - `UpState.on`  → `addEventListener`
 * - `UpState.off` → `removeEventListener`
 * - `UpState.emit`→ `dispatchEvent`
 *
 * An `"update"` CustomEvent is dispatched on the instance after every
 * `set`, `remove`, `batchSet`, and `batchRemove` call.  Its `detail` shape
 * varies by action — see each method's documentation for specifics.
 *
 * @extends {EventTarget}
 *
 * @example
 * // Using the singleton (most common)
 * import UpState from './upstate.js';
 *
 * UpState.set({ collection: 'user', state: { name: 'Alice' } });
 * console.log(UpState.get('user').raw); // { name: 'Alice' }
 *
 * @example
 * // Creating an isolated instance
 * import { State } from './upstate.js';
 * const myState = new State();
 */
class State extends EventTarget {

    // -----------------------------------------------------------------------
    // Private fields
    // -----------------------------------------------------------------------

    /**
     * The master in-memory store.  Top-level keys are collection names.
     * @private
     * @type {Object}
     */
    #state = Object.create(null);

    /**
     * Maps collection names to their persistence type ("session" | "permanent").
     * Populated via `config({ persistentCollections })`.
     * @private
     * @type {Map<string, "session"|"permanent">}
     */
    #persistentCollections = new Map();

    /**
     * Stores abort callbacks for active `onResponse` listeners, keyed by request `uid`.
     * @private
     * @type {Map<string, Function>}
     */
    #killResponseRegistry = new Map();

    /**
     * Stores abort callbacks for active `onRequest` listeners, keyed by event name.
     * @private
     * @type {Map<string, Function>}
     */
    #killRequestRegistry = new Map();

    /**
     * Temporary cache holding per-request metadata (destination, transform,
     * callback) between `request()` and `response()`.
     * @private
     * @type {Map<string, Object>}
     */
    #requestDetailCache = new Map();

    /**
     * Stores abort callbacks for active `onEmit` listeners, keyed by event name.
     * @private
     * @type {Map<string, Function>}
     */
    #killEmitRegistry = new Map();

    /**
     * LRU cache mapping route strings to their pre-split arrays.
     * Avoids repeated `String.split` on hot subscription paths.
     * Capped at 1000 entries per collection.
     * @private
     * @type {Map<string, Map<string, string[]>>}
     */
    #splitRouteCache = new Map();

    /**
     * Maps subscription keys to their `unsub` functions for O(1) unsubscription.
     * @private
     * @type {Map<string, Function>}
     */
    #unsubCallbacks = new Map();

    /**
     * Nested subscription registry.
     * Shape: `Map<collection, Map<route|Symbol, { splitRoute: string[], routeNode: Map<key, routeNode> }>>`
     * @private
     * @type {Map<string, Map<string|symbol, Object>>}
     */
    #subscriptions = new Map();

    /**
     * Holds `setTimeout` handles for in-flight requests so they can be cleared
     * on `response()` or cleared when TTL fires.
     * @private
     * @type {Map<string, number>}
     */
    #ttlTimeout = new Map();

    /**
     * When `false`, no `"update"` CustomEvents are dispatched.
     * Configurable via `config({ allowEventDispatches })`.
     * @private
     * @type {boolean}
     */
    #allowEventDispatches = true;

    /**
     * When `true`, suppresses internal console warnings.
     * @private
     * @type {boolean}
     */
    #silenceWarnings = false;

    /**
     * The internal EventTarget used exclusively by the emit and request/response
     * buses.  Kept separate from `this` (the public EventTarget) to avoid
     * collisions with user-defined event names.
     * @private
     * @type {EventTarget}
     */
    #bus = new EventTarget();

    /**
     * Controls how values are cloned at each stage of the data lifecycle.
     *
     * Each property can independently be `"deep"`, `"shallow"`, or `"off"`:
     * - `onSet`       — when a value is written to state.
     * - `onGet`       — when a value is read via `get()`.
     * - `onSubscribe` — when a value is delivered to a subscription callback.
     *
     * Defaults to `"deep"` for all three.
     *
     * @private
     * @type {{ onSet: "deep"|"shallow"|"off", onGet: "deep"|"shallow"|"off", onSubscribe: "deep"|"shallow"|"off" }}
     */
    #cloningOptions = {
        onSet: "deep",
        onGet: "deep",
        onSubscribe: "deep"
    };

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    /**
     * Creates a new `State` instance.
     *
     * On construction the in-memory `#state` is seeded from any persisted data
     * found in `localStorage` and `sessionStorage`.  Session data wins over
     * permanent data on key conflicts (`deepMerge` merge order).
     *
     * Three shorthand aliases are added for the inherited EventTarget methods:
     * - `this.on`   → `addEventListener`
     * - `this.off`  → `removeEventListener`
     * - `this.emit` → `dispatchEvent`
     */
    constructor() {
        super();
        this.#state = Utility.deepMerge(
            storageHandlerInstance.virtualLocalStorage.permanent,
            storageHandlerInstance.virtualLocalStorage.session,
        );

        /** @type {EventTarget['addEventListener']} */
        this.on = this.addEventListener.bind(this);

        /** @type {EventTarget['removeEventListener']} */
        this.off = this.removeEventListener.bind(this);

        /** @type {EventTarget['dispatchEvent']} */
        this.emit = this.dispatchEvent.bind(this);
    }

    // -----------------------------------------------------------------------
    // config
    // -----------------------------------------------------------------------

    /**
     * Configures global options for this `State` instance.  Call once, early
     * in your application's lifecycle, before any `set` / `subscribe` calls
     * that depend on these settings.
     *
     * @param {Object}  options
     *
     * @param {Object}  [options.persistentCollections={}]
     *   A map of `collectionName → "session" | "permanent"`.
     *   Each listed collection will be automatically synced to the appropriate
     *   Web Storage driver whenever it changes.
     *   **Note:** only collections that already exist in state at the time
     *   `config()` is called are registered; setting a collection *after*
     *   `config()` requires passing `persistence` directly to `set()`.
     *
     * @param {boolean} [options.allowEventDispatches=true]
     *   When `false`, the `"update"` CustomEvent is never dispatched.
     *   Useful in environments without a DOM or in tests.
     *
     * @param {boolean} [options.silenceWarnings=false]
     *   When `true`, suppresses non-critical internal console warnings.
     *
     * @param {"deep"|"shallow"|"off"|Object} [options.cloning="deep"]
     *   Controls value cloning.  Can be a single string to set all three
     *   stages at once, or an object with one or more of:
     *   - `onSet`       — clone when writing to state.
     *   - `onGet`       — clone when reading from state.
     *   - `onSubscribe` — clone when delivering to a subscriber callback.
     *
     *   Values:
     *   - `"deep"`    — full structural clone (default, safest).
     *   - `"shallow"` — one-level spread clone.
     *   - `"off"`     — no cloning; references are shared (fastest, but risky).
     *
     * @throws {UpStateError} `MISSING_ARG` if `persistentCollections` is not
     *   a plain object.
     * @throws {UpStateError} `MISSING_ARG` if an invalid `cloning` string is
     *   provided.
     *
     * @example
     * UpState.config({
     *   persistentCollections: {
     *     userPrefs: "permanent",
     *     cart:      "session",
     *   },
     *   cloning: { onSet: "deep", onGet: "shallow", onSubscribe: "deep" },
     * });
     */
    config({
        persistentCollections = {},
        allowEventDispatches = true,
        silenceWarnings = false,
        cloning = "deep",
    }) {
        this.#allowEventDispatches = !!allowEventDispatches;
        this.#silenceWarnings = !!silenceWarnings;

        const optionMap = new Set(["deep", "shallow", "off"]);
        if (typeof cloning === "string") {
            if (optionMap.has(cloning)) {
                this.#cloningOptions = { onSet: cloning, onGet: cloning, onSubscribe: cloning };
            } else {
                throw new UpStateError(
                    "'cloning' values can only either be 'deep', 'shallow' or 'off'",
                    "MISSING_ARG"
                );
            }
        } else {
            for (const key in this.#cloningOptions) {
                if (cloning[key] !== undefined) {
                    if (!optionMap.has(cloning[key])) {
                        throw new UpStateError(
                            "'cloning' values can only either be 'deep', 'shallow' or 'off'",
                            "MISSING_ARG"
                        );
                    }
                    this.#cloningOptions[key] = cloning[key];
                }
            }
        }

        if (persistentCollections && !Array.isArray(persistentCollections) && persistentCollections !== undefined) {
            for (const collectionKey in persistentCollections) {
                const persistence = persistentCollections[collectionKey];
                const state = this.#state[collectionKey];

                if (state !== undefined) {
                    this.#persistentCollections.set(collectionKey, persistence);
                    storageHandlerInstance.set({ collection: collectionKey, state, persistence });
                }
            }
        } else {
            throw new UpStateError(
                "'persistentCollections' value has to be an object mapping 'collection' to 'persistence' type",
                "MISSING_ARG"
            );
        }
    }

    // -----------------------------------------------------------------------
    // subscribe / unsubscribe
    // -----------------------------------------------------------------------

    /**
     * Registers a callback that fires whenever a specific collection or route
     * within a collection changes.
     *
     * Propagation options control *which* changes trigger the callback:
     *
     * | Option          | Internal alias | Fires when…                                        |
     * |-----------------|----------------|----------------------------------------------------|
     * | `"exact"`       | `"none"`       | Only the *exact* subscribed route changes.         |
     * | `"ancestors"`   | `"up"`         | The route *or any of its ancestor paths* change.   |
     * | `"descendants"` | `"down"`       | The route *or any of its descendant paths* change. |
     * | `"related"`     | `"both"`       | Any ancestor *or* descendant change.               |
     *
     * The callback receives a clone of the value **at the subscribed route**
     * (not at the route that actually changed), cloned according to the
     * `onSubscribe` cloning option.
     *
     * Collection-level subscribers (no `route`) with `propagation: "exact"`
     * fire only when the entire collection is replaced (not when a nested key
     * changes).
     *
     * @param {Object}   options
     * @param {string}   options.collection  - Collection to watch.
     * @param {string}   [options.route]     - Dot/slash path within the collection.
     *                                         Omit to subscribe to the whole collection.
     * @param {Function} options.callback    - `(value) => void`.  Receives the current
     *                                         value at the subscribed route.
     * @param {string}   options.key         - Unique identifier for this subscription.
     *                                         Used to unsubscribe later.
     * @param {"exact"|"ancestors"|"descendants"|"related"} [options.propagation="exact"]
     *   - Controls which changes trigger the callback.
     *
     * @returns {Function} An `unsub` function — call it to remove the subscription.
     *
     * @throws {UpStateError} `MISSING_ARG` / `INVALID_ARG` for invalid parameters.
     * @throws {UpStateError} `INVALID_ARG` if `key` is already in use.
     *
     * @example
     * // Subscribe to an exact route
     * const unsub = UpState.subscribe({
     *   collection: "user",
     *   route: "profile.name",
     *   key: "nameWatcher",
     *   callback: (name) => console.log("Name changed:", name),
     * });
     *
     * // Subscribe to an entire collection
     * UpState.subscribe({
     *   collection: "cart",
     *   key: "cartWatcher",
     *   callback: (cart) => renderCart(cart),
     * });
     *
     * // Clean up
     * unsub(); // or UpState.unsubscribe("nameWatcher")
     */
    subscribe({ collection, route, callback, key, propagation = "none" } = {}) {
        const propagationOptions = new Set(["none", "both", "up", "down"]);
        const publicPropagationOptions = new Set(["exact", "related", "ancestors", "descendants"]);

        // Map public-facing aliases to internal values
        switch (propagation) {
            case "exact":       propagation = "none"; break;
            case "related":     propagation = "both"; break;
            case "ancestors":   propagation = "up";   break;
            case "descendants": propagation = "down"; break;
        }

        if (!propagationOptions.has(propagation)) {
            throw new UpStateError(
                `'propagation' must be one of: ${[...publicPropagationOptions].join(", ")}`,
                "INVALID_ARG"
            );
        }
        if (collection === undefined || collection === "") throw new UpStateError("'collection' name is required", "MISSING_ARG");
        if (typeof collection !== "string")                throw new UpStateError("'collection' value has to be be a String", "INVALID_ARG");
        if (callback === undefined)                        throw new UpStateError("'subscription' callback is required", "MISSING_ARG");
        if (typeof callback !== "function")                throw new UpStateError("'subscription' callback has to be a function", "INVALID_ARG");
        if (key === undefined)                             throw new UpStateError("'key' is required", "MISSING_ARG");
        if (typeof key !== "string")                       throw new UpStateError("'key' value has to be a string", "INVALID_ARG");
        if (this.#unsubCallbacks.has(key))                 throw new UpStateError("the 'key' entered is already in use", "INVALID_ARG");

        route = route ?? FIREONENTIRECOLLECTION;

        if (!this.#subscriptions.has(collection)) this.#subscriptions.set(collection, new Map());

        const routeMap = this.#subscriptions.get(collection);

        if (!routeMap.has(route)) {
            routeMap.set(route, {
                splitRoute: (route === FIREONENTIRECOLLECTION) ? [] : route.split(/[./]/),
                routeNode: new Map(),
            });
        }

        const subscriptionObj = routeMap.get(route);

        const routeNode = Object.freeze({ route, propagation, callback, key });
        subscriptionObj.routeNode.set(key, routeNode);

        const callbackMap = subscriptionObj.routeNode;

        const unsub = () => {
            if (callbackMap.size <= 1) {
                routeMap.delete(route);
                if (routeMap.size === 0) this.#subscriptions.delete(collection);
            } else {
                callbackMap.delete(key);
            }
            this.#unsubCallbacks.delete(key);
        };

        this.#unsubCallbacks.set(key, unsub);
        return unsub;
    }

    /**
     * Registers multiple subscriptions in a single call.
     *
     * Equivalent to calling {@link State#subscribe} for each item in the array.
     * Returns a keyed map of `unsub` functions so callers can clean up
     * individual subscriptions or iterate the map.
     *
     * @param {Array<Object>} arrayOfSubscriptionObjects
     *   Array of option objects, each matching the signature of {@link State#subscribe}.
     *
     * @returns {Object.<string, Function>}
     *   Map of `key → unsub` function.
     *
     * @throws {UpStateError} `INVALID_ARG` if the argument is not an array.
     *
     * @example
     * const unsubs = UpState.batchSubscriptions([
     *   { collection: "user",    key: "userSub",    callback: onUser    },
     *   { collection: "cart",    key: "cartSub",    callback: onCart    },
     *   { collection: "session", key: "sessionSub", callback: onSession },
     * ]);
     *
     * // Later:
     * unsubs.cartSub();
     */
    batchSubscriptions(arrayOfSubscriptionObjects) {
        if (!Array.isArray(arrayOfSubscriptionObjects)) {
            throw new UpStateError(
                "'batchSubscriptions' was expecting an array of objects meant for the subscribe method",
                "INVALID_ARG"
            );
        }

        const unsubs = {};
        arrayOfSubscriptionObjects.forEach(obj => { unsubs[obj.key] = this.subscribe(obj); });
        return unsubs;
    }

    /**
     * Removes one or more subscriptions by their `key`.
     *
     * Accepts either a single key string or an array of key strings.
     *
     * @param {string|string[]} keys - Subscription key(s) to remove.
     *
     * @throws {UpStateError} `INVALID_ARG` if a key is not a string or is not
     *   found in the subscription registry.
     *
     * @example
     * UpState.unsubscribe("nameWatcher");
     * UpState.unsubscribe(["nameWatcher", "cartWatcher"]);
     */
    unsubscribe(keys) {
        const unsubFunc = (key) => {
            if (typeof key !== "string")         throw new UpStateError("'key' has to be a string", "INVALID_ARG");
            if (!this.#unsubCallbacks.has(key))  throw new UpStateError(`no subscription found for key "${key}"`, "INVALID_ARG");
            this.#unsubCallbacks.get(key)();
        };

        if (Array.isArray(keys)) { keys.forEach(key => unsubFunc(key)); }
        else { unsubFunc(keys); }
    }

    /**
     * Removes multiple subscriptions in one call.  Alias for calling
     * {@link State#unsubscribe} with an array, but throws a more specific
     * error if the argument is not an array.
     *
     * @param {string[]} keys - Array of subscription keys to remove.
     *
     * @throws {UpStateError} `INVALID_BATCH_UNSUB_ARGUMENT` if argument is not
     *   an array.
     *
     * @example
     * UpState.batchUnsubscribe(["userSub", "cartSub", "sessionSub"]);
     */
    batchUnsubscribe(keys) {
        if (!Array.isArray(keys)) {
            throw new UpStateError("'batchUnsubscribe' was expecting an array of keys", "INVALID_BATCH_UNSUB_ARGUMENT");
        }
        keys.forEach(key => this.unsubscribe(key));
    }

    // -----------------------------------------------------------------------
    // Internal subscription-firing helpers
    // -----------------------------------------------------------------------

    /**
     * Compares two pre-split route arrays and returns ancestor/descendant
     * relationship flags.
     *
     * Two routes are *related* if they share a common prefix of the shorter
     * one.  In that case:
     * - `up`   (`ancestors`)   is `true` when the subscriber route is shorter
     *   or equal (i.e. the sub watches a node *above* the fired route).
     * - `down` (`descendants`) is `true` when the fired route is shorter or
     *   equal (the sub watches a node *at or below* the fired route).
     * - `both` (`related`)     is `true` when any common prefix exists.
     *
     * @private
     * @param {string[]} splitFired - Split route that just changed.
     * @param {string[]} splitSub   - Split route of the subscription.
     * @returns {{ both: boolean, up: boolean, down: boolean }}
     */
    #compareRoutes(splitFired, splitSub) {
        const shorter = Math.min(splitFired.length, splitSub.length);
        let sharedPrefix = true;

        for (let i = 0; i < shorter; i++) {
            if (splitFired[i] !== splitSub[i]) { sharedPrefix = false; break; }
        }

        return {
            both: sharedPrefix,
            up:   sharedPrefix && splitSub.length   <= splitFired.length,
            down: sharedPrefix && splitFired.length  <= splitSub.length,
        };
    }

    /**
     * Fires all callbacks in `routeMap` when the *entire collection* has been
     * set (no specific route).
     *
     * Callbacks with `propagation === "none"` are skipped unless they are
     * themselves collection-level subscribers — those opted in to collection
     * resets.
     *
     * @private
     * @param {Map}    routeMap       - The route→subscription map for this collection.
     * @param {string} collection     - Collection name (for state lookup).
     * @param {Set}    firedCallbacks - De-duplication set (keys already invoked).
     */
    #fireEntireCollection(routeMap, collection, firedCallbacks) {
        const collectionState = this.#cloneValue(this.#state[collection], this.#cloningOptions.onSubscribe);

        routeMap.forEach((value) => {
            value.routeNode.forEach((v) => {
                if (firedCallbacks.has(v.key)) return;
                firedCallbacks.add(v.key);
                if (v.propagation !== "none" || v.route === FIREONENTIRECOLLECTION) {
                    v.callback(collectionState);
                }
            });
        });
    }

    /**
     * Fires only the callbacks whose subscription routes are *related* to
     * `route`, according to each callback's propagation mode.
     *
     * Uses an LRU-style route-split cache (max 1 000 entries per collection)
     * to avoid redundant `String.split` work on hot paths.
     *
     * @private
     * @param {Map}    routeMap       - The route→subscription map for this collection.
     * @param {string} collection     - Collection name.
     * @param {string} route          - The route that just changed.
     * @param {Set}    firedCallbacks - De-duplication set.
     */
    #fireSpecificRoute(routeMap, collection, route, firedCallbacks) {
        if (!this.#splitRouteCache.has(collection)) this.#splitRouteCache.set(collection, new Map());

        const collectionCache = this.#splitRouteCache.get(collection);

        if (!collectionCache.has(route)) {
            if (collectionCache.size >= 1000) collectionCache.delete(collectionCache.keys().next().value);
            collectionCache.set(route, route.split(/[./]/));
        } else {
            // Re-insert to mark as recently used (LRU behaviour)
            const val = collectionCache.get(route);
            collectionCache.delete(route);
            collectionCache.set(route, val);
        }

        const splitFired = collectionCache.get(route);

        for (const [key, value] of routeMap) {
            if (key === FIREONENTIRECOLLECTION) {
                const collectionState = this.#cloneValue(this.#state[collection], this.#cloningOptions.onSubscribe);
                value.routeNode.forEach((v) => {
                    if (firedCallbacks.has(v.key)) return;
                    firedCallbacks.add(v.key);
                    if (v.propagation !== "none") v.callback(collectionState);
                });
            } else {
                const match = this.#compareRoutes(splitFired, value.splitRoute);
                const { targetParent, targetKey } = Utility.getPathInfo(collection, key, this.#state);
                const data = this.#cloneValue(targetParent?.[targetKey], this.#cloningOptions.onSubscribe);

                value.routeNode.forEach((v) => {
                    if (firedCallbacks.has(v.key)) return;
                    firedCallbacks.add(v.key);

                    switch (v.propagation) {
                        case "up":   if (match.up)   v.callback(data); break;
                        case "down": if (match.down) v.callback(data); break;
                        case "both": if (match.both) v.callback(data); break;
                        case "none": if (route === v.route) v.callback(data); break;
                    }
                });
            }
        }
    }

    /**
     * Orchestrator — determines whether the change was collection-level or
     * route-level and delegates to the appropriate private firing method.
     *
     * @private
     * @param {string}          collection - Collection that changed.
     * @param {string|undefined} [route]   - Route that changed; `undefined`
     *   means the entire collection was replaced.
     */
    #fireSubscriptionCallbacks(collection, route) {
        if (!this.#subscriptions.has(collection)) return;

        const firedCallbacks = new Set();
        route = route ?? FIREONENTIRECOLLECTION;
        const routeMap = this.#subscriptions.get(collection);

        if (route === FIREONENTIRECOLLECTION) {
            this.#fireEntireCollection(routeMap, collection, firedCallbacks);
        } else {
            this.#fireSpecificRoute(routeMap, collection, route, firedCallbacks);
        }
    }

    /**
     * Clones `value` according to `mode`.
     *
     * @private
     * @param {*}                        value - Value to clone.
     * @param {"deep"|"shallow"|"off"}   mode  - Cloning strategy.
     * @returns {*} The (possibly cloned) value.
     */
    #cloneValue(value, mode) {
        if (!value || typeof value !== "object") return value;
        switch (mode) {
            case "off":     return value;
            case "shallow": return Array.isArray(value) ? [...value] : { ...value };
            default:        return Utility.clone(value);
        }
    }

    // -----------------------------------------------------------------------
    // set / get / remove
    // -----------------------------------------------------------------------

    /**
     * Writes a value into state.
     *
     * If `route` is omitted the *entire collection* is replaced.
     * If `route` is provided only the nested key at that path is updated;
     * intermediate path segments are created automatically if they don't exist.
     *
     * After writing, any matching subscriptions are fired and an `"update"`
     * CustomEvent is dispatched on the instance (unless disabled).
     *
     * @param {Object}                      setObject
     * @param {string}                      setObject.collection  - Collection name.
     * @param {*}                           setObject.state       - Value to store.
     *                                        May be any JSON-serialisable value,
     *                                        including objects, arrays, and primitives.
     *                                        `undefined` is not allowed.
     * @param {string}                      [setObject.route]     - Dot/slash path within
     *                                        the collection, e.g. `"user.address.city"`.
     * @param {"session"|"permanent"}       [setObject.persistence] - Override persistence
     *                                        for this call.  Takes priority over any
     *                                        collection-level persistence set in `config()`.
     *
     * @throws {UpStateError} `MISSING_ARG` if `collection` is missing or empty.
     * @throws {UpStateError} `INVALID_ARG` if `state` is `undefined`.
     * @throws {UpStateError} `INVALID_ARG` if `persistence` is not a string.
     * @throws {UpStateError} `INVALID_ARG` if `persistence` is not `"session"` or
     *   `"permanent"`.
     *
     * @fires State#update  `detail: { collection, route, destination, state, action: "set" }`
     *
     * @example
     * // Replace an entire collection
     * UpState.set({ collection: "user", state: { name: "Alice", age: 30 } });
     *
     * // Update a nested key
     * UpState.set({ collection: "user", route: "address.city", state: "London" });
     *
     * // Set with per-call persistence
     * UpState.set({ collection: "token", state: "abc123", persistence: "session" });
     */
    set(setObject = {}) { this.#factorySet(setObject); }

    /**
     * Internal implementation for `set()` and `batchSet()`.
     *
     * @private
     * @param {Object}  setObject
     * @param {Object}  [opts]
     * @param {boolean} [opts.fireSubscriptionCallbacks=true]
     * @param {boolean} [opts.dispatchUpdateEvent=true]
     */
    #factorySet(
        { collection, state, route, persistence },
        { fireSubscriptionCallbacks = true, dispatchUpdateEvent = true } = {}
    ) {
        fireSubscriptionCallbacks = !!fireSubscriptionCallbacks;

        if (collection === undefined || collection === "") throw new UpStateError("'collection' value has to be be a String", "MISSING_ARG");
        if (typeof collection !== "string")               throw new UpStateError("'collection' can only be a String", "INVALID_ARG");
        if (state === undefined)                          throw new UpStateError("state value cannot be undefined", "INVALID_ARG");

        state = (typeof state === 'object' && state !== null)
            ? this.#cloneValue(state, this.#cloningOptions.onSet)
            : state;

        const destination = {};

        if (!route) {
            this.#state[collection] = state;
            destination.targetParent = this.#state;
            destination.targetKey = collection;
            if (fireSubscriptionCallbacks) this.#fireSubscriptionCallbacks(collection);
        } else {
            const { targetParent, targetKey } = Utility.getPathInfo(collection, route, this.#state, true);
            destination.targetParent = targetParent;
            destination.targetKey = targetKey;
            if (targetParent) {
                targetParent[targetKey] = state;
                if (fireSubscriptionCallbacks) this.#fireSubscriptionCallbacks(collection, route);
            }
        }

        if (typeof persistence !== "string" && persistence !== undefined) {
            throw new UpStateError("'persistence' can only be a string", "INVALID_ARG");
        }

        persistence = persistence ?? this.#persistentCollections.get(collection);

        if (persistence) {
            const persistenceValue = String(persistence).toLowerCase();
            if (persistenceValue === "permanent" || persistenceValue === "session") {
                storageHandlerInstance.set({ collection, state, route, persistence });
            } else {
                throw new UpStateError("'persistence' value can only be either 'session' or 'permanent'", "INVALID_ARG");
            }
        }

        if (dispatchUpdateEvent && this.#allowEventDispatches) {
            this.dispatchEvent(new CustomEvent("update", {
                detail: { collection, route, destination, state, action: "set" },
                cancelable: true,
            }));
        }
    }

    /**
     * Reads a value from state, returning it wrapped in a {@link Result}.
     *
     * Overloads:
     * 1. `get()` — returns the **entire** state object.
     * 2. `get("collection")` — returns the entire collection.
     * 3. `get("collection", "route.path")` — returns the value at that nested key.
     * 4. `get({ collection, route })` — object-form shorthand.
     *
     * The value is cloned according to the `onGet` cloning option before being
     * wrapped.  If the collection or path does not exist, `Result.raw` is `null`.
     *
     * @param {string|Object} [collectionOrObject] - Collection name or options object.
     * @param {string}        [route]              - Dot/slash path within the collection.
     * @returns {Result} Immutable result wrapper.
     *
     * @throws {UpStateError} `MISSING_ARG` if `collection` is an empty string.
     * @throws {UpStateError} `INVALID_ARG` if `collection` is not a string.
     *
     * @example
     * UpState.get("user").raw;               // { name: "Alice", age: 30 }
     * UpState.get("user", "address.city").raw; // "London"
     * UpState.get({ collection: "user", route: "address.city" }).raw; // "London"
     * UpState.get("missing").raw;             // null
     */
    get(collectionOrObject, route) {
        let collection = collectionOrObject;

        if (typeof collectionOrObject === "object" && collectionOrObject !== null) {
            collection = collectionOrObject.collection;
            route = collectionOrObject.route;
        }

        if (collection === undefined) return new Result(this.#cloneValue(this.#state, this.#cloningOptions.onGet));
        if (collection === "")        throw new UpStateError("'collection' value has to be be a String", "MISSING_ARG");
        if (typeof collection !== "string") throw new UpStateError("'collection' value has to be be a String", "INVALID_ARG");
        if (!(collection in this.#state)) return new Result(null);
        if (!route) return new Result(this.#cloneValue(this.#state[collection], this.#cloningOptions.onGet));

        const { targetParent, targetKey } = Utility.getPathInfo(collection, route, this.#state);
        const outputValue = targetParent?.[targetKey];
        const output = (typeof outputValue === 'object' && outputValue !== null)
            ? this.#cloneValue(outputValue, this.#cloningOptions.onGet)
            : outputValue;

        return new Result(output);
    }

    /**
     * Deletes a value from state.
     *
     * If `route` is omitted the *entire collection* is deleted.
     * If `route` is provided only the value at that nested path is deleted.
     *
     * Fires matching subscriptions and dispatches an `"update"` event after
     * removal.  Also removes the value from both `localStorage` and
     * `sessionStorage`.
     *
     * Supports both positional and object-form arguments.
     *
     * @param {string|Object} collectionOrObject - Collection name, or
     *   `{ collection, route }` options object.
     * @param {string}        [route]            - Dot/slash path within the collection.
     *
     * @fires State#update  `detail: { collection, route, destination, state, action: "remove" }`
     *
     * @example
     * UpState.remove("user");                        // delete entire collection
     * UpState.remove("user", "address.city");        // delete nested key
     * UpState.remove({ collection: "user", route: "address" }); // object form
     */
    remove(collectionOrObject, route) {
        let collection = collectionOrObject;

        if (typeof collectionOrObject === "object" && collectionOrObject !== null) {
            collection = collectionOrObject.collection;
            route = collectionOrObject.route;
        }

        this.#factoryRemove(collection, route);
    }

    /**
     * Internal implementation for `remove()` and `batchRemove()`.
     *
     * @private
     * @param {string}  collection
     * @param {string}  [route]
     * @param {Object}  [opts]
     * @param {boolean} [opts.dispatchUpdateEvent=true]
     * @param {boolean} [opts.fireSubscriptionCallbacks=true]
     */
    #factoryRemove(collection, route, { dispatchUpdateEvent = true, fireSubscriptionCallbacks = true } = {}) {
        fireSubscriptionCallbacks = !!fireSubscriptionCallbacks;

        if (collection === undefined || collection === "") throw new UpStateError("'collection' value has to be be a String", "MISSING_ARG");
        if (typeof collection !== "string")               throw new UpStateError("'collection' value has to be be a String", "INVALID_ARG");

        const destination = {};

        if (!route) {
            destination.targetParent = this.#state;
            destination.targetKey = collection;
            delete this.#state[collection];

            this.#splitRouteCache.delete(collection);
            if (fireSubscriptionCallbacks) this.#fireSubscriptionCallbacks(collection);
        } else {
            const { targetParent, targetKey } = Utility.getPathInfo(collection, route, this.#state, false);
            destination.targetParent = targetParent;
            destination.targetKey = targetKey;

            if (targetParent && targetKey in targetParent) {
                delete targetParent[targetKey];

                if (this.#splitRouteCache.has(collection)) {
                    this.#splitRouteCache.get(collection).delete(route);
                }

                if (fireSubscriptionCallbacks) this.#fireSubscriptionCallbacks(collection, route);
            }
        }

        storageHandlerInstance.remove(collection, route);

        if (dispatchUpdateEvent && this.#allowEventDispatches) {
            this.dispatchEvent(new CustomEvent("update", {
                detail: {
                    collection, route, destination,
                    state: destination.targetParent,
                    action: "remove"
                },
                cancelable: true,
            }));
        }

        return destination.targetParent;
    }

    // -----------------------------------------------------------------------
    // Batch operations
    // -----------------------------------------------------------------------

    /**
     * Writes multiple state values atomically with respect to subscription
     * firing.
     *
     * Internally calls `#factorySet` for each item with event dispatch and
     * subscription callbacks *suppressed*, then fires subscriptions once per
     * unique `collection / route` pair and dispatches a single `"update"` event.
     *
     * This is significantly more efficient than calling `set()` in a loop when
     * multiple collections change at once.
     *
     * @param {Array<Object>} arrayOfSetObjects - Array of option objects, each
     *   matching the signature of {@link State#set}.
     *
     * @throws {UpStateError} `INVALID_ARG` if the argument is not an array.
     *
     * @fires State#update `detail: { action: "batchSet", count, routeMap }`
     *
     * @example
     * UpState.batchSet([
     *   { collection: "user",  state: { name: "Alice" } },
     *   { collection: "cart",  state: [],               },
     *   { collection: "flags", route: "darkMode", state: true },
     * ]);
     */
    batchSet(arrayOfSetObjects) {
        if (!Array.isArray(arrayOfSetObjects)) {
            throw new UpStateError("was expecting an array of objects meant for the Upstate.set method", "INVALID_ARG");
        }

        const changedRoutes = new Map(); // collection → Set<route|null>

        arrayOfSetObjects.forEach(setObject => {
            this.#factorySet(setObject, { fireSubscriptionCallbacks: false, dispatchUpdateEvent: false });
            if (!changedRoutes.has(setObject.collection)) changedRoutes.set(setObject.collection, new Set());
            changedRoutes.get(setObject.collection).add(setObject.route || null);
        });

        changedRoutes.forEach((routes, collection) => {
            routes.forEach(route => this.#fireSubscriptionCallbacks(collection, route ?? undefined));
        });

        if (this.#allowEventDispatches) {
            this.dispatchEvent(new CustomEvent("update", {
                detail: { action: "batchSet", count: arrayOfSetObjects.length, routeMap: changedRoutes },
                cancelable: true,
            }));
        }
    }

    /**
     * Reads multiple values from state in one call.
     *
     * Returns a single {@link Result} whose `.raw` value is an object keyed by
     * collection name, where each value is an array of the requested values in
     * the order they were specified.
     *
     * @param {Array<{ collection: string, route?: string }>} arrayOfGetRequests
     *
     * @returns {Result} A `Result` wrapping `{ [collection]: [value, …] }`.
     *
     * @throws {UpStateError} `INVALID_ARG` if the argument is not an array.
     *
     * @example
     * const result = UpState.batchGet([
     *   { collection: "user" },
     *   { collection: "user", route: "address.city" },
     *   { collection: "cart" },
     * ]);
     * // result.raw → { user: [{ name: "Alice" }, "London"], cart: [[]] }
     */
    batchGet(arrayOfGetRequests) {
        if (!Array.isArray(arrayOfGetRequests)) {
            throw new UpStateError("'batchGet' expects an array of objects meant for the 'get' method", "INVALID_ARG");
        }

        const data = {};
        arrayOfGetRequests.forEach(req => {
            if (!data[req.collection]) data[req.collection] = [];
            data[req.collection].push(this.get(req.collection, req.route).raw);
        });

        return new Result(data);
    }

    /**
     * Removes multiple state values atomically with respect to subscription
     * firing.
     *
     * Works analogously to {@link State#batchSet}: individual subscriptions and
     * events are suppressed during deletion, then fired once per affected
     * collection.
     *
     * @param {Array<{ collection: string, route?: string }>} arrayOfRemoveRequests
     *
     * @throws {UpStateError} `INVALID_ARG` if the argument is not an array.
     *
     * @fires State#update `detail: { action: "batchRemove", count, collections }`
     *
     * @example
     * UpState.batchRemove([
     *   { collection: "cart" },
     *   { collection: "user", route: "session.token" },
     * ]);
     */
    batchRemove(arrayOfRemoveRequests) {
        if (!Array.isArray(arrayOfRemoveRequests)) {
            throw new UpStateError("'batchRemove' was expecting an array of objects meant for the 'remove' method", "INVALID_ARG");
        }

        const collections = [];
        arrayOfRemoveRequests.forEach(removeObject => {
            this.#factoryRemove(removeObject.collection, removeObject.route, {
                dispatchUpdateEvent: false,
                fireSubscriptionCallbacks: false
            });
            collections.push(removeObject.collection);
        });

        const collectionSet = [...new Set(collections)];
        collectionSet.forEach(collection => this.#fireSubscriptionCallbacks(collection));

        if (this.#allowEventDispatches) {
            this.dispatchEvent(new CustomEvent("update", {
                detail: { action: "batchRemove", count: arrayOfRemoveRequests.length, collections: collectionSet },
                cancelable: true,
            }));
        }
    }

    // -----------------------------------------------------------------------
    // Emit bus
    // -----------------------------------------------------------------------

    /**
     * Broadcasts a state snapshot to all `onEmit` listeners registered under
     * `name`.
     *
     * The emitted payload can include:
     * - An arbitrary `payload` object for the receiver.
     * - A state snapshot read from `collection` / `route`.
     * - An optional `transform` function applied to the snapshot before
     *   dispatching (useful for reshaping data without mutating state).
     * - A `callback` function the receiver can call to send data back.
     *
     * @param {Object}    options
     * @param {string}    options.name           - Event name to broadcast on.
     * @param {string|number} [options.id]       - Optional identifier (not currently
     *                                             used internally, reserved for consumers).
     * @param {*}         [options.payload]      - Arbitrary data to pass to the listener.
     * @param {string}    [options.collection]   - Collection to snapshot.
     * @param {string}    [options.route]        - Route within the collection.
     * @param {Function}  [options.callback]     - A function receivers can invoke to
     *                                             reply back to the emitter.
     * @param {Function}  [options.transform]    - `(Result) => *` applied to the state
     *                                             snapshot before dispatching.
     *
     * @throws {UpStateError} `MISSING_ARG` if `name` is missing.
     * @throws {UpStateError} `INVALID_ARG` if any argument has an invalid type.
     *
     * @example
     * // Broadcast the current user to all listeners on "userChanged"
     * UpState.emitState({
     *   name: "userChanged",
     *   collection: "user",
     *   transform: (result) => result.raw,
     * });
     */
    emitState({ name, id, payload, collection, route, callback, transform } = {}) {
        if (name === undefined)                                   throw new UpStateError(`'name' is required`, "MISSING_ARG");
        if (typeof name !== "string")                             throw new UpStateError(`'name' can only be a string`, "INVALID_ARG");
        if (id !== undefined && typeof id !== "string" && typeof id !== "number") throw new UpStateError(`'id' can only be a string`, "INVALID_ARG");
        if (typeof callback !== "function" && callback !== undefined)  throw new UpStateError(`'callback' can only be a function`, "INVALID_ARG");
        if (typeof transform !== "function" && transform !== undefined) throw new UpStateError(`'transform' can only be a function`, "INVALID_ARG");

        const data = this.get(collection, route);
        const resolved = transform ? transform(data) : data;

        this.#bus.dispatchEvent(new CustomEvent(name, {
            detail: { payload, data: resolved, callback }
        }));
    }

    /**
     * Registers a listener for `emitState` broadcasts on `name`.
     *
     * Only **one** listener per `name` is allowed at a time.  Call
     * {@link State#killOnEmit} before re-registering.
     *
     * @param {Object}   options
     * @param {string}   options.name     - Event name to listen on.
     * @param {Function} options.callback - `({ payload, data, callback }) => void`.
     *
     * @throws {UpStateError} `MISSING_ARG` if `name` is missing.
     * @throws {UpStateError} `INVALID_ARG` if `name` is already registered, or if
     *   `callback` is not a function.
     *
     * @example
     * UpState.onEmit({
     *   name: "userChanged",
     *   callback: ({ data }) => renderUserBadge(data),
     * });
     */
    onEmit({ name, callback }) {
        if (name === undefined)               throw new UpStateError(`'name' is required`, "MISSING_ARG");
        if (typeof name !== "string")         throw new UpStateError(`'name' can only be a string`, "INVALID_ARG");
        if (this.#killEmitRegistry.has(name)) throw new UpStateError(`there is already an 'onEmit' with this name`, "INVALID_ARG");
        if (typeof callback !== "function")   throw new UpStateError(`'callback' can only be a function`, "INVALID_ARG");

        let abortCont = new AbortController();

        this.#bus.addEventListener(name, event => {
            const detail = event.detail;
            callback({ payload: detail.payload, data: detail.data, callback: detail.callback });
        }, { signal: abortCont.signal });

        this.#killEmitRegistry.set(name, () => {
            if (abortCont) { abortCont.abort(); abortCont = null; }
        });
    }

    /**
     * Removes the `onEmit` listener registered under `name`.
     *
     * @param {string} type - The event name passed to {@link State#onEmit}.
     */
    killOnEmit(type) { this.#kill(type, this.#killEmitRegistry); }

    // -----------------------------------------------------------------------
    // Request / Response bus
    // -----------------------------------------------------------------------

    /**
     * Sends a *typed request* on the internal bus and returns a unique ID that
     * can be used to listen for the response via {@link State#onResponse}.
     *
     * The request bus is designed for **decoupled cross-module communication**:
     * the requester does not need to know which module will fulfil the request.
     *
     * Flow:
     * 1. Caller invokes `request()`, which fires an event on the internal `#bus`.
     * 2. A module listening via `onRequest()` handles the event and eventually
     *    calls `response(uid, data)`.
     * 3. The caller's `onResponse()` (or `callback`) is invoked with the result.
     *
     * If no response arrives within `ttl` seconds the request times out
     * automatically: `onResponse` is called with `{ error: true, payload: null }`.
     *
     * @param {Object}         options
     * @param {string}         options.name           - Request type / channel name.
     * @param {string|number}  [options.id]           - Custom UID.  If omitted a
     *                                                  `crypto.randomUUID()` is used.
     * @param {*}              [options.payload]      - Data to send to the handler.
     * @param {Object}         [options.destination]  - If provided, the resolved response
     *                                                  value is automatically written to
     *                                                  state via `set(destination)`.
     *                                                  Shape: `{ collection, route? }`.
     * @param {Function}       [options.callback]     - Called with the resolved response
     *                                                  value when the response arrives.
     * @param {Function}       [options.transform]    - `(data) => *` applied to the
     *                                                  response before passing to
     *                                                  `callback` / `destination`.
     * @param {number}         [options.ttl=120]      - Time-to-live in seconds.
     *                                                  Defaults to 120.
     *
     * @returns {string} The unique request ID (`uid`).
     *
     * @throws {UpStateError} `MISSING_ARG` if `name` is missing.
     * @throws {UpStateError} `INVALID_ARG` for type errors on any parameter.
     *
     * @example
     * const uid = UpState.request({
     *   name: "fetchUser",
     *   payload: { userId: 42 },
     *   destination: { collection: "user" },
     *   ttl: 30,
     * });
     *
     * UpState.onResponse({
     *   id: uid,
     *   callback: ({ error, payload }) => {
     *     if (!error) console.log("User loaded:", payload);
     *   },
     * });
     */
    request({ name, id, payload, destination, callback, transform, ttl = 120 } = {}) {
        ttl = Number(ttl);
        if (isNaN(ttl))                throw new UpStateError(`'ttl' can only be a number`, "INVALID_ARG");
        ttl = ttl * 1000;
        if (name === undefined)        throw new UpStateError(`'name' is required`, "MISSING_ARG");
        if (typeof name !== "string")  throw new UpStateError(`'name' can only be a string`, "INVALID_ARG");
        if (id !== undefined && typeof id !== "string" && typeof id !== "number") throw new UpStateError(`'id' can only be a string`, "INVALID_ARG");
        if (typeof callback !== "function" && callback !== undefined)  throw new UpStateError(`'callback' can only be a function`, "INVALID_ARG");
        if (typeof transform !== "function" && transform !== undefined) throw new UpStateError(`'transform' can only be a function`, "INVALID_ARG");

        const uid = id ?? crypto.randomUUID();

        this.#ttlTimeout.set(uid, setTimeout(() => {
            this.response(uid, { error: true, payload: null });
            this.#ttlTimeout.delete(uid);
        }, ttl));

        this.#bus.dispatchEvent(new CustomEvent(name, {
            detail: { payload, destination, uid, transform, callback, ttl }
        }));

        return uid;
    }

    /**
     * Registers a handler for a specific request type.
     *
     * Only **one** handler per `name` is allowed at a time.  Call
     * {@link State#killOnRequest} before re-registering.
     *
     * The callback receives `(uid, payload)`:
     * - `uid`     — the unique request ID; pass this to `response(uid, data)`.
     * - `payload` — the data sent by the requester.
     *
     * @param {Object}        options
     * @param {string}        options.name     - Request type to handle.
     * @param {string|number} [options.id]     - Override the UID for special routing.
     * @param {Function}      options.callback - `(uid, payload) => void`.
     *
     * @throws {UpStateError} `MISSING_ARG` if `name` or `callback` is missing.
     * @throws {UpStateError} `INVALID_ARG` if `name` is already registered.
     *
     * @example
     * UpState.onRequest({
     *   name: "fetchUser",
     *   callback: async (uid, payload) => {
     *     const user = await api.getUser(payload.userId);
     *     UpState.response(uid, user);
     *   },
     * });
     */
    onRequest({ name, id, callback }) {
        if (id !== undefined && typeof id !== "string" && typeof id !== "number") throw new UpStateError(`'id' can only be a string`, "INVALID_ARG");
        if (name === undefined)                  throw new UpStateError(`'name' is required`, "MISSING_ARG");
        if (typeof name !== "string")            throw new UpStateError(`'name' can only be a string`, "INVALID_ARG");
        if (this.#killRequestRegistry.has(name)) throw new UpStateError(`there is already an 'onRequest' with this name`, "INVALID_ARG");
        if (callback === undefined)              throw new UpStateError(`'callback' is required`, "INVALID_ARG");
        if (typeof callback !== "function")      throw new UpStateError(`'callback' can only be a function`, "INVALID_ARG");

        let abortCont = new AbortController();

        this.#bus.addEventListener(name, event => {
            const detail = event.detail;
            const uid = id ?? detail.uid;

            const baggage = Object.create(null);
            baggage.uid         = detail.uid;
            baggage.destination = detail.destination;
            baggage.transform   = detail.transform;
            baggage.callback    = detail.callback;

            this.#requestDetailCache.set(uid, baggage);
            callback(uid, detail.payload);
        }, { signal: abortCont.signal });

        this.#killRequestRegistry.set(name, () => {
            if (abortCont) { abortCont.abort(); abortCont = null; }
        });
    }

    /**
     * Resolves a pending request with `data`.
     *
     * Must be called by the `onRequest` handler once it has a result.
     * This method:
     * 1. Optionally applies `transform` to `data`.
     * 2. Calls the requester's `callback` (if any).
     * 3. Writes the result to `destination` in state (if any).
     * 4. Clears the TTL timeout for this request.
     * 5. Dispatches the response event so `onResponse` listeners fire.
     *
     * Supports both positional `(id, data)` and object-form
     * `({ id, data })` calls.
     *
     * @param {string|Object} idOrObject - Request UID, or `{ id, data }` object.
     * @param {*}             [data]     - The response data (positional form).
     *
     * @throws {UpStateError} `INVALID_ARG` if `id` is not found in the pending
     *   request cache (i.e. already resolved, timed out, or unknown).
     *
     * @example
     * UpState.onRequest({
     *   name: "getCount",
     *   callback: (uid) => {
     *     UpState.response(uid, 42);
     *     // or: UpState.response({ id: uid, data: 42 });
     *   },
     * });
     */
    response(idOrObject, data) {
        let id = idOrObject;

        if (typeof idOrObject === "object" && idOrObject !== null) {
            id = idOrObject.id;
            data = idOrObject.data;
        }

        if (!this.#requestDetailCache.has(id)) {
            throw new UpStateError(
                `'id' should be set to the first parameter of the onRequest callback`,
                "INVALID_ARG"
            );
        }

        const baggage = this.#requestDetailCache.get(id);
        const resolved = baggage.transform ? baggage.transform(data) : data;

        if (baggage.callback)    baggage.callback(resolved);
        if (baggage.destination) this.set({ ...baggage.destination, state: resolved });

        this.#requestDetailCache.delete(id);

        clearTimeout(this.#ttlTimeout.get(id));
        this.#ttlTimeout.delete(id);

        this.#bus.dispatchEvent(new CustomEvent(baggage.uid, {
            detail: { payload: resolved }
        }));
    }

    /**
     * Listens for the response to a specific request by its UID.
     *
     * By default the listener removes itself after one invocation (`once: true`).
     * Set `once: false` to keep it alive (useful for streaming or long-polling
     * patterns).
     *
     * @param {Object}        options
     * @param {string|number} options.id              - The UID returned by `request()`.
     * @param {Function}      options.callback        - `({ error, payload }) => void`.
     *                                                  `error` is `true` on TTL timeout.
     * @param {boolean}       [options.once=true]     - Auto-remove after first invocation.
     * @param {AbortController} [options.abortController] - External abort signal for
     *                                                  manual cleanup.
     *
     * @throws {UpStateError} `INVALID_ARG` for type errors or duplicate IDs.
     *
     * @example
     * const uid = UpState.request({ name: "loadData", payload: { page: 1 } });
     *
     * UpState.onResponse({
     *   id: uid,
     *   callback: ({ error, payload }) => {
     *     if (error) return console.error("Request timed out");
     *     renderData(payload);
     *   },
     * });
     */
    onResponse({ id, once, abortController, callback }) {
        const options = {};
        options.once = once ? !!once : true;

        if (abortController !== undefined && !(abortController instanceof AbortController)) throw new UpStateError(`invalid abortSignal`, "INVALID_ARG");
        if (id === undefined)                   throw new UpStateError(`'id' is required`, "INVALID_ARG");
        if (typeof id !== "string" && typeof id !== "number") throw new UpStateError(`'id' can only be a string`, "INVALID_ARG");
        if (this.#killResponseRegistry.has(id)) throw new UpStateError(`there is already an 'onResponse' with this name`, "INVALID_ARG");
        if (typeof callback !== "function")     throw new UpStateError(`'callback' can only be a function`, "INVALID_ARG");

        abortController = abortController ?? new AbortController();
        options.signal = abortController.signal;

        this.#bus.addEventListener(id, event => {
            callback({ error: false, payload: event.detail.payload });
            if (options.once) { this.killOnResponse(id); }
            clearTimeout(this.#ttlTimeout.get(id));
            this.#ttlTimeout.delete(id);
        }, options);

        this.#killResponseRegistry.set(id, () => {
            if (abortController) { abortController.abort(); abortController = null; }
        });
    }

    // -----------------------------------------------------------------------
    // Kill helpers
    // -----------------------------------------------------------------------

    /**
     * Generic internal cleanup helper.  Calls and then deletes the abort
     * function stored at `name` in `where`.
     *
     * @private
     * @param {string} name  - Key to look up in the registry.
     * @param {Map}    where - The registry Map to clean up from.
     * @throws {UpStateError} `MISSING_ARG` / `INVALID_ARG` for bad arguments.
     */
    #kill(name, where) {
        if (name === undefined)        throw new UpStateError(`'name' is required`, "MISSING_ARG");
        if (typeof name !== "string")  throw new UpStateError(`'name' can only be a string`, "INVALID_ARG");
        if (where.has(name)) { where.get(name)(); where.delete(name); }
    }

    /**
     * Removes the `onRequest` handler registered under `name`.
     *
     * @param {string} type - The name passed to {@link State#onRequest}.
     */
    killOnRequest(type) { this.#kill(type, this.#killRequestRegistry); }

    /**
     * Removes the `onResponse` listener registered for request `id`.
     *
     * @param {string} id - The UID returned by {@link State#request}.
     */
    killOnResponse(id) { this.#kill(id, this.#killResponseRegistry); }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

/**
 * The shared UpState singleton.  This is the default import and covers the
 * vast majority of use-cases.  The instance is frozen so its shape cannot be
 * accidentally mutated.
 *
 * @type {State}
 *
 * @example
 * import UpState from './upstate.js';
 *
 * UpState.set({ collection: "app", state: { ready: true } });
 * console.log(UpState.get("app").raw); // { ready: true }
 */
const UpState = new State();
Object.freeze(UpState);

export { State };
export default UpState;
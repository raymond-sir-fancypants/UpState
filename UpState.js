"use strict";
// UpState version 4.0.0

/**
 * @fileoverview UpState — A lightweight, framework-agnostic client-side state manager.
 * Supports deep/shallow/off cloning, session and permanent persistence,
 * reactive subscriptions with bidirectional route propagation, and batch operations.
 *
 * @version 4.0.0
 * @license MIT
 *
 * @example
 * import UpState from './upstate.js';
 *
 * UpState.config({ cloning: 'deep' });
 *
 * UpState.set({ collection: 'user', state: { name: 'Alice' } });
 * UpState.get('user').raw; // { name: 'Alice' }
 */

class Utility {

    /**
     * Parses a JSON string and automatically revives ISO 8601 date strings into Date objects.
     * Falls back gracefully on malformed input.
     * @param {string} jsonString - The JSON string to parse.
     * @returns {object} The parsed object, or {} on failure.
     */
    static JSONHydrator(jsonString) {
        if (!jsonString) return {};

        const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[-+]\d{2}:\d{2})?$/;

        try {
            return JSON.parse(jsonString, (key, value) => {
                if (typeof value === 'string' && isoDateRegex.test(value)) {
                    const potentialDate = new Date(value);
                    return !isNaN(potentialDate.getTime()) ? potentialDate : value;
                }
                return value;
            });
        } catch (e) {
            try {
                return JSON.parse(jsonString);
            } catch {
                return {};
            }
        }
    }

    /**
     * Recursively merges two objects or arrays. Arrays are concatenated.
     * Objects are merged deeply. Primitive source values overwrite target values.
     * @param {*} target - The base value.
     * @param {*} source - The value to merge in.
     * @returns {*} The merged result.
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
     * Traverses a dot/slash-separated route within a state object and returns
     * the parent container and final key at the target path.
     *
     * In read mode (`write = false`), returns a safe empty object if the path is broken.
     * In write mode (`write = true`), creates missing path segments automatically.
     *
     * @param {string} collection - The top-level collection key.
     * @param {string} route - A dot or slash separated path e.g. `"user.profile.name"`.
     * @param {object} state - The state object to traverse.
     * @param {boolean} [write=false] - Whether to create missing path segments.
     * @returns {{ targetParent: object, targetKey: string }}
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
     * Deep clones an object using `structuredClone`, with a manual fallback
     * that strips functions and non-serialisable references.
     *
     * State should be plain data. If `structuredClone` fails the fallback
     * silently removes non-cloneable values (functions, window references, etc.).
     *
     * @param {*} object - The value to clone.
     * @param {WeakMap} [seen=new WeakMap()] - Used internally to handle circular references.
     * @returns {*} A deep clone of the input.
     */
    static clone(object, seen = new WeakMap()) {
        if (!object || typeof object !== "object") return object;

        if (seen.has(object)) return seen.get(object);

        try {
            return structuredClone(object);
        } catch (err) {
            if (Array.isArray(object)) {
                const newArr = [];
                seen.set(object, newArr);
                object.forEach((item, index) => { newArr[index] = this.clone(item, seen); });
                return newArr;
            }

            const newObj = {};
            seen.set(object, newObj);

            for (const key in object) {
                if (Object.prototype.hasOwnProperty.call(object, key)) {
                    const val = object[key];
                    if (typeof val !== 'function' && (typeof window === "undefined" || val !== window)) {
                        newObj[key] = this.clone(val, seen);
                    }
                }
            }
            return newObj;
        }
    }
}

/**
 * Custom error class for UpState. Includes a `code` property for programmatic
 * error handling.
 *
 * @extends Error
 *
 * @example
 * try {
 *   UpState.set({ collection: '', state: 1 });
 * } catch (e) {
 *   if (e instanceof UpStateError) {
 *     console.log(e.code); // "MISSING_COLLECTION_REF"
 *   }
 * }
 */
class UpStateError extends Error {
    /**
     * @param {string} message - Human-readable error description.
     * @param {string} [code="GENERAL_ERROR"] - Machine-readable error code.
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

/**
 * Immutable wrapper returned by all `get` operations and subscription callbacks.
 * Provides safe accessors to handle null/undefined data without defensive checks.
 *
 * @example
 * const result = UpState.get('user');
 * result.raw;               // { name: 'Alice' } or null
 * result.asArray;           // [{ name: 'Alice' }] or []
 * result.asObject;          // { name: 'Alice' } or {}
 * result.mapArray(v => v);  // mapped array
 * result.mapObject(v => v); // mapped object
 */
class Result {

    #data;

    /**
     * @param {*} input - The raw value to wrap. `undefined` and `null` are normalised to `null`.
     */
    constructor(input) {
        this.#data = (input === undefined || input === null) ? null : input;
        Object.freeze(this);
    }

    /**
     * The raw underlying value. Returns `null` if no data was found.
     * @type {*}
     */
    get raw() { return this.#data; }

    /**
     * Returns the data as an array.
     * - Arrays are returned as-is.
     * - Plain objects are converted to their values array.
     * - Primitives are wrapped in a single-element array.
     * - `null` returns `[]`.
     * @type {Array}
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
     * Returns the data as a plain object.
     * - Plain objects are returned as-is.
     * - Arrays are converted to index-keyed objects `{ 0: ..., 1: ... }`.
     * - Primitives are wrapped as `{ 0: value }`.
     * - `null` returns `{}`.
     * @type {object}
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
     * Maps over the data as an array, returning a new array.
     * Null callback return values are coerced to `null`.
     * @param {function(*, number): *} callback - Receives `(value, index)`.
     * @returns {Array}
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
     * Maps over the data as an object, returning a new object with the same keys.
     * Null callback return values are coerced to `null`.
     * @param {function(*, string): *} callback - Receives `(value, key)`.
     * @returns {object}
     */
    mapObject(callback) {
        const currentMap = this.asObject;
        const keys = Object.keys(currentMap);
        const newMap = {};
        for (let i = 0; i < keys.length; i++) {
            newMap[keys[i]] = callback(currentMap[keys[i]], keys[i]) ?? null;
        }
        return newMap;
    }
}

/**
 * Internal handler for localStorage and sessionStorage.
 * Maintains an in-memory `virtualLocalStorage` mirror to avoid redundant
 * JSON parsing on every write.
 * @private
 */
class StorageHandler {

    constructor() {
        const sessionRaw = sessionStorage.getItem("UpState") || "{}";
        let sessionParsed;
        try { sessionParsed = Utility.JSONHydrator(sessionRaw); }
        catch { sessionParsed = {}; }

        const permanentRaw = localStorage.getItem("UpState") || "{}";
        let permanentParsed;
        try { permanentParsed = Utility.JSONHydrator(permanentRaw); }
        catch { permanentParsed = {}; }

        this.virtualLocalStorage = { session: sessionParsed, permanent: permanentParsed };
    }

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

const storageHandlerInstance = new StorageHandler();

/**
 * The core UpState class. Exported as a frozen singleton `UpState`.
 * Extends `EventTarget` — listen to the `"update"` event for all state changes.
 *
 * @extends EventTarget
 * @hideconstructor
 */
class State extends EventTarget {

    #state = Object.create(null);
    #persistentCollections = new Map();
    #allowEventDispatches = true;
    #subscriptions = { collections: {}, callbacks: {} };
    #unsubCallbacks = {};
    #silenceWarnings = false;
    #cloningOptions = { onSet: "deep", onGet: "deep", onSubscribe: "deep" };

    constructor() {
        super();
        this.#state = Utility.deepMerge(
            storageHandlerInstance.virtualLocalStorage.permanent,
            storageHandlerInstance.virtualLocalStorage.session,
        );
    }

    /**
     * Configures UpState behaviour. Recommended to call before any other operations.
     *
     * @param {object} options
     *
     * @param {object} [options.persistentCollections={}]
     *   Plain object mapping collection names to their persistence type.
     *   - `"session"` — survives page refresh, cleared when the tab closes (sessionStorage).
     *   - `"permanent"` — survives tab close (localStorage).
     *   @example { user: "session", settings: "permanent" }
     *
     * @param {boolean} [options.allowEventDispatches=true]
     *   Whether to dispatch `"update"` CustomEvents on state changes.
     *
     * @param {boolean} [options.silenceWarnings=false]
     *   Suppresses internal console warnings.
     *
     * @param {"deep"|"shallow"|"off"|{onSet?: string, onGet?: string, onSubscribe?: string}} [options.cloning="deep"]
     *   Controls how values are cloned on set, get, and subscribe callbacks.
     *   Pass a string to apply one mode globally, or an object for per-operation control:
     *   - `"deep"` — full structural clone via `structuredClone` (safest, default).
     *   - `"shallow"` — top-level spread only (`{ ...obj }` / `[...arr]`).
     *   - `"off"` — no cloning. Maximum performance; consumers share the internal reference.
     *   @example { onSet: "deep", onGet: "shallow", onSubscribe: "off" }
     *
     * @throws {UpStateError} MISSING_CONFIG_ERR — if `persistentCollections` is an array or invalid.
     * @throws {UpStateError} MISSING_CONFIG_ERR — if `cloning` contains an unrecognised value.
     *
     * @example
     * UpState.config({
     *   persistentCollections: { user: 'session', settings: 'permanent' },
     *   cloning: 'deep',
     *   allowEventDispatches: true
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
            } else throw new UpStateError(
                "'cloning' values can only either be 'deep', 'shallow' or 'off'",
                "MISSING_CONFIG_ERR"
            );
        } else {
            for (const key in this.#cloningOptions) {
                if (cloning[key] !== undefined) {
                    if (!optionMap.has(cloning[key])) {
                        throw new UpStateError(
                            "'cloning' values can only either be 'deep', 'shallow' or 'off'",
                            "MISSING_CONFIG_ERR"
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
        } else throw new UpStateError(
            "'persistentCollections' value has to be an object mapping 'collection' to 'persistence' type",
            "MISSING_CONFIG_ERR"
        );
    }

    /**
     * Writes a value to a collection, optionally at a nested route.
     *
     * Routes use dot or slash notation: `"user.profile.name"` or `"user/profile/name"`.
     * Missing path segments are created automatically.
     *
     * By default (cloning: "deep") the input is deep-cloned before storage —
     * mutating the original object after calling `set` will not affect stored state.
     *
     * @param {object} setObject
     * @param {string} setObject.collection - The top-level collection name.
     * @param {*} setObject.state - The value to store. Any type except `undefined`.
     * @param {string} [setObject.route] - Dot/slash path to a nested property.
     * @param {"session"|"permanent"} [setObject.persistence]
     *   Persists this value to browser storage. Overrides collection-level config.
     *
     * @throws {UpStateError} MISSING_COLLECTION_REF — if `collection` is empty or missing.
     * @throws {UpStateError} INVALID_COLLECTION_REF — if `collection` is not a string.
     * @throws {UpStateError} INVALID_STATE_VALUE — if `state` is `undefined`.
     * @throws {UpStateError} INVALID_PERSISTENCE_VALUE — if `persistence` is an unrecognised string.
     *
     * @example
     * // Set an entire collection
     * UpState.set({ collection: 'user', state: { name: 'Alice', age: 30 } });
     *
     * // Set a nested property
     * UpState.set({ collection: 'user', route: 'profile.name', state: 'Alice' });
     *
     * // Set with explicit persistence
     * UpState.set({ collection: 'auth', state: { token: 'abc' }, persistence: 'session' });
     *
     * // Falsy values are valid
     * UpState.set({ collection: 'flags', state: false });
     * UpState.set({ collection: 'count', state: 0 });
     */
    set(setObject = {}) { this.#factorySet(setObject); }

    /**
     * Reads a value from a collection, optionally at a nested route.
     * Always returns a {@link Result} — never throws on missing keys.
     *
     * @param {string} [collection] - The collection to read. Omit to get the entire state tree.
     * @param {string} [route] - Dot/slash path to a nested property.
     * @returns {Result}
     *
     * @throws {UpStateError} MISSING_COLLECTION_REF — if `collection` is an empty string.
     * @throws {UpStateError} INVALID_COLLECTION_REF — if `collection` is not a string.
     *
     * @example
     * UpState.get('user').raw;                  // { name: 'Alice' } or null
     * UpState.get('user', 'profile.name').raw;  // 'Alice' or null
     * UpState.get('nonExistent').raw;           // null
     * UpState.get('user').asArray;              // [{ name: 'Alice' }]
     * UpState.get().raw;                        // entire state object
     */
    get(collection, route) {
        if (collection === undefined) return new Result(this.#cloneValue(this.#state, this.#cloningOptions.onGet));

        if (collection === "") throw new UpStateError("'collection' value has to be a String", "MISSING_COLLECTION_REF");
        if (typeof collection !== "string") throw new UpStateError("'collection' value has to be a String", "INVALID_COLLECTION_REF");
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
     * Removes a collection or a specific nested property from state and all storage.
     *
     * @param {string} collection - The collection to remove from.
     * @param {string} [route] - Dot/slash path. Omit to remove the entire collection.
     *
     * @throws {UpStateError} MISSING_COLLECTION_REF — if `collection` is empty or missing.
     * @throws {UpStateError} INVALID_COLLECTION_REF — if `collection` is not a string.
     *
     * @example
     * UpState.remove('user', 'profile.name'); // removes just the name property
     * UpState.remove('user');                 // removes the entire user collection
     */
    remove(collection, route) { this.#factoryRemove(collection, route); }

    /**
     * Subscribes to state changes on a collection or a specific nested route.
     *
     * **Bidirectional propagation:** the callback fires when the subscribed path changes
     * directly, when a parent path is updated, or when a child path changes.
     * The callback always receives the current value **at the subscribed route**,
     * regardless of where the change originated.
     *
     * If the subscribed value is removed, the callback receives `Result` with `.raw === null`.
     *
     * @param {object} options
     * @param {string} options.collection - The collection to watch.
     * @param {string} [options.route] - Dot/slash path. Omit to watch the entire collection.
     * @param {function(Result): void} options.callback
     *   Called with a {@link Result} wrapping the current value at the subscribed path.
     * @param {string} [options.unsubscribeKey]
     *   A named string key enabling unsubscription via {@link unsubscribe}.
     *
     * @returns {function} An unsubscribe function. Call it to remove this subscription.
     *
     * @throws {UpStateError} MISSING_COLLECTION_REF — if `collection` is empty or missing.
     * @throws {UpStateError} INVALID_COLLECTION_REF — if `collection` is not a string.
     * @throws {UpStateError} MISSING_SUB_CALLBACK_REF — if `callback` is missing.
     * @throws {UpStateError} INVALID_SUB_CALLBACK — if `callback` is not a function.
     * @throws {UpStateError} INVALID_UNSUB_KEY — if `unsubscribeKey` is provided but not a string.
     *
     * @example
     * // Basic collection subscription
     * const unsub = UpState.subscribe({
     *   collection: 'user',
     *   callback: (result) => console.log(result.raw)
     * });
     * unsub(); // stop listening
     *
     * // Route-level subscription
     * UpState.subscribe({
     *   collection: 'user',
     *   route: 'profile.name',
     *   callback: (result) => console.log('Name changed to:', result.raw)
     * });
     *
     * // Named key for later unsubscription
     * UpState.subscribe({
     *   collection: 'user',
     *   callback: (result) => console.log(result.raw),
     *   unsubscribeKey: 'userWatcher'
     * });
     * UpState.unsubscribe('userWatcher');
     */
    subscribe({ collection, route, callback, unsubscribeKey } = {}) {
        if (collection === undefined || collection === "") {
            throw new UpStateError("'collection' name is required", "MISSING_COLLECTION_REF");
        }
        if (typeof collection !== "string") {
            throw new UpStateError("'collection' value has to be a String", "INVALID_COLLECTION_REF");
        }
        if (callback === undefined) {
            throw new UpStateError("'subscription' callback is required", "MISSING_SUB_CALLBACK_REF");
        }
        if (typeof callback !== "function") {
            throw new UpStateError("'subscription' callback has to be a function", "INVALID_SUB_CALLBACK");
        }
        if (typeof unsubscribeKey !== "string" && unsubscribeKey !== undefined) {
            throw new UpStateError("'unsubscribeKey' value has to be a string", "INVALID_UNSUB_KEY");
        }

        route = route ?? "fireOnEntireCollection";

        if (this.#subscriptions.collections[collection] === undefined)
            this.#subscriptions.collections[collection] = new Map();

        const splitRoute = route.split(/[./]/) || [];
        this.#subscriptions.collections[collection].set(route, splitRoute);

        if (this.#subscriptions.callbacks[collection] === undefined)
            this.#subscriptions.callbacks[collection] = {};

        if (!this.#subscriptions.callbacks[collection][route]) {
            this.#subscriptions.callbacks[collection][route] = [];
        }
        this.#subscriptions.callbacks[collection][route].push(callback);

        const unsub = () => {
            const cbs = this.#subscriptions.callbacks[collection]?.[route];
            if (!cbs) return;

            this.#subscriptions.callbacks[collection][route] = cbs.filter(fn => fn !== callback);

            if (this.#subscriptions.callbacks[collection][route].length === 0) {
                this.#subscriptions.collections[collection]?.delete(route);
            }

            if (unsubscribeKey) delete this.#unsubCallbacks[unsubscribeKey];
        };

        if (unsubscribeKey) this.#unsubCallbacks[unsubscribeKey] = unsub;

        return unsub;
    }

    /**
     * Registers multiple subscriptions in a single call.
     * Returns an array of unsubscribe functions in the same order as the input.
     *
     * @param {Array<object>} arrayOfSubscriptionObjects - Array of objects accepted by {@link subscribe}.
     * @returns {function[]} Array of unsubscribe functions.
     *
     * @throws {UpStateError} INVALID_BATCH_SUB_ARGUMENT — if the argument is not an array.
     *
     * @example
     * const [unsubUser, unsubTheme] = UpState.batchSubscriptions([
     *   { collection: 'user', callback: (r) => console.log('user:', r.raw) },
     *   { collection: 'settings', route: 'theme', callback: (r) => console.log('theme:', r.raw) }
     * ]);
     * unsubUser();
     * unsubTheme();
     */
    batchSubscriptions(arrayOfSubscriptionObjects) {
        if (!Array.isArray(arrayOfSubscriptionObjects)) {
            throw new UpStateError(
                "'batchSubscriptions' was expecting an array of objects meant for the subscribe method",
                "INVALID_BATCH_SUB_ARGUMENT"
            );
        }
        return arrayOfSubscriptionObjects.map(obj => this.subscribe(obj));
    }

    /**
     * Unsubscribes one or more named subscriptions registered with `unsubscribeKey`.
     *
     * @param {string|string[]} keys - A key or array of keys to unsubscribe.
     *
     * @throws {UpStateError} INVALID_UNSUB_KEY — if a key is not a string or does not exist.
     *
     * @example
     * UpState.unsubscribe('userWatcher');
     * UpState.unsubscribe(['userWatcher', 'settingsWatcher']);
     */
    unsubscribe(keys) {
        const unsubFunc = (key) => {
            if (typeof key !== "string" && key !== undefined) {
                throw new UpStateError("'unsubscribeKey' value has to be a string", "INVALID_UNSUB_KEY");
            }
            if (typeof key !== "string" || !this.#unsubCallbacks[key]) {
                throw new UpStateError(`no subscription found for key "${key}"`, "INVALID_UNSUB_KEY");
            }
            this.#unsubCallbacks[key]();
        };

        if (Array.isArray(keys)) {
            keys.forEach(key => unsubFunc(key));
        } else {
            unsubFunc(keys);
        }
    }

    /**
     * Performs multiple `set` operations in a single batch.
     * Subscription callbacks fire once per unique changed route after all sets complete.
     * A single `"update"` event is dispatched when done.
     *
     * @param {Array<object>} arrayOfSetObjects - Array of objects accepted by {@link set}.
     *
     * @throws {UpStateError} INVALID_BATCH_SET_ARGUMENT — if the argument is not an array.
     *
     * @example
     * UpState.batchSet([
     *   { collection: 'user', route: 'name', state: 'Alice' },
     *   { collection: 'user', route: 'age', state: 30 },
     *   { collection: 'settings', state: { theme: 'dark' } }
     * ]);
     */
    batchSet(arrayOfSetObjects) {
        if (!Array.isArray(arrayOfSetObjects)) {
            throw new UpStateError(
                "was expecting an array of objects meant for the UpState.set method",
                "INVALID_BATCH_SET_ARGUMENT"
            );
        }

        const changedRoutes = new Map();

        arrayOfSetObjects.forEach(setObject => {
            this.#factorySet(setObject, { fireSubscriptionCallbacks: false, dispatchUpdateEvent: false });

            if (!changedRoutes.has(setObject.collection)) changedRoutes.set(setObject.collection, new Set());
            changedRoutes.get(setObject.collection).add(setObject.route || "fireOnEntireCollection");
        });

        changedRoutes.forEach((routes, collection) => {
            routes.forEach(route => {
                if (route) this.#fireSubscriptionCallbacks(collection, route);
            });
        });

        if (this.#allowEventDispatches) {
            this.dispatchEvent(new CustomEvent("update", {
                detail: { action: "batchSet", count: arrayOfSetObjects.length, routeMap: changedRoutes },
                cancelable: true,
            }));
        }
    }

    /**
     * Retrieves multiple values in a single call.
     * Returns a {@link Result} wrapping a plain object keyed by collection,
     * each containing an array of retrieved values in request order.
     *
     * @param {Array<{collection: string, route?: string}>} arrayOfGetRequests
     * @returns {Result}
     *
     * @throws {UpStateError} INVALID_BATCH_GET_ARGUMENT — if the argument is not an array.
     *
     * @example
     * const result = UpState.batchGet([
     *   { collection: 'user', route: 'name' },
     *   { collection: 'user', route: 'age' },
     *   { collection: 'settings' }
     * ]);
     * result.raw; // { user: ['Alice', 30], settings: [{ theme: 'dark' }] }
     */
    batchGet(arrayOfGetRequests) {
        if (!Array.isArray(arrayOfGetRequests)) {
            throw new UpStateError(
                "'batchGet' expects an array of objects meant for the 'get' method",
                "INVALID_BATCH_GET_ARGUMENT"
            );
        }

        const data = {};

        arrayOfGetRequests.forEach(req => {
            if (!data[req.collection]) data[req.collection] = [];
            data[req.collection].push(this.get(req.collection, req.route).raw);
        });

        return new Result(data);
    }

    /**
     * Removes multiple collections or nested properties in a single batch.
     * Subscription callbacks fire once per unique collection after all removals.
     * A single `"update"` event is dispatched when done.
     *
     * @param {Array<{collection: string, route?: string}>} arrayOfRemoveRequests
     *
     * @throws {UpStateError} INVALID_BATCH_REMOVE_ARGUMENT — if the argument is not an array.
     *
     * @example
     * UpState.batchRemove([
     *   { collection: 'user', route: 'token' },
     *   { collection: 'cache' }
     * ]);
     */
    batchRemove(arrayOfRemoveRequests) {
        if (!Array.isArray(arrayOfRemoveRequests)) {
            throw new UpStateError(
                "'batchRemove' was expecting an array of objects meant for the 'remove' method",
                "INVALID_BATCH_REMOVE_ARGUMENT"
            );
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

    // ─── Private ─────────────────────────────────────────────────────────────

    /** @private */
    #cloneValue(value, mode) {
        if (!value || typeof value !== "object") return value;
        switch (mode) {
            case "off": return value;
            case "shallow": return Array.isArray(value) ? [...value] : { ...value };
            default: return Utility.clone(value);
        }
    }

    /** @private */
    #fireSubscriptionCallbacks(collection, changedPath, skipCollectionLevel = false) {
        const subs = this.#subscriptions.collections[collection];
        if (!subs) return;

        const route = changedPath?.split(/[./]/) || [];

        for (const [key, value] of subs) {
            const subRoute = value || [];
            const shorter = Math.min(route.length, subRoute.length);
            let compare = true;

            for (let i = 0; i < shorter; i++) {
                if (route[i] !== subRoute[i]) { compare = false; break; }
            }

            if (key === "fireOnEntireCollection") {
                if (skipCollectionLevel) continue;
                const cbs = this.#subscriptions.callbacks[collection][key];
                if (Array.isArray(cbs)) {
                    cbs.forEach(cb => {
                        if (typeof cb === 'function') {
                            cb(new Result(this.#cloneValue(this.#state[collection], this.#cloningOptions.onSubscribe)));
                        }
                    });
                }
            } else if (compare) {
                const destination = Utility.getPathInfo(collection, key, this.#state, false);
                const actualValue = destination?.targetParent?.[destination.targetKey];
                const cbs = this.#subscriptions.callbacks[collection][key];
                if (Array.isArray(cbs)) {
                    cbs.forEach(cb => {
                        if (typeof cb === 'function') {
                            cb(new Result(this.#cloneValue(actualValue, this.#cloningOptions.onSubscribe)));
                        }
                    });
                }
            }
        }
    }

    /** @private */
    #factorySet({ collection, state, route, persistence }, { fireSubscriptionCallbacks = true, dispatchUpdateEvent = true } = {}) {
        fireSubscriptionCallbacks = !!fireSubscriptionCallbacks;

        if (collection === undefined || collection === "") throw new UpStateError("'collection' value has to be a String", "MISSING_COLLECTION_REF");
        if (typeof collection !== "string") throw new UpStateError("'collection' can only be a String", "INVALID_COLLECTION_REF");
        if (state === undefined) throw new UpStateError("state value cannot be undefined", "INVALID_STATE_VALUE");

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
            throw new UpStateError("'persistence' can only be a string", "INVALID_PERSISTENCE_VALUE");
        }

        persistence = persistence ?? this.#persistentCollections.get(collection);

        if (persistence) {
            const pv = String(persistence).toLowerCase();
            if (pv === "permanent" || pv === "session") {
                storageHandlerInstance.set({ collection, state, route, persistence });
            } else {
                throw new UpStateError("'persistence' value can only be either 'session' or 'permanent'", "INVALID_PERSISTENCE_VALUE");
            }
        }

        if (dispatchUpdateEvent && this.#allowEventDispatches) {
            this.dispatchEvent(new CustomEvent("update", {
                detail: { collection, route, destination, state, action: "set" },
                cancelable: true,
            }));
        }
    }

    /** @private */
    #factoryRemove(collection, route, { dispatchUpdateEvent = true, fireSubscriptionCallbacks = true } = {}) {
        fireSubscriptionCallbacks = !!fireSubscriptionCallbacks;

        if (collection === undefined || collection === "") throw new UpStateError("'collection' value has to be a String", "MISSING_COLLECTION_REF");
        if (typeof collection !== "string") throw new UpStateError("'collection' value has to be a String", "INVALID_COLLECTION_REF");

        const destination = {};

        if (!route) {
            destination.targetParent = this.#state;
            destination.targetKey = collection;
            delete this.#state[collection];
            if (fireSubscriptionCallbacks) this.#fireSubscriptionCallbacks(collection);
        } else {
            const { targetParent, targetKey } = Utility.getPathInfo(collection, route, this.#state, false);
            destination.targetParent = targetParent;
            destination.targetKey = targetKey;
            if (targetParent && targetKey in targetParent) {
                delete targetParent[targetKey];
                if (fireSubscriptionCallbacks) this.#fireSubscriptionCallbacks(collection, route);
            }
        }

        storageHandlerInstance.remove(collection, route);

        if (dispatchUpdateEvent && this.#allowEventDispatches) {
            this.dispatchEvent(new CustomEvent("update", {
                detail: { collection, route, destination, state: destination.targetParent, action: "remove" },
                cancelable: true,
            }));
        }

        return destination.targetParent;
    }
}

const UpState = new State();
Object.freeze(UpState);
export default UpState;

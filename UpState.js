"use strict";

// UpState version 1.2.0

/**
 * @class Utility
 * @description Internal helper class. Not part of the public API.
 * @private
 */
class Utility {

    /**
     * Parses a JSON string and automatically revives ISO 8601 date strings
     * into native `Date` objects. This ensures that dates stored in
     * `localStorage` or `sessionStorage` are restored as `Date` instances,
     * not plain strings, when UpState loads on page start.
     *
     * Only strings that match the ISO 8601 format
     * (`YYYY-MM-DDTHH:MM:SS...`) are converted. Other date-like strings
     * (e.g. `"April 26, 2026"` or `"04-26-2026"`) are left as-is.
     *
     * If the JSON contains invalid syntax but the date reviver fails,
     * it falls back to a plain `JSON.parse` without revival.
     *
     * @param {string} jsonString - The raw JSON string to parse.
     * @returns {Object} The parsed object, with ISO date strings converted to `Date` instances.
     *   Returns an empty object `{}` if the input is falsy.
     *
     * @example
     * const result = Utility.JSONHydrator('{"created":"2026-04-26T09:15:00.000Z"}');
     * result.created instanceof Date; // true
     *
     * @example
     * // Non-ISO date strings are left alone
     * const result = Utility.JSONHydrator('{"label":"April 26, 2026"}');
     * typeof result.label; // "string"
     */
    static JSONHydrator(jsonString) {
        const raw = jsonString;

        if (!raw) return {};

        try {
            return JSON.parse(raw, (k, v) => {
                // Only revive strings that match the ISO 8601 datetime format
                const isISO = typeof v === 'string' &&
                    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v);
                return isISO ? new Date(v) : v;
            });
        } catch (e) {
            // Fallback: parse without date revival if the reviver throws
            return JSON.parse(raw);
        }
    }

    /**
     * Deeply merges two objects, with `source` values taking priority over
     * `target`. Both inputs are cloned before merging
     * so neither original is mutated.
     *
     * @param {Object} target - The base object.
     * @param {Object} source - The object to merge into the target. Its values take priority.
     * @returns {Object} A new deeply merged object.
     *
     * @example
     * const a = { user: { name: "Alice", age: 30 } };
     * const b = { user: { age: 31, role: "admin" } };
     * Utility.deepMerge(a, b);
     * // { user: { name: "Alice", age: 31, role: "admin" } }
     */
    static deepMerge(target, source) {
        const output = structuredClone(target);
        source = structuredClone(source);

        for (const key in source) {
            if (
                source[key] &&
                typeof source[key] === "object"
            ) {
                // Recursively merge nested objects
                output[key] = this.deepMerge(output[key] || {}, source[key]);
            } else {
                // Primitives: source replaces target
                output[key] = source[key];
            }
        }

        return output;
    }

    /**
     * Traverses the state tree to find the target location for a given route.
     * Returns the parent object and the final key to act upon, so callers
     * can read, write, or delete without re-traversing the tree.
     *
     * When `createPath` is `false`, the traversal operates on a clone of the
     * state, leaving the original untouched (safe for reads). When `true`,
     * it operates directly on the live state, creating missing nodes as it
     * walks (required for writes).
     *
     * @param {string} collection - The top-level state collection name.
     * @param {string} route - Dot or slash separated path (e.g. `"user/profile"` or `"user.profile"`).
     * @param {Object} state - The full state object to traverse.
     * @param {boolean} [createPath=false] - If `true`, mutates `state` directly and
     *   creates missing intermediate objects. If `false`, operates on a clone.
     * @returns {{ targetParent: Object, targetKey: string }}
     */
    static getPathInfo(collection, route, state, createPath = false) {

        if (!createPath) {
            state = structuredClone(state);
        }

        if (!(collection in state)) state[collection] = {};

        const routeArray = route.split(/[./]/); // Split by . or /
        let cursor = state[collection];

        // Walk to the second-to-last segment, creating missing nodes if needed
        for (let i = 0; i < routeArray.length - 1; i++) {
            const part = routeArray[i];
            if (!(part in cursor) || typeof cursor[part] !== 'object') {
                cursor[part] = {};
            }
            cursor = cursor[part];
        }

        return {
            targetParent: cursor,
            targetKey: routeArray[routeArray.length - 1]
        };
    }
}

/**
 * @class UpStateError
 * @extends Error
 * @description Custom error class for UpState. Includes a `code` property for
 * programmatic error handling, so you can distinguish error types without
 * parsing the message string.
 *
 * @example
 * try {
 *   UpState.set({ collection: "", state: "test" });
 * } catch (e) {
 *   if (e.code === "MISSING_COLLECTION_REF") {
 *     console.log("No collection provided");
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
 * @class Result
 * @description Wraps a value returned from a `get` or `batchGet` call.
 * Provides convenience getters and iteration methods to consume data without
 * extra boilerplate. All getters are null-safe — they never throw, even when
 * the underlying value is `null`.
 *
 * Result instances are **immutable**. The wrapped value is stored in a private
 * class field and the instance is frozen on construction — it cannot be
 * modified from outside the class.
 *
 * @example
 * const result = UpState.get("users");
 *
 * result.raw;   // The value as-is (or null)
 * result.list;  // Always an array
 * result.map;   // Always a plain object
 */
class Result {

    /**
     * The wrapped value. Private — access via `.raw`, `.list`, or `.map`.
     * @type {*}
     * @private
     */
    #data;

    /**
     * @param {*} input - The value to wrap. `undefined` and `null` are stored as `null`.
     */
    constructor(input) {
        this.#data = (input === undefined || input === null) ? null : input;
        Object.freeze(this);
    }

    /**
     * The raw unwrapped value. Returns `null` if the value was missing.
     * @type {*}
     */
    get raw() {
        return this.#data;
    }

    /**
     * The value as an array.
     * - If already an array, returns it as-is.
     * - If a plain object, returns its values via `Object.values()`.
     * - If a primitive, wraps it in a single-item array.
     * - If `null`, returns an empty array.
     * @type {Array}
     */
    get list() {
        if (this.#data === null) return [];
        if (Array.isArray(this.#data)) return this.#data;
        if (typeof this.#data === "object" && Object.prototype.toString.call(this.#data) === '[object Object]') {
            return Object.values(this.#data);
        }
        return [this.#data];
    }

    /**
     * The value as a plain object.
     * - If already a plain object, returns it as-is.
     * - If an array, converts to `{ 0: val, 1: val, ... }`.
     * - If a primitive, returns `{ 0: value }`.
     * - If `null`, returns an empty object.
     * @type {Object}
     */
    get map() {
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
     * Iterates over the value as a plain object, calling `callback` for each
     * key-value pair and returning a **new** object with the transformed values.
     * Does not mutate the `Result`. If the callback returns `undefined`, the
     * key is set to `null` in the output.
     *
     * @param {function(key: string, value: *): *} callBack - Called with each `(key, value)` pair.
     * @returns {Object} A new plain object with the transformed values.
     *
     * @example
     * const prices = UpState.get("prices");
     * // raw: { apple: 1.00, banana: 0.50 }
     *
     * const discounted = prices.iterateAsMap((key, value) => value * 0.9);
     * // { apple: 0.9, banana: 0.45 }
     */
    iterateAsMap(callBack) {
        const currentMap = this.map; // Call getter once to avoid repeated access
        const keys = Object.keys(currentMap);
        const newMap = {};

        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const newValue = callBack(key, currentMap[key]);
            newMap[key] = newValue ?? null;
        }
        return newMap;
    }

    /**
     * Iterates over the value as an array, calling `callback` for each item
     * and returning a **new** array with the transformed values.
     * Does not mutate the `Result`. If the callback returns `undefined`, the
     * item is set to `null` in the output.
     *
     * @param {function(index: number, value: *): *} callBack - Called with each `(index, value)` pair.
     * @returns {Array} A new array with the transformed values.
     *
     * @example
     * const tags = UpState.get("tags");
     * // raw: ["js", "css", "html"]
     *
     * const upper = tags.iterateAsList((i, value) => value.toUpperCase());
     * // ["JS", "CSS", "HTML"]
     */
    iterateAsList(callBack) {
        const currentList = this.list; // Cache to avoid repeated getter calls
        const newArray = [];

        for (let i = 0; i < currentList.length; i++) {
            const newValue = callBack(i, currentList[i]);
            newArray.push(newValue ?? null);
        }

        return newArray;
    }
}

/**
 * @class StorageHandler
 * @description Handles reading and writing UpState data to `localStorage`
 * and `sessionStorage`. All state is stored under the single key `"UpState"`
 * to keep browser storage tidy. Not part of the public API.
 * @private
 */
class StorageHandler {

    /**
     * Writes a value to the appropriate storage driver.
     * Reads the existing stored state first and merges the new value in,
     * so unrelated collections are never overwritten.
     *
     * @param {Object} options
     * @param {string} options.collection - The collection name.
     * @param {*} options.state - The value to persist.
     * @param {string} [options.route] - Optional dot/slash path within the collection.
     * @param {"session"|"permanent"} options.persistence - Which storage driver to use.
     *   `"session"` → `sessionStorage`, `"permanent"` → `localStorage`.
     */
    static set({ collection, state, route, persistence }) {
        const driver = (persistence === "session") ? sessionStorage : localStorage;

        let localState;

        try {
            const localStateRaw = driver.getItem("UpState") || "{}";
            localState = JSON.parse(localStateRaw);
        } catch (e) {
            console.warn("UpStorage: Corrupt JSON detected. Resetting storage.");
            localState = {};
        }

        if (!route) {
            localState[collection] = state;
        } else {
            const { targetParent, targetKey } = Utility.getPathInfo(collection, route, localState, true);
            if (targetParent) {
                targetParent[targetKey] = state;
            }
        }

        driver.setItem("UpState", JSON.stringify(localState));
    }

    /**
     * Removes a value from **both** `localStorage` and `sessionStorage`.
     * Both drivers are always cleared because a collection may have moved
     * between them across `config()` calls or per-call persistence overrides.
     *
     * @param {string} collection - The collection name.
     * @param {string} [route] - Optional dot/slash path within the collection.
     *   If omitted, the entire collection is removed from storage.
     */
    static remove(collection, route) {
        function remove(driver) {
            let localState;

            try {
                const localStateRaw = driver.getItem("UpState") || "{}";
                localState = JSON.parse(localStateRaw);
            } catch (e) {
                console.warn("UpStorage: Corrupt JSON detected. Resetting storage.");
                localState = {};
            }

            if (!route) {
                delete localState[collection];
            } else {
                const { targetParent, targetKey } = Utility.getPathInfo(collection, route, localState, true);
                if (targetParent) {
                    delete targetParent[targetKey];
                }
            }

            driver.setItem("UpState", JSON.stringify(localState));
        }

        remove(localStorage);
        remove(sessionStorage);
    }
}

/**
 * @class State
 * @extends EventTarget
 * @description The core UpState class. Manages an in-memory state tree with
 * optional persistence to `localStorage` or `sessionStorage`. Fires a
 * synchronous `update` event whenever state changes — by the time any listener
 * runs, the state is already updated and safe to read.
 *
 * On construction, any previously persisted state is automatically restored
 * from both storage drivers, merged together, and loaded with full date
 * hydration — ISO date strings are revived as native `Date` objects.
 *
 * ---
 *
 * **Recommended — call `config()` first:**
 * `config()` should ideally be the first call before any `set`, `get`, or
 * `remove` operations. As of v1.0.1+, calling it later is safe — any
 * collections already in state that match `persistantCollections` will be
 * persisted immediately when `config()` runs.
 *
 * ```js
 * // ✅ Recommended
 * UpState.config({ persistantCollections: [{ user: "permanent" }] });
 * UpState.set({ collection: "user", state: { name: "Alice" } });
 *
 * // ✅ Also valid — existing state is persisted when config() runs
 * UpState.set({ collection: "user", state: { name: "Alice" } });
 * UpState.config({ persistantCollections: [{ user: "permanent" }] });
 * ```
 *
 * ---
 *
 * **State is fully encapsulated:**
 * The internal state tree is a private class field (`#state`). It cannot be
 * read or modified from outside the class — the JS engine enforces this hard.
 * All access must go through the public methods.
 *
 * ```js
 * UpState.#state;      // SyntaxError — always
 * UpState.state = {};  // Silently ignored — Object.freeze blocks this
 * ```
 *
 * @fires State#update
 */
class State extends EventTarget {

    /**
     * The live in-memory state tree. Private — enforced by the JS engine.
     * All reads and writes must go through the public methods.
     * @type {Object}
     * @private
     */
    #state = {};

    /**
     * Collections that should be automatically persisted to storage.
     * Set via `config()`. Defaults to an empty array (no auto-persistence).
     * @type {Array<Object>}
     * @private
     */
    #persistantCollections = [];

    /**
     * Controls whether `update` events are fired on state changes.
     * Set via `config()`. Defaults to `true`.
     * @type {boolean}
     * @private
     */
    #allowEventDispatches = true;

    constructor() {
        super();

        // Restore and hydrate persisted state from both storage drivers.
        // JSONHydrator revives ISO date strings as native Date objects.
        const sessionRaw = sessionStorage.getItem("UpState") || "{}";
        let sessionParsed;
        try {
            sessionParsed = Utility.JSONHydrator(sessionRaw);
        } catch {
            sessionParsed = {};
        }

        const permanentRaw = localStorage.getItem("UpState") || "{}";
        let permanentParsed;
        try {
            permanentParsed = Utility.JSONHydrator(permanentRaw);
        } catch {
            permanentParsed = {};
        }

        // Merge both sources — localStorage (permanent) takes priority over sessionStorage
        this.#state = Utility.deepMerge(sessionParsed, permanentParsed);
    }

    /**
     * Configures UpState behaviour.
     *
     * Calling `config()` first is recommended, but it is safe to call at any
     * point. Any collections listed in `persistantCollections` that already
     * exist in state will be persisted immediately when `config()` runs —
     * no data is lost.
     *
     * @param {Object} options
     * @param {Array<Object>} [options.persistantCollections=[]] -
     *   An array of objects mapping collection names to their persistence type.
     *   Example: `[{ user: "permanent" }, { cart: "session" }]`
     * @param {boolean} [options.allowEventDispatches=true] -
     *   Set to `false` to disable all `update` events globally.
     *
     * @throws {UpStateError} MISSING_CONFIG_ERR — if `persistantCollections` is not an array.
     *
     * @example
     * // Recommended: call at the top of your app entry point
     * UpState.config({
     *   persistantCollections: [{ user: "permanent" }, { cart: "session" }],
     *   allowEventDispatches: true
     * });
     *
     * @example
     * // Also valid: config after state exists — matching collections are persisted immediately
     * UpState.set({ collection: "user", state: { name: "Alice" } });
     * UpState.config({ persistantCollections: [{ user: "permanent" }] });
     */
    config({
        persistantCollections = [],
        allowEventDispatches = true,
    }) {
        this.#allowEventDispatches = !!allowEventDispatches;

        if (Array.isArray(persistantCollections)) {
            // Sets collection-level persistence.
            // Individual set() calls can override this for a single write.
            this.#persistantCollections = persistantCollections;

            // Retroactively persist any collections already in state.
            // Makes late config() calls safe — existing data is not lost.
            this.#persistantCollections.forEach(collection => {
                const key = Object.keys(collection)[0];

                if (key in this.#state) {
                    const persistence = collection[key];
                    const state = this.#state[key];
                    StorageHandler.set({ collection: key, state, persistence });
                }
            });

        } else {
            throw new UpStateError(
                "persistantCollections should be an array of collection names",
                "MISSING_CONFIG_ERR"
            );
        }
    }

    /**
     * Sets a value in the state tree. Optionally persists it to storage
     * and fires a synchronous `update` event. The state is always fully
     * updated before the event fires.
     *
     * **Persistence priority:** call-level `persistence` takes priority over
     * config-level. If no valid call-level value is provided, the method falls
     * back to whatever `persistantCollections` specifies for that collection.
     *
     * @param {Object} options
     * @param {string} options.collection - The top-level collection to write to.
     * @param {*} options.state - The value to store. Can be anything except `undefined`.
     * @param {string} [options.route] - Dot or slash separated path within the collection
     *   (e.g. `"profile/name"` or `"profile.name"`).
     * @param {"session"|"permanent"} [options.persistence] - Persist to storage for this
     *   call. Overrides config-level persistence if provided.
     * @param {boolean} [dispatchUpdateEvent=true] - Whether to fire the `update` event.
     *   Used internally by batch methods to suppress individual events.
     *
     * @throws {UpStateError} MISSING_COLLECTION_REF — if `collection` is missing or empty.
     * @throws {UpStateError} INVALID_COLLECTION_REF — if `collection` is not a string.
     * @throws {UpStateError} INVALID_STATE_VALUE — if `state` is `undefined`.
     * @throws {UpStateError} INVALID_PERSISTENCE_VALUE — if `persistence` is not `"session"` or `"permanent"`.
     *
     * @example
     * UpState.set({ collection: "user", state: { name: "Alice" } });
     * UpState.set({ collection: "user", route: "profile/age", state: 30 });
     *
     * // Override config-level persistence for this call only
     * UpState.set({ collection: "cache", state: {}, persistence: "session" });
     */
    set({ collection, state, route, persistence }, dispatchUpdateEvent = true) {

        if (collection === undefined || collection === "") {
            throw new UpStateError("collection name is required", "MISSING_COLLECTION_REF");
        }

        if (typeof collection !== "string") {
            throw new UpStateError("collection can only be a String", "INVALID_COLLECTION_REF");
        }

        // Avoid if(!state) — it would incorrectly reject 0, false, [], etc.
        if (state === undefined) {
            throw new UpStateError("state value cannot be 'undefined'", "INVALID_STATE_VALUE");
        }

        state = (typeof state === 'object' && state !== null)
            ? structuredClone(state)
            : state;

        const destination = {};

        if (!route) {
            this.#state[collection] = state;
            destination.targetParent = this.#state;
            destination.targetKey = collection;
        } else {
            const { targetParent, targetKey } = Utility.getPathInfo(collection, route, this.#state, true);
            destination.targetParent = targetParent;
            destination.targetKey = targetKey;
            if (targetParent) {
                targetParent[targetKey] = state;
            }
        }

        // Call-level persistence takes priority — only fall back to config if no valid value was provided
        const markedForPersistence = this.#persistantCollections.find(obj => collection in obj);
        const persistenceValue = String(persistence).toLowerCase();

        if (markedForPersistence && !(persistenceValue === "permanent" || persistenceValue === "session")) {
            persistence = markedForPersistence[collection];
        }

        if (persistence) {
            const resolvedPersistence = String(persistence).toLowerCase();
            if (resolvedPersistence === "permanent" || resolvedPersistence === "session") {
                StorageHandler.set({ collection, state, route, persistence });
            } else {
                throw new UpStateError(
                    "invalid persistence value; it can only be 'session' or 'permanent'",
                    "INVALID_PERSISTENCE_VALUE"
                );
            }
        }

        if (dispatchUpdateEvent && this.#allowEventDispatches) {
            /**
             * Fired synchronously after any state change. By the time this fires,
             * the state tree is already updated — calling `UpState.get()` inside
             * a listener will always return the new value.
             *
             * @event State#update
             * @type {CustomEvent}
             * @property {"set"|"remove"|"batchSet"|"batchRemove"} detail.action - What triggered the event.
             * @property {string} detail.collection - The affected collection.
             * @property {string} [detail.route] - The route within the collection, if any.
             * @property {*} detail.state - The value that was set, or the parent object after a removal.
             * @property {Object} detail.destination - `{ targetParent, targetKey }` of the affected node.
             */
            this.dispatchEvent(new CustomEvent("update", {
                detail: { collection, route, destination, state, action: "set" },
                cancelable: true,
            }));
        }
    }

    /**
     * Retrieves a value from the state tree. Never throws on missing data —
     * returns a `Result` wrapping `null` instead.
     *
     * Calling `get()` with no arguments returns a full deep clone of the
     * entire state tree. Passing an empty string throws, as that is likely
     * a mistake rather than intentional.
     *
     * @param {string} [collection] - The collection to read from.
     *   Omit entirely to get a snapshot of the full state tree.
     * @param {string} [route] - Dot or slash separated path within the collection.
     * @returns {Result} A `Result` wrapping the value.
     *
     * @throws {UpStateError} MISSING_COLLECTION_REF — if `collection` is an empty string.
     * @throws {UpStateError} INVALID_COLLECTION_REF — if `collection` is not a string (and not `undefined`).
     *
     * @example
     * const user    = UpState.get("user").raw;
     * const name    = UpState.get("user", "profile/name").raw;
     * const allData = UpState.get().raw; // full state snapshot
     */
    get(collection, route) {

        // No collection — return a full deep clone of the entire state tree
        if (collection === undefined) return new Result(structuredClone(this.#state));

        // Empty string is likely a mistake — throw rather than silently returning all state
        if (collection === "") {
            throw new UpStateError("collection name is required", "MISSING_COLLECTION_REF");
        }

        if (typeof collection !== "string") {
            throw new UpStateError("collection can only be a String", "INVALID_COLLECTION_REF");
        }

        if (!(collection in this.#state)) return new Result(null);

        if (!route) return new Result(this.#state[collection]);

        const { targetParent, targetKey } = Utility.getPathInfo(collection, route, this.#state);
        const outputValue = targetParent[targetKey];
        const output = (typeof outputValue === 'object' && outputValue !== null)
            ? structuredClone(outputValue)
            : outputValue;

        return new Result(output);
    }

    /**
     * Removes a value from the state tree and from both storage drivers.
     * Fires a synchronous `update` event unless suppressed.
     *
     * @param {string} collection - The collection to remove from.
     * @param {string} [route] - Dot or slash separated path within the collection.
     *   If omitted, the entire collection is removed.
     * @param {boolean} [dispatchUpdateEvent=true] - Whether to fire the `update` event.
     *   Used internally by `batchRemove` to suppress individual events.
     * @returns {Object} The parent object after the deletion.
     *
     * @throws {UpStateError} MISSING_COLLECTION_REF — if `collection` is missing or empty.
     * @throws {UpStateError} INVALID_COLLECTION_REF — if `collection` is not a string.
     *
     * @example
     * UpState.remove("user");                    // removes the entire collection
     * UpState.remove("user", "profile/age");     // removes a specific nested value
     */
    remove(collection, route, dispatchUpdateEvent = true) {

        if (collection === undefined || collection === "") {
            throw new UpStateError("collection name is required", "MISSING_COLLECTION_REF");
        }

        if (typeof collection !== "string") {
            throw new UpStateError("collection can only be a String", "INVALID_COLLECTION_REF");
        }

        const destination = {};

        if (!route) {
            destination.targetParent = this.#state;
            destination.targetKey = collection;
            delete this.#state[collection];
        } else {
            const { targetParent, targetKey } = Utility.getPathInfo(collection, route, this.#state, false);
            destination.targetParent = targetParent;
            destination.targetKey = targetKey;
            if (targetParent && targetKey in targetParent) {
                delete targetParent[targetKey];
            }
        }

        StorageHandler.remove(collection, route);

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

    /**
     * Sets multiple state values in a single operation. Each individual write
     * happens silently (no event per write), then a single `update` event is
     * fired once all writes are complete.
     *
     * @param {Array<Object>} arrayOfSetObjects - An array of option objects,
     *   each matching the signature of `set()`.
     *
     * @throws {UpStateError} INVALID_BATCH_SET_ARGUMENT — if the argument is not an array.
     *
     * @example
     * UpState.batchSet([
     *   { collection: "user", state: { name: "Alice" } },
     *   { collection: "settings", route: "theme", state: "dark" }
     * ]);
     */
    batchSet(arrayOfSetObjects) {
        if (!Array.isArray(arrayOfSetObjects)) {
            throw new UpStateError(
                "was expecting an array of objects meant for the Upstate.set method",
                "INVALID_BATCH_SET_ARGUMENT"
            );
        }

        const collections = [];
        const stateInputs = {};

        arrayOfSetObjects.forEach(setObject => {
            this.set(setObject, false); // suppress individual events

            if (!stateInputs[setObject.collection]) {
                stateInputs[setObject.collection] = [];
            }

            const logState = (typeof setObject.state === "object")
                ? structuredClone(setObject.state)
                : setObject.state;

            stateInputs[setObject.collection].push(logState);
            collections.push(setObject.collection);
        });

        if (this.#allowEventDispatches) {
            this.dispatchEvent(new CustomEvent("update", {
                detail: {
                    action: "batchSet",
                    count: arrayOfSetObjects.length,
                    collections: [...new Set(collections)],
                    stateInputs
                },
                cancelable: true,
            }));
        }
    }

    /**
     * Retrieves multiple values in a single call. Returns a `Result` wrapping
     * an object keyed by collection name, where each value is an array of raw
     * results for that collection.
     *
     * Does not fire an `update` event — reads are always silent.
     *
     * @param {Array<{ collection: string, route?: string }>} arrayOfGetRequests
     * @returns {Result} A `Result` wrapping `{ [collection]: rawValue[] }`.
     *
     * @throws {UpStateError} INVALID_BATCH_GET_ARGUMENT — if the argument is not an array.
     *
     * @example
     * const result = UpState.batchGet([
     *   { collection: "user" },
     *   { collection: "user", route: "profile/name" }
     * ]);
     * result.raw; // { user: [ { name: "Alice", ... }, "Alice" ] }
     */
    batchGet(arrayOfGetRequests) {
        if (!Array.isArray(arrayOfGetRequests)) {
            throw new UpStateError(
                "batchGet expects an array of objects",
                "INVALID_BATCH_GET_ARGUMENT"
            );
        }

        const data = {};

        arrayOfGetRequests.forEach(req => {
            if (!data[req.collection]) {
                data[req.collection] = [];
            }
            data[req.collection].push(this.get(req.collection, req.route).raw);
        });

        return new Result(data);
    }

    /**
     * Removes multiple values in a single operation. Each individual removal
     * happens silently (no event per removal), then a single `update` event
     * is fired once all removals are complete.
     *
     * @param {Array<{ collection: string, route?: string }>} arrayOfRemoveRequests
     *
     * @throws {UpStateError} INVALID_BATCH_REMOVE_ARGUMENT — if the argument is not an array.
     *
     * @example
     * UpState.batchRemove([
     *   { collection: "user", route: "profile/age" },
     *   { collection: "cart" }
     * ]);
     */
    batchRemove(arrayOfRemoveRequests) {
        if (!Array.isArray(arrayOfRemoveRequests)) {
            throw new UpStateError(
                "was expecting an array of objects meant for the Upstate.remove method",
                "INVALID_BATCH_REMOVE_ARGUMENT"
            );
        }

        const collections = [];

        arrayOfRemoveRequests.forEach(removeObject => {
            this.remove(removeObject.collection, removeObject.route, false); // suppress individual events
            collections.push(removeObject.collection);
        });

        if (this.#allowEventDispatches) {
            this.dispatchEvent(new CustomEvent("update", {
                detail: {
                    action: "batchRemove",
                    count: arrayOfRemoveRequests.length,
                    collections: [...new Set(collections)],
                },
                cancelable: true,
            }));
        }
    }
}

const UpState = new State();
Object.freeze(UpState);
export default UpState;
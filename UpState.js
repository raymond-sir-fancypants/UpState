"use strict";

// UpState version 1.0.1

/**
 * @class Utility
 * @description Internal helper class. Not part of the public API.
 * @private
 */
class Utility {

    /**
     * Recursively merges two objects, with `source` values taking priority.
     * Uses `structuredClone` to avoid mutating the originals.
     * @param {Object} target - The base object.
     * @param {Object} source - The object to merge into the target.
     * @returns {Object} A new deeply merged object.
     */
    static deepMerge(target, source) {
        target = structuredClone(target);
        source = structuredClone(source);

        for (const key in source) {
            if (source[key] instanceof Object && key in target) {
                Object.assign(source[key], this.deepMerge(target[key], source[key]));
            }
        }
        Object.assign(target || {}, source);
        return target;
    }

    /**
     * Traverses the state tree to find the target location for a given route.
     * Returns the parent object and the final key to act upon, so callers
     * can read, write, or delete without re-traversing the tree.
     *
     * @param {string} collection - The top-level state collection name.
     * @param {string} route - Dot or slash separated path (e.g. `"user/profile"` or `"user.profile"`).
     * @param {Object} state - The full state object to traverse.
     * @param {boolean} [createPath=false] - If true, mutates the state directly (for writes).
     *                                       If false, operates on a clone (for reads).
     * @returns {{ targetParent: Object, targetKey: string }}
     */
    static getPathInfo(collection, route, state, createPath = false) {

        if (!createPath) {
            state = structuredClone(state);
        }

        if (!(collection in state)) state[collection] = {};

        const routeArray = route.split(/[./]/); // Split by . or /
        let cursor = state[collection];

        // Walk to the second-to-last item
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
 * Result instances are immutable. Once created, the wrapped value cannot
 * be changed from outside the class.
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
     * The wrapped value. Private and immutable — access via `.raw`, `.list`, or `.map`.
     * @type {*}
     * @private
     */
    #data;

    /**
     * @param {*} input - The value to wrap.
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
     * - If a plain object, returns its values.
     * - If a primitive, wraps it in an array.
     * - If null, returns an empty array.
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
     * - If an array, converts indices to keys (`{ 0: val, 1: val }`).
     * - If a primitive, wraps it as `{ 0: value }`.
     * - If null, returns an empty object.
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
     * Iterates over the value as a map (plain object), calling `callback` for
     * each key-value pair and returning a new object with the results.
     * If the callback returns `undefined`, the key is set to `null`.
     *
     * Useful for transforming object state without extra boilerplate.
     *
     * @param {function(key: string, value: *): *} callBack - Called with each key and value.
     * @returns {Object} A new object with the transformed values.
     *
     * @example
     * const result = UpState.get("prices");
     * const discounted = result.iterateAsMap((key, value) => value * 0.9);
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
     * Iterates over the value as a list (array), calling `callback` for each
     * item and returning a new array with the results.
     * If the callback returns `undefined`, the item is set to `null`.
     *
     * Useful for transforming array state without extra boilerplate.
     *
     * @param {function(index: number, value: *): *} callBack - Called with each index and value.
     * @returns {Array} A new array with the transformed values.
     *
     * @example
     * const result = UpState.get("tags");
     * const upper = result.iterateAsList((i, value) => value.toUpperCase());
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
 * to keep storage clean. Not part of the public API.
 * @private
 */
class StorageHandler {

    /**
     * Writes a value to the appropriate storage driver.
     * @param {Object} options
     * @param {string} options.collection - The collection name.
     * @param {*} options.state - The value to persist.
     * @param {string} [options.route] - Optional dot/slash path within the collection.
     * @param {"session"|"permanent"} options.persistence - Which storage driver to use.
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
     * Removes a value from both `localStorage` and `sessionStorage`.
     * Runs against both drivers since the data may have moved between them.
     * @param {string} collection - The collection name.
     * @param {string} [route] - Optional dot/slash path within the collection.
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
 * optional persistence to `localStorage` or `sessionStorage`. Fires an
 * `update` event whenever state changes.
 *
 * On construction, any previously persisted state is automatically restored
 * from storage and merged into the initial state.
 *
 * ---
 *
 * **Recommended — call `config()` first:**
 * `config()` should ideally be the first call you make before any `set`, `get`,
 * or `remove` operations. That said, as of v1.0.1, calling `config()` after
 * state already exists is supported — it will retroactively persist any
 * collections listed in `persistantCollections` that are already in state.
 *
 * ```js
 * // ✅ Recommended — config before anything else
 * UpState.config({ persistantCollections: [{ user: "permanent" }] });
 * UpState.set({ collection: "user", state: { name: "Alice" } });
 *
 * // ✅ Also valid in v1.0.1 — existing state will be persisted on config
 * UpState.set({ collection: "user", state: { name: "Alice" } });
 * UpState.config({ persistantCollections: [{ user: "permanent" }] });
 * ```
 *
 * ---
 *
 * **State is fully encapsulated:**
 * The internal state tree is stored in a private class field (`#state`).
 * It cannot be read or modified from outside the class — the JS engine
 * enforces this hard. All access must go through the provided methods.
 *
 * ```js
 * UpState.#state;       // SyntaxError — always
 * UpState.state = {};   // Silently ignored — Object.freeze blocks this
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
     * Configured via `config()`. Defaults to an empty array (no auto-persistence).
     * @type {Array<Object>}
     * @private
     */
    #persistantCollections = [];

    /**
     * Controls whether `update` events are fired on state changes.
     * Configured via `config()`. Defaults to `true`.
     * @type {boolean}
     * @private
     */
    #allowEventDispatches = true;

    constructor() {
        super();

        // Restore persisted state from both storage drivers and merge them
        const sessionRaw = sessionStorage.getItem("UpState") || "{}";
        let sessionParsed;
        try {
            sessionParsed = JSON.parse(sessionRaw);
        } catch {
            sessionParsed = {};
        }

        const permanentRaw = localStorage.getItem("UpState") || "{}";
        let permanentParsed;
        try {
            permanentParsed = JSON.parse(permanentRaw);
        } catch {
            permanentParsed = {};
        }

        this.#state = Utility.deepMerge(sessionParsed, permanentParsed);
    }

    /**
     * Configures UpState behaviour.
     *
     * Calling `config()` first is recommended, but as of v1.0.1 it is safe to
     * call it after state has already been written. Any collections listed in
     * `persistantCollections` that already exist in state will be persisted
     * immediately when `config()` runs.
     *
     * @param {Object} options
     * @param {Array<Object>} [options.persistantCollections=[]] -
     *   An array of objects mapping collection names to their persistence type.
     *   Example: `[{ users: "permanent" }, { cart: "session" }]`
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
     * // Also valid in v1.0.1 — existing state is persisted immediately
     * UpState.set({ collection: "user", state: { name: "Alice" } });
     * UpState.config({ persistantCollections: [{ user: "permanent" }] });
     */
    config({
        persistantCollections = [],
        allowEventDispatches = true,
    }) {
        this.#allowEventDispatches = !!allowEventDispatches;

        if (Array.isArray(persistantCollections)) {
            this.#persistantCollections = persistantCollections;

            // Retroactively persist any collections that already exist in state.
            // This makes late config() calls safe — existing data won't be lost.
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
     * and fires an `update` event.
     *
     * Call-level `persistence` takes priority over config-level persistence,
     * allowing you to override storage behaviour for individual writes.
     *
     * @param {Object} options
     * @param {string} options.collection - The top-level collection to write to.
     * @param {*} options.state - The value to store. Cannot be `undefined`.
     * @param {string} [options.route] - Dot or slash separated path within the collection
     *   (e.g. `"profile/name"` or `"profile.name"`).
     * @param {"session"|"permanent"} [options.persistence] - Persist to storage.
     *   If provided, this overrides the persistence set in `config()` for this call only.
     *   If omitted, falls back to the collection's config-level persistence.
     * @param {boolean} [dispatchUpdateEvent=true] - Whether to fire the `update` event.
     *   Set to `false` internally by batch methods to defer the event.
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
     * UpState.set({ collection: "cart", state: [], persistence: "session" });
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

        // Call-level persistence takes priority over config-level.
        // Only fall back to config if no valid call-level value was provided.
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
             * Fired after any state change.
             * @event State#update
             * @type {CustomEvent}
             * @property {"set"|"remove"|"batchSet"|"batchRemove"} detail.action
             * @property {string} detail.collection
             * @property {string} [detail.route]
             * @property {*} detail.state - The value that was set or the parent after removal.
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
     * If called with no arguments (or `undefined` as the collection), returns
     * a `Result` wrapping a full clone of the entire state tree. Passing an
     * empty string still throws, as that is likely a mistake.
     *
     * @param {string} [collection] - The collection to read from.
     *   Omit entirely to retrieve the full state tree.
     * @param {string} [route] - Dot or slash separated path within the collection.
     * @returns {Result} A `Result` object wrapping the value.
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

        // No collection = return a full clone of the entire state tree
        if (collection === undefined) {
            return new Result(structuredClone(this.#state));
        }

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
     * Removes a value from the state tree and from storage.
     * Fires an `update` event unless suppressed.
     *
     * @param {string} collection - The collection to remove from.
     * @param {string} [route] - Dot or slash separated path within the collection.
     *   If omitted, the entire collection is removed.
     * @param {boolean} [dispatchUpdateEvent=true] - Whether to fire the `update` event.
     * @returns {Object} The parent object after the deletion.
     *
     * @throws {UpStateError} MISSING_COLLECTION_REF — if `collection` is missing or empty.
     * @throws {UpStateError} INVALID_COLLECTION_REF — if `collection` is not a string.
     *
     * @example
     * UpState.remove("user");                    // removes entire collection
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
     * Sets multiple state values in a single operation. All writes happen
     * before a single `update` event is fired, keeping listeners efficient.
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
            this.set(setObject, false);

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
                    state: structuredClone(this.#state),
                    collections: [...new Set(collections)],
                    stateInputs
                },
                cancelable: true,
            }));
        }
    }

    /**
     * Retrieves multiple values in a single call. Returns a `Result` wrapping
     * an object keyed by collection name, where each value is an array of
     * raw results for that collection.
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
     * result.raw; // { user: [ {...}, "Alice" ] }
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
     * Removes multiple values in a single operation. All removals happen
     * before a single `update` event is fired.
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
            this.remove(removeObject.collection, removeObject.route, false);
            collections.push(removeObject.collection);
        });

        if (this.#allowEventDispatches) {
            this.dispatchEvent(new CustomEvent("update", {
                detail: {
                    action: "batchRemove",
                    count: arrayOfRemoveRequests.length,
                    state: structuredClone(this.#state),
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
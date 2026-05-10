"use strict";


/**!
 * library: UpState:
 * description: A high-performance, reactive state engine.
 * author: Raymond ngule
 * license: MIT
 * Version: 5.0.0
 * Repository: https://github.com/raymond-sir-fancypants/UpState
 */


/**
 * @fileoverview UpState — a lightweight, framework-agnostic client-side state management library.
 *
 * UpState organises state into named **collections** (top-level buckets) and lets you read or
 * write any value inside a collection via a dot- or slash-separated **route** string.
 * It supports reactive subscriptions, optional persistence to `localStorage` / `sessionStorage`
 *  and batched operations.
 *
 * **Quick-start**
 * ```js
 * import UpState from "./UpState.js";          // singleton
 * import { State } from "./UpState.js";         // constructor (for testing / multiple stores)
 *
 * // Write
 * UpState.set({ collection: "user", state: { name: "Alice" } });
 * UpState.set({ collection: "user", route: "profile.age", state: 30 });
 *
 * // Read
 * const name = UpState.get("user", "profile.name").raw;
 *
 * // React to changes
 * const unsub = UpState.subscribe({
 *   collection: "user",
 *   key: "myComponent-user",
 *   callback: (newState) => console.log("user changed", newState),
 * });
 * ```
 *
 * @module UpState
 * @version 5.0.0
 */

/** @type {string} Current version of UpState. */
const VERSION = "5.0.0";

/**
 * Internal sentinel Symbol used as a Map key to represent a subscription
 * that targets an entire collection rather than a specific route within it.
 * Never exposed publicly; referenced only inside the State class.
 * @type {symbol}
 */
const FIREONENTIRECOLLECTION = Symbol("fireOnEntireCollection");

/**
 * The localStorage / sessionStorage key under which all UpState-persisted
 * data is stored.  The value is intentionally long and unique to avoid
 * collisions with application data.
 * @type {string}
 */
const UPSTATE_STORAGE_KEY = "__UPSTATE_α_8f2b4491-9081-_LOCAL_4c12-b7d6-ec2026af999a_STORAGE__";

// ---------------------------------------------------------------------------
// printSignature
// ---------------------------------------------------------------------------

/**
 * Logs a styled console banner containing package metadata (name, version,
 * author, license, repo).  Only runs in browser environments
 * (`typeof window !== "undefined"`).  Called automatically by
 * `UpState.debug.version()`.
 *
 * @returns {void}
 */
function printSignature() {
    if (typeof window !== "undefined") {
        const pkg = {
            name: "UpState",
            description: "A high-performance, reactive state engine.",
            author: "Raymond Ngule",
            license: "MIT",
            version: VERSION,
            repo: "https://github.com/sir-fancypants/UpState",
        };

        const c = {
            group: `color: #2898e2; font-weight: bold; font-family: monospace;`,
            banner: "color: #2898e2; font-family: monospace; font-size: 12px; line-height: 1.1; font-weight: bold;",
            dot: "color: #a03131; font-weight: bold;",
            key: "color: #20b9d4; font-family: monospace; font-size: 15px;",
            val: "font-family: monospace; font-size: 13px;",
            dim: "color: #20b9d4; font-family: monospace; font-size: 14px;",
            badge: "background: #2385c6; color: #ffffff; border: 2px solid #cccccc; border-radius: 5px; padding: 5px 6px; font-size: 14px; font-family: monospace; font-weight: bold;",
        };

        const bannerArt = [
            " ██╗   ██╗██████╗ ███████╗████████╗ █████╗ ████████╗███████╗",
            " ██║   ██║██╔══██╗██╔════╝╚══██╔══╝██╔══██╗╚══██╔══╝██╔════╝",
            " ██║   ██║██████╔╝███████╗   ██║   ███████║   ██║   █████╗  ",
            " ██║   ██║██╔═══╝ ╚════██║   ██║   ██╔══██║   ██║   ██╔══╝  ",
            " ╚██████╔╝██║     ███████║   ██║   ██║  ██║   ██║   ███████╗",
            "  ╚═════╝ ╚═╝     ╚══════╝   ╚═╝   ╚═╝  ╚═╝   ╚═╝   ╚══════╝",
        ].join("\n");

        const rows = [
            ["version", pkg.version],
            ["description", pkg.description],
            ["author", pkg.author],
            ["license", pkg.license],
            ["repository", pkg.repo],
        ];

        console.groupCollapsed(`%c ● SYSTEM READY %c v${pkg.version} %c© 2026 ${pkg.author}`, c.badge, c.dim, c.dim);

        console.log(`%c${bannerArt}`, c.banner);

        rows.forEach(([key, val]) => {
            const k = `◆ ${key}`.padEnd(16);
            console.log(`%c${k.slice(0, 1)}%c${k.slice(1)}%c${val}`, c.dot, c.key, c.val);
        });

        console.groupEnd();
    }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * A collection of pure, stateless helper functions used internally throughout
 * UpState.  Not part of the public API; do not instantiate or call directly.
 */
class Utility {

    /**
     * Creates a shallow copy of `object` with its prototype chain stripped,
     * returning a truly null-prototype object (`Object.create(null)`).
     * This prevents prototype-pollution attacks when data arrives from
     * untrusted sources such as `localStorage`.
     *
     * @param {object} object - The plain object to strip.
     * @returns {object} A new null-prototype object with the same own
     *   enumerable properties as `object`.
     */
    static stripPrototype(object) {
        return Object.assign(Object.create(null), object);
    }

    // -----------------------------------------------------------------------

    /**
     * Normalises a caller-supplied `persistence` value into the canonical
     * internal shape `{ type: string, expiry: string | number }`.
     *
     * Accepted input forms:
     * - `undefined` / falsy  → `{ type: "permanent", expiry: "never" }`
     * - `"session"` or `"permanent"` (string shorthand) →
     *   `{ type: <value>, expiry: "never" }`
     * - `{ type, expiry? }` (full object) → passes through with `expiry`
     *   defaulting to `"never"` when omitted.
     *
     * @param {string | { type: string, expiry?: string | number } | undefined} persistence
     *   The raw persistence value supplied by the caller.
     * @returns {{ type: string, expiry: string | number }}
     *   Normalised persistence descriptor.
     */
    static normalizePersistence(persistence) {
        if (!persistence) return {
            type: "permanent",
            expiry: "never"
        };

        if (typeof persistence === "string") {
            return { type: persistence, expiry: "never" };
        }

        return {
            type: persistence.type,
            expiry: persistence.expiry ?? "never"
        };
    }

    // -----------------------------------------------------------------------

    /**
     * Converts a human-friendly expiry description into an absolute Unix
     * timestamp in milliseconds (suitable for comparison with `Date.now()`),
     * or returns `null` to indicate "never expires".
     *
     * Supported `expiry` forms:
     * | Value | Meaning |
     * |-------|---------|
     * | `"never"` / falsy | No expiration; returns `null` |
     * | `number` | Milliseconds from now; returns `Date.now() + expiry` |
     * | `"30d"` | 30 days from now |
     * | `"12h"` | 12 hours from now |
     * | `"30m"` | 30 minutes from now |
     * | `"10s"` | 10 seconds from now |
     * | `"500ms"` | 500 milliseconds from now |
     *
     * @param {string | number | undefined} expiry - The expiry descriptor.
     * @returns {number | null} Absolute expiry timestamp, or `null` if the
     *   value should never expire.
     * @throws {UpStateError} `INVALID_ARG` – if `expiry` is a string that
     *   does not match a recognised shorthand pattern.
     */
    static resolveExpiry(expiry) {
        if (!expiry || expiry === "never") return null;
        if (typeof expiry === "number") return Date.now() + expiry;

        // Parse shorthand strings: "30d", "12h", "30m"
        const units = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
        const match = String(expiry).match(/^(\d+)(ms|s|m|h|d)$/);
        if (match) return Date.now() + (parseInt(match[1]) * units[match[2]]);

        throw new UpStateError("'expiry' must be 'never', a number (ms), or a shorthand like '30d'", "INVALID_ARG");
    }

    // -----------------------------------------------------------------------

    /**
     * Parses a JSON string into a null-prototype plain object while
     * automatically reviving ISO 8601 date strings back into `Date` objects.
     *
     * The reviver covers the full ISO 8601 spectrum produced by
     * `JSON.stringify` — both `YYYY-MM-DDTHH:mm:ss.sssZ` and
     * `YYYY-MM-DDTHH:mm:ss±HH:mm` forms.  Calendar-invalid dates (e.g.
     * "Feb 31") are left as strings.
     *
     * **Error recovery strategy:**
     * 1. If date-aware parsing fails, it retries with a plain `JSON.parse`
     *    (dates remain as strings but the rest of the state survives).
     * 2. If `JSON.parse` itself throws (corrupt JSON), an empty null-prototype
     *    object is returned and the failure is logged unless `silenceWarnings`
     *    is `true`.
     *
     * @param {string | null | undefined} jsonString - The raw JSON string to
     *   parse; falsy values return an empty object immediately.
     * @param {boolean} [silenceWarnings=false] - When `true`, suppresses all
     *   console error/warn output during recovery.
     * @returns {object} Parsed state as a null-prototype object, or
     *   `Object.create(null)` on unrecoverable failure.
     */
    static JSONHydrator(jsonString, silenceWarnings) {
        if (!jsonString) return Object.create(null);

        // This regex covers the full ISO 8601 spectrum used by JSON.stringify:
        // YYYY-MM-DDTHH:mm:ss.sssZ or YYYY-MM-DDTHH:mm:ss+HH:mm
        const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[-+]\d{2}:\d{2})?$/;

        try {
            const value = JSON.parse(jsonString, (key, value) => {
                if (typeof value === 'string' && isoDateRegex.test(value)) {
                    const potentialDate = new Date(value);

                    // Ensure it's a valid date (not "Feb 31st") before returning the object
                    return !isNaN(potentialDate.getTime()) ? potentialDate : value;
                }
                return value;
            });

            return Utility.stripPrototype(value)
        } catch (e) {
            // Fallback for malformed JSON
            if (!silenceWarnings) {
                console.error(`%c ◆ UpState Hydration Error `, "background: #ff4444; color: #fff; font-weight: bold;");
                console.warn("Reason: Date hydration failure via JSON.parse. Check if your state contains non-serializable objects.");
                console.warn("Persisted state may be corrupted. Skipping Date hydration to preserve recoverable state. Stored Date objects may be deserialized as strings.");
            }

            try {
                return Utility.stripPrototype(JSON.parse(jsonString));
            } catch (error) {
                if (!silenceWarnings) {

                    const c = {
                        header: "background: #ff0055; color: #ffffff; font-weight: bold; padding: 4px 8px; border-radius: 4px; font-family: monospace;",
                        msg: "color: #ffb3c6; font-family: monospace;  font-weight: bold;",
                        dim: "font-family: monospace:",
                        code: "color: #ffffff; background: #33111a; padding: 2px 4px; border-radius: 2px; font-family: monospace;"
                    };

                    console.group(`%c ⚠ CRITICAL: PERSISTENT STATE CORRUPT `, c.header);
                    console.warn("%cReason: JSON.parse catastrophic failure. The stored string is no longer valid JSON.", c.msg);
                    console.log("%cError Details: %c" + error.message, c.dim, c.code);

                    // Optional: Log the first 50 chars of the corrupt data so the dev can see what happened
                    if (jsonString) {
                        console.log("%cPreview of corrupt data: %c" + jsonString.slice(0, 50) + "...", c.dim, c.code);
                    }

                    console.log("%cAction: UpState has defaulted to the initial state to prevent app crash.", c.dim);
                    console.groupEnd();
                }

                return Object.create(null);
            }
        }
    }

    // -----------------------------------------------------------------------

    /**
     * Recursively merges `source` into `target`, returning a new
     * null-prototype object (the originals are not mutated).
     *
     * **Merge rules:**
     * - Plain objects are merged recursively; `source` keys win on conflict.
     * - Arrays are **concatenated** (`[...target, ...source]`), not
     *   replaced.  This is intentional for the storage-hydration use-case
     *   (session data appends to permanent data for the same key).
     * - Primitives and all other value types from `source` overwrite `target`.
     *
     * @param {object} [target=Object.create(null)] - The base object.
     * @param {object} [source=Object.create(null)] - The object whose values
     *   take priority.
     * @returns {object} A new deeply-merged null-prototype object.
     */
    static deepMerge(target = Object.create(null), source = Object.create(null)) {
        target = target ?? Object.create(null);
        source = source ?? Object.create(null);

        const isArray = Array.isArray(source);
        const output = isArray ? (Array.isArray(target) ? [...target] : []) : { ...(target || {}) };

        for (const key in source) {
            if (Object.hasOwn(source, key)) {
                const sVal = source[key];
                const tVal = output[key];

                if (Array.isArray(sVal) && Array.isArray(tVal)) {
                    output[key] = [...tVal, ...sVal];
                }
                else if (sVal && typeof sVal === "object" && !Array.isArray(sVal)) {
                    output[key] = this.deepMerge(tVal || {}, sVal);
                }
                else {
                    output[key] = sVal;
                }
            }
        }

        return Utility.stripPrototype(output);
    }

    // -----------------------------------------------------------------------

    /**
     * Resolves a dot- or slash-delimited `route` string relative to a
     * `collection` key inside a `state` object, returning the immediate
     * parent object and the final key needed to read or write the target
     * value.
     *
     * **Read mode** (`write = false`, the default):
     * Returns `{ targetParent: {}, targetKey: <last segment> }` if any
     * segment in the path is missing or is not an object — a safe "not
     * found" sentinel that avoids throwing.
     *
     * **Write mode** (`write = true`):
     * Creates missing intermediate objects along the path, repairing any
     * broken segments.  Also creates the collection itself on `state` if it
     * does not yet exist.
     *
     * Route segments can be separated by either `.` or `/`:
     * - `"user.address.city"` and `"user/address/city"` are equivalent.
     *
     * @param {string} collection - The top-level collection key on `state`.
     * @param {string} route - Dot- or slash-delimited path string, relative
     *   to the collection (e.g. `"profile.address.zip"`).
     * @param {object} state - The root state object to traverse.
     * @param {boolean} [write=false] - When `true`, creates missing path
     *   segments; when `false`, returns a safe empty sentinel instead.
     * @returns {{ targetParent: object, targetKey: string }}
     *   `targetParent` is the object that directly contains the final
     *   key; `targetKey` is that final key.  On a read-mode miss,
     *   `targetParent` is `{}` and `targetKey` is the last route segment.
     */
    static getPathInfo(collection, route, state, write = false) {
        const routeArray = route.split(/[./]/);
        const key = routeArray[routeArray.length - 1]
        // Ensure the collection exists before we start looping

        if (!Object.hasOwn(state, collection)) {
            if (!write) return { targetParent: {}, targetKey: key };
            state[collection] = {};
        }

        let cursor = state[collection];

        for (let i = 0; i < routeArray.length - 1; i++) {
            const part = routeArray[i];

            // If the path is broken or isn't an object
            if (!(part in cursor) || typeof cursor[part] !== 'object' || cursor[part] === null) {

                // READ MODE: Stop here and return a safe "nothing found"
                if (!write) return { targetParent: {}, targetKey: key };

                // WRITE MODE: Repair the path by creating the object
                cursor[part] = {};
            }

            cursor = cursor[part];
        }

        return {
            targetParent: cursor,
            targetKey: key
        };
    }

    // -----------------------------------------------------------------------

    /**
     * Deeply clones `object`, preferring the native `structuredClone` API
     * and falling back to a recursive manual implementation when
     * `structuredClone` is unavailable or throws (e.g. for objects that
     * contain functions, DOM nodes, or other non-transferable values).
     *
     * **Supported types in the fallback path:**
     * `Array`, `Date`, `Map`, `Set`, `RegExp`, and plain objects.
     * Functions and references to `window` are silently dropped.
     *
     * Circular references are handled in the fallback path via a `WeakMap`
     * seen-set; they are preserved rather than throwing.
     *
     * @param {*} object - The value to clone.  Primitives and `null` are
     *   returned as-is without cloning.
     * @param {boolean} [silenceWarnings=false] - When `true`, suppresses
     *   the `console.warn` emitted when `structuredClone` fails.
     * @param {WeakMap} [seen=new WeakMap()] - Internal circular-reference
     *   tracker; callers should omit this parameter.
     * @returns {*} A deep clone of `object`, or the original value if it
     *   is a primitive or `null`.
     */
    static clone(object, silenceWarnings = false, seen = new WeakMap()) {

        // 1. Primitives
        if (object === null || typeof object !== "object") {
            return object;
        }

        // 2. Circular reference
        if (seen.has(object)) {
            return seen.get(object);
        }

        // 3. Fast path — only attempted once per call chain
        try {
            return structuredClone(object);
        } catch (err) {
            if (!silenceWarnings) {
                console.warn("structuredClone failed, falling back to manual clone", object, err);
            }
        }

        // =========================
        // Arrays
        // =========================
        if (Array.isArray(object)) {
            const newArr = new Array(object.length); // pre-allocate
            seen.set(object, newArr);

            for (let i = 0; i < object.length; i++) {
                const item = object[i];
                // Inline primitive check avoids a recursive call just to return item
                newArr[i] = (item === null || typeof item !== "object")
                    ? item
                    : this.clone(item, true, seen); // forceManual=true skips structuredClone
            }

            return newArr;
        }

        // =========================
        // Date
        // =========================
        if (object instanceof Date) {
            return new Date(object.getTime());
        }

        // =========================
        // RegExp
        // =========================
        if (object instanceof RegExp) {
            return new RegExp(object.source, object.flags);
        }

        // =========================
        // Map
        // =========================
        if (object instanceof Map) {
            const newMap = new Map();
            seen.set(object, newMap);

            // for...of on Map directly — no need for .entries()
            for (const [key, value] of object) {
                newMap.set(
                    this.clone(key, true, seen),
                    this.clone(value, true, seen)
                );
            }

            return newMap;
        }

        // =========================
        // Set
        // =========================
        if (object instanceof Set) {
            const newSet = new Set();
            seen.set(object, newSet);

            // for...of on Set directly — no need for .values()
            for (const value of object) {
                newSet.add(this.clone(value, true, seen));
            }

            return newSet;
        }

        // =========================
        // Generic object
        // =========================
        const newObj = {};
        seen.set(object, newObj);

        // Hoist window check — was being evaluated on every property
        const hasWindow = typeof window !== "undefined";

        for (const key of Object.keys(object)) {
            const val = object[key];

            if (typeof val === "function") continue;
            if (hasWindow && val === window) continue;

            // Inline primitive check — avoids recursion overhead for simple values
            newObj[key] = (val === null || typeof val !== "object")
                ? val
                : this.clone(val, true, seen);
        }

        return newObj;
    }

}

// ---------------------------------------------------------------------------
// UpStateError
// ---------------------------------------------------------------------------

/**
 * A structured error class used for all exceptions thrown by UpState.
 * Extends the native `Error` with a machine-readable `code` property so
 * callers can programmatically distinguish error categories without parsing
 * message strings.
 *
 * @extends {Error}
 *
 * @example
 * try {
 *   UpState.set({ collection: "", state: {} });
 * } catch (err) {
 *   if (err instanceof UpStateError && err.code === "MISSING_ARG") {
 *     // handle gracefully
 *   }
 * }
 */
class UpStateError extends Error {

    /**
     * Creates a new `UpStateError`.
     *
     * @param {string} message - Human-readable description of the error.
     * @param {string} [code="GENERAL_ERROR"] - Machine-readable error
     *   category.  Common values used internally:
     *   - `"MISSING_ARG"` – a required argument was absent or empty.
     *   - `"INVALID_ARG"` – an argument was present but had an
     *     unacceptable type or value.
     *   - `"GENERAL_ERROR"` – catch-all for unexpected failures.
     */
    constructor(message, code = "GENERAL_ERROR") {
        super(message);
        this.name = "UpStateError";

        /**
         * Machine-readable error category string.
         * @type {string}
         */
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
 * An immutable wrapper returned by {@link State#get} and
 * {@link State#batchGet}.  Provides convenient accessors for consuming
 * the retrieved value as a raw primitive, an array, or a plain object,
 * plus `map`-style iteration helpers.
 *
 * `Result` objects are frozen on construction and cannot be mutated.
 *
 * @example
 * const result = UpState.get("users");
 *
 * result.raw;               // the value exactly as stored
 * result.asArray;           // always an array, regardless of underlying type
 * result.asObject;          // always a plain object
 * result.mapArray(u => u.name);   // iterate like Array.map
 * result.mapObject((v, k) => v);  // iterate like Object.entries + map
 */
class Result {

    /** @type {*} */
    #data;

    /**
     * @param {*} input - The raw value to wrap.  `undefined` and `null`
     *   are both normalised to `null` internally.
     */
    constructor(input) {
        /** @type {*} */
        this.#data = (input === undefined || input === null) ? null : input;

        Object.freeze(this);
    }

    // -----------------------------------------------------------------------
    // Accessors
    // -----------------------------------------------------------------------

    /**
     * The stored value exactly as it was retrieved from state —
     * no conversion applied.  Returns `null` if the value was
     * `undefined` or `null` at retrieval time.
     *
     * @type {*}
     * @readonly
     *
     * @example
     * UpState.get("session", "token").raw; // "abc123" | null
     */
    get raw() {
        return this.#data;
    }

    /**
     * The stored value coerced into an array.
     *
     * | Underlying type | Result |
     * |-----------------|--------|
     * | `null`          | `[]`   |
     * | Array           | the array itself |
     * | Plain object    | `Object.values(data)` |
     * | Any other value | `[data]` (single-element array) |
     *
     * @type {Array<*>}
     * @readonly
     *
     * @example
     * UpState.get("cart").asArray.forEach(item => console.log(item));
     */
    get asArray() {
        if (this.#data === null) return [];

        if (Array.isArray(this.#data)) return this.#data;

        if (typeof this.#data === "object" && Object.prototype.toString.call(this.#data) === '[object Object]') {
            return Object.values(this.#data)
        };
        return [this.#data];
    }

    /**
     * The stored value coerced into a plain object.
     *
     * | Underlying type | Result |
     * |-----------------|--------|
     * | `null`          | `{}`   |
     * | Plain object    | the object itself |
     * | Array           | `{ 0: item0, 1: item1, … }` (index-keyed) |
     * | Any other value | `{ 0: data }` |
     *
     * @type {object}
     * @readonly
     *
     * @example
     * const prefs = UpState.get("userPrefs").asObject;
     * console.log(prefs.theme);
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

    // -----------------------------------------------------------------------
    // Iteration helpers
    // -----------------------------------------------------------------------

    /**
     * Applies `callback` to each element of {@link Result#asArray} and
     * returns a new plain array of the transformed values.
     * `undefined` return values from `callback` are replaced with `null`.
     *
     * @param {function(*,number):*} callback - Receives `(item, index)`.
     * @returns {Array<*>} Transformed array.
     *
     * @example
     * const names = UpState.get("users").mapArray(u => u.name);
     */
    mapArray(callback) {
        const newArray = [];
        const currentList = this.asArray;

        for (let i = 0; i < currentList.length; i++) {
            const newValue = callback(currentList[i], i);
            newArray.push(newValue ?? null);
        }

        return newArray;
    }

    /**
     * Applies `callback` to each entry of {@link Result#asObject} and
     * returns a new plain object with the same keys but transformed values.
     * `undefined` return values from `callback` are replaced with `null`.
     *
     * @param {function(*,string):*} callback - Receives `(value, key)`.
     * @returns {object} Transformed object.
     *
     * @example
     * const uppercased = UpState.get("labels").mapObject(v => v.toUpperCase());
     */
    mapObject(callback) {
        const currentMap = this.asObject; // Call getter once
        const keys = Object.keys(currentMap);
        const newMap = {};

        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const newValue = callback(currentMap[key], key);
            newMap[key] = newValue ?? null;
        }
        return newMap;
    }
}

// ---------------------------------------------------------------------------
// StorageHandler
// ---------------------------------------------------------------------------

/**
 * Manages reading from and writing to `localStorage` / `sessionStorage`.
 *
 * All data for both storage drivers is serialised under the single key
 * {@link UPSTATE_STORAGE_KEY}.  An in-memory mirror
 * (`virtualLocalStorage`) keeps the last-known good state so that the
 * class can avoid redundant `JSON.parse` calls on every read.
 *
 * On construction the class:
 * 1. Reads both `localStorage` and `sessionStorage`.
 * 2. Strips expired entries (those whose `__upstate_exp` timestamp has
 *    passed).
 * 3. Populates `virtualLocalStorage.permanent` and
 *    `virtualLocalStorage.session` with clean, null-prototype objects.
 *
 * **Expiry envelope format** (internal, not part of the public API):
 * ```json
 * { "__upstate_exp": 1700000000000, "__upstate_data": <actual value> }
 * ```
 * A `null` value for `__upstate_exp` means the entry never expires.
 *
 * This class is instantiated once by {@link State} and is not part of the
 * public API.
 */
class StorageHandler {

    /**
     * @param {boolean} [silenceWarnings=false] - Suppresses all
     *   console output produced during storage read / parse failures.
     */
    constructor(silenceWarnings = false) {
        this.silenceWarnings = silenceWarnings;

        const strip = (raw) => {
            const parsed = Utility.JSONHydrator(raw || "{}", this.silenceWarnings);
            const now = Date.now();

            const process = (obj) => {
                const clean = Object.create(null);
                for (const key in obj) {
                    const entry = obj[key];
                    if (entry?.__upstate_exp !== undefined) {
                        if (entry.__upstate_exp === null || now < (entry.__upstate_exp ?? 0)) {
                            const data = entry.__upstate_data;
                            // Recurse if the unwrapped value is itself a collection
                            clean[key] = (data && typeof data === "object" && !Array.isArray(data))
                                ? process(data)
                                : data;
                        }
                    } else {
                        clean[key] = (entry && typeof entry === "object" && !Array.isArray(entry))
                            ? process(entry)
                            : entry;
                    }
                }
                return clean;
            };

            return process(parsed);
        };

        let local;
        let session;
        try {
            session = sessionStorage.getItem(UPSTATE_STORAGE_KEY);
        } catch (err) {
            if (!this.silenceWarnings) {
                console.warn(
                    "Failed to read session storage. Resetting session state to prevent app crash.",
                    err
                );
            }

            session = "{}";
        }

        try {
            local = localStorage.getItem(UPSTATE_STORAGE_KEY)
        } catch (err) {

            if (!this.silenceWarnings) {
                console.warn(
                    "Failed to read local storage. Resetting local state to prevent app crash.",
                    err
                );
            }

            local = "{}";
        }

        /**
         * In-memory mirror of both storage drivers, keyed by persistence
         * type.  Mutated on every `set` / `remove` call and used as the
         * source-of-truth for writes so the full JSON string is always
         * available without re-parsing storage.
         *
         * @type {{ session: object, permanent: object }}
         */
        this.virtualLocalStorage = {
            session: strip(session),
            permanent: strip(local),
        };
    }

    // -----------------------------------------------------------------------

    /**
     * Persists a value to the appropriate storage driver.
     *
     * When an `expiry` is present the value is wrapped in the internal
     * expiry envelope before being written.  The in-memory
     * `virtualLocalStorage` mirror is updated first, then the full
     * serialised state is written to the driver in one `setItem` call.
     *
     * @param {object} options
     * @param {string} options.collection - Top-level collection name.
     * @param {*} options.state - The value to persist.  Must be
     *   JSON-serialisable.
     * @param {string | undefined} options.route - Dot/slash-delimited path
     *   within the collection.  When omitted the entire collection is
     *   replaced.
     * @param {string | { type: string, expiry?: string | number }} options.persistence
     *   Persistence descriptor, passed through {@link Utility.normalizePersistence}.
     * @returns {void}
     * @throws {UpStateError} `INVALID_ARG` – if the resolved `expiry` value
     *   is not a recognised format.
     */
    set({ collection, state, route, persistence }) {
        const { type, expiry } = Utility.normalizePersistence(persistence);
        const driver = (type === "session") ? sessionStorage : localStorage;
        const localState = this.virtualLocalStorage[type] ?? {};

        // Wrap with expiry only when needed
        let resolvedExpiry;

        try {
            resolvedExpiry = Utility.resolveExpiry(expiry);
        } catch (err) {
            throw new UpStateError(err.message, err?.code || undefined)
        }

        const payload = resolvedExpiry
            ? { __upstate_exp: resolvedExpiry, __upstate_data: state }
            : state;

        if (!route) {
            localState[collection] = payload;
        } else {
            const { targetParent, targetKey } = Utility.getPathInfo(collection, route, localState, true);
            if (targetParent) targetParent[targetKey] = payload;
        }
        this.virtualLocalStorage[type] = localState;
        driver.setItem(UPSTATE_STORAGE_KEY, JSON.stringify(localState));
    }

    // -----------------------------------------------------------------------

    /**
     * Removes a value from **both** `localStorage` and `sessionStorage`.
     * Calling remove on both drivers is intentional — UpState does not
     * track which driver a given key was originally written to, so both
     * are cleaned to guarantee the entry is fully removed regardless of
     * persistence type.
     *
     * @param {string} collection - Top-level collection name.
     * @param {string | undefined} route - Dot/slash-delimited path within
     *   the collection.  When omitted the entire collection is removed.
     * @returns {void}
     */
    remove(collection, route) {

        const remove = (driver, virtualDriver) => {
            const localState = this.virtualLocalStorage[virtualDriver] ?? {};

            if (!route) {
                delete localState[collection];
            } else {
                const { targetParent, targetKey } = Utility.getPathInfo(collection, route, localState, false);
                if (targetParent) {
                    delete targetParent[targetKey];
                }
            }

            this.virtualLocalStorage[virtualDriver] = localState;

            driver.setItem(UPSTATE_STORAGE_KEY, JSON.stringify(localState));
        }

        remove(localStorage, "permanent");
        remove(sessionStorage, "session");
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * @typedef {object} SetObject
 * @property {string} collection - The top-level collection to write to.
 * @property {*} state - The value to store. Any JSON-serialisable type is
 *   accepted; `undefined` is rejected.
 * @property {string} [route] - Dot- or slash-delimited path within the
 *   collection (e.g. `"profile.address.city"`).  When omitted the entire
 *   collection is replaced.
 * @property {string | { type: "session"|"permanent", expiry?: string|number }} [persistence]
 *   Persistence override for this specific call.  Accepts a shorthand
 *   string (`"session"` or `"permanent"`) or a full descriptor object with
 *   an optional `expiry` field (see {@link Utility.resolveExpiry} for
 *   accepted formats).
 */

/**
 * @typedef {object} SubscribeObject
 * @property {string} collection - The collection to watch.
 * @property {string} [route] - Dot- or slash-delimited path within the
 *   collection.  When omitted the subscription targets the entire collection.
 * @property {function(*):void} callback - Called whenever the subscribed
 *   value changes.  Receives a clone of the new value (depth controlled by
 *   the `cloning.onSubscribe` config option).
 * @property {string} [key] - A stable string identifier for this
 *   subscription, used with {@link State#unsubscribe}.  When omitted a
 *   random UUID is generated.
 * @property {"self"|"tree"|"descendants"|"ancestors"} [propagation="self"]
 *   Controls which state changes trigger this subscription:
 *   - `"self"` (default) — fires only when the exact subscribed route changes.
 *   - `"tree"` — fires when the subscribed route **or** any ancestor/descendant
 *     route changes.
 *   - `"descendants"` — fires when a **descendant** of the subscribed route
 *     changes (useful for watching a parent that wants to know about nested updates).
 *   - `"ancestors"` — fires when an **ancestor** of the subscribed route
 *     changes (useful for a child that wants to re-read when the parent is reset).
 */

/**
 * @typedef {object} RemoveObject
 * @property {string} collection - The collection to target.
 * @property {string} [route] - Dot- or slash-delimited path to the value to
 *   remove.  When omitted the entire collection is deleted.
 */

/**
 * @typedef {object} ConfigOptions
 * @property {Object.<string, string|{ type: string, expiry?: string|number }>} [persistentCollections={}]
 *   A map of collection names to persistence descriptors.  Each listed
 *   collection is automatically written to storage on every `set()` call.
 *   Example: `{ auth: "session", userPrefs: { type: "permanent", expiry: "30d" } }`
 * @property {boolean} [allowEventDispatches=true]
 *   When `false`, UpState will not dispatch `"update"` or `"purge"`
 *   `CustomEvent`s on itself.  Useful in SSR or test environments.
 * @property {boolean} [silenceWarnings=false]
 *   Suppresses all UpState `console.warn` / `console.error` output.
 * @property {"deep"|"shallow"|"off" | { onSet?: "deep"|"shallow"|"off", onGet?: "deep"|"shallow"|"off", onSubscribe?: "deep"|"shallow"|"off" }} [cloning="deep"]
 *   Controls when UpState clones values to prevent external mutations
 *   from leaking into the store (and vice-versa).  Pass a single string
 *   to apply the same mode to all three operations, or an object to
 *   configure each independently:
 *   - `"deep"` — full deep clone via `structuredClone` (safest, default).
 *   - `"shallow"` — one-level spread clone (faster, but nested objects are
 *     shared references).
 *   - `"off"` — no cloning (fastest, use only when you manage immutability
 *     yourself).
 * @property {boolean} [unsubscribeOnDelete=true]
 *   When `true` (default), deleting a collection automatically unsubscribes
 *   all active subscriptions for that collection to prevent memory leaks.
 *   When `false`, existing subscriptions survive the delete and a warning
 *   is logged.
 */

/**
 * @typedef {object} DebugAPI
 * @property {function():object} stateSnapshot
 *   Returns a deep clone of the entire internal state object — useful for
 *   logging or assertions in tests without risk of accidental mutation.
 * @property {function(string):string[]} routes
 *   Returns a flat list of every dot-separated route path within the given
 *   collection.  Includes nested paths (e.g. `["profile", "profile.name",
 *   "profile.address", "profile.address.city"]`).
 * @property {function():object} activeSubscriptions
 *   Returns a nested snapshot of all current subscriptions, keyed by
 *   `collection → route → [{ key, propagation }]`.
 *   Collection-level subscriptions appear under the key
 *   `"<entire-collection>"`.
 * @property {function():string[]} collections
 *   Returns an array of all currently registered collection names.
 * @property {function(string, string):object} routeInspect
 *   Returns a diagnostic object for the value at the given collection/route:
 *   `{ exists: boolean, type: string, collection: string, route: string|null, value: * }`.
 * @property {function(string, string?):boolean} has
 *   Returns `true` if the given collection (and optional route) currently
 *   exists in state.
 * @property {function():object} metrics
 *   Returns runtime metrics: `{ version, collections, subscriptions,
 *   splitRouteCaches }`.
 * @property {function():object} persistence
 *   Returns a snapshot of all collections registered as persistent via
 *   `config({ persistentCollections })`, along with their persistence
 *   descriptors.
 * @property {function():{ cleared: number }} clearSplitRouteCache
 *   Manually clears the internal LRU cache used to avoid re-splitting
 *   route strings.  Returns the number of entries cleared.  Rarely needed
 *   outside of memory-pressure scenarios.
 * @property {function():object} splitRouteCacheInfo
 *   Returns the current size and key list of the split-route LRU cache.
 * @property {function({ collection?: string, route?: string, key?: string, ttl?: number }):function():void} trace
 *   Attaches a temporary subscription that logs every change to the given
 *   `collection`/`route` to the console.  The trace automatically stops
 *   after `ttl` milliseconds (default: 60 000 ms / 1 minute).
 *   Returns a `stopTrace()` function for manual early termination.
 * @property {function():string} version
 *   Prints the UpState banner to the console and returns the version string.
 */

/**
 * The core UpState reactive state engine.  Extends `EventTarget` so that
 * plain DOM-style event listeners can observe `"update"` and `"purge"` events
 * on top of the subscription system.
 *
 * You do not normally instantiate this class directly — instead, import
 * the default export (`UpState`), which is a frozen singleton instance.
 *
 * ```js
 * import UpState from "./upstate.js";
 *
 * UpState.set({ collection: "user", state: { name: "Alice" } });
 * const name = UpState.get("user", "name").raw; // "Alice"
 * ```
 *
 * **Events dispatched on `UpState` (as a `EventTarget`):**
 *
 * | Event | `detail` shape | Fired when |
 * |-------|---------------|------------|
 * | `"update"` | `{ collection, route, destination, state, action: "set" }` | A single `set()` completes |
 * | `"update"` | `{ action: "batchSet", count, routeMap }` | A `batchSet()` completes |
 * | `"update"` | `{ collection, route, destination, state, action: "remove" }` | A single `remove()` completes |
 * | `"update"` | `{ action: "batchRemove", count, routeMap }` | A `batchRemove()` completes |
 * | `"purge"` | `{ timestamp: number }` | `purge()` completes |
 *
 * @extends {EventTarget}
 */
class State extends EventTarget {

    /** @type {object} Internal null-prototype root state object. */
    #state = Object.create(null);

    /**
     * Maps collection names to their normalised persistence descriptor.
     * Populated by `config({ persistentCollections })`.
     * @type {Map<string, { type: string, expiry: string|number }>}
     */
    #persistentCollections = new Map();

    /**
     * Per-collection LRU cache of pre-split route arrays (max 1 000
     * entries per collection) to avoid repeatedly calling
     * `String.prototype.split` on the same route strings.
     * @type {Map<string, Map<string, string[]>>}
     */
    #splitRouteCache = new Map();

    /**
     * Maps subscription keys to their `unsub()` closure, enabling O(1)
     * unsubscription by key.
     * @type {Map<string, function():void>}
     */
    #unsubCallbacks = new Map();

    /**
     * Nested map: `collection → (route | FIREONENTIRECOLLECTION) → { splitRoute, routeNode }`.
     * @type {Map<string, Map<symbol|string, { splitRoute: string[], routeNode: Map<string, object> }>>}
     */
    #subscriptions = new Map();

    /** @type {boolean} */
    #allowEventDispatches = true;

    /** @type {boolean} */
    #unsubscribeOnDelete = true;

    /** @type {boolean} */
    #silenceWarnings = false;

    /**
     * @type {{ onSet: "deep"|"shallow"|"off", onGet: "deep"|"shallow"|"off", onSubscribe: "deep"|"shallow"|"off" }}
     */
    #cloningOptions = {
        onSet: "deep",
        onGet: "deep",
        onSubscribe: "deep"
    }

    /**
     * Frozen object containing all debug/introspection utilities.
     * See {@link DebugAPI} for the full API surface.
     *
     * @type {Readonly<DebugAPI>}
     *
     * @example
     * UpState.debug.stateSnapshot();
     * UpState.debug.metrics();
     * UpState.debug.trace({ collection: "user", ttl: 30000 });
     */
    debug;

    constructor() {
        super();

        this.storageHandlerInstance = new StorageHandler(this.#silenceWarnings);

        this.#state = Utility.deepMerge(
            this.storageHandlerInstance.virtualLocalStorage.permanent,
            this.storageHandlerInstance.virtualLocalStorage.session,
        );

        /**
         * Alias for `EventTarget.addEventListener`.
         * @type {function(string, EventListenerOrEventListenerObject, AddEventListenerOptions=):void}
         */
        this.on = this.addEventListener.bind(this);

        /**
         * Alias for `EventTarget.removeEventListener`.
         * @type {function(string, EventListenerOrEventListenerObject, EventListenerOptions=):void}
         */
        this.off = this.removeEventListener.bind(this);

        this.debug = Object.freeze(
            Object.assign(Object.create(null), {
                // Data Snapshots
                stateSnapshot: () => this.#stateSnapshot(),
                routes: (collection) => this.#routes(collection),
                activeSubscriptions: () => this.#activeSubscriptions(),
                collections: () => this.#collections(),

                // Logic & Metrics
                routeInspect: (collection, route) => this.#routeInspect(collection, route),
                has: (collection, route) => this.#has(collection, route),
                metrics: () => this.#metrics(),
                persistence: () => this.#persistence(),
                clearSplitRouteCache: () => this.#clearSplitRouteCache(),
                splitRouteCacheInfo: () => this.#splitRouteCacheInfo(),
                trace: (options = {}) => this.#trace(options),
                version: () => {
                    printSignature();
                    return VERSION;
                },
            })
        );
    }

    // =========================================================================
    // config
    // =========================================================================

    /**
     * Configures global UpState behaviour.  Should be called once, early in
     * the application lifecycle (e.g. in your entry-point file), before any
     * calls to `set()` or `subscribe()`.
     *
     * All options are optional and have sensible defaults — calling `config`
     * is only necessary when you want to deviate from those defaults.
     *
     * @param {ConfigOptions} options
     * @returns {void}
     * @throws {UpStateError} `MISSING_ARG` — if `cloning` contains an
     *   unrecognised value.
     * @throws {UpStateError} `INVALID_ARG` — if `persistentCollections` is an
     *   array rather than a plain object.
     *
     * @example
     * UpState.config({
     *   persistentCollections: {
     *     userPrefs: "permanent",
     *     session:   { type: "session", expiry: "8h" },
     *   },
     *   cloning: { onSet: "deep", onGet: "shallow", onSubscribe: "deep" },
     *   silenceWarnings: true,
     * });
     */
    config({
        persistentCollections = {},
        allowEventDispatches = true,
        silenceWarnings = false,
        cloning = "deep",
        unsubscribeOnDelete = true,

    }) {
        this.#allowEventDispatches = !!allowEventDispatches;
        this.#silenceWarnings = !!silenceWarnings;
        this.#unsubscribeOnDelete = !!unsubscribeOnDelete;

        const optionMap = new Set(["deep", "shallow", "off"]);
        if (typeof cloning === "string") {


            if (optionMap.has(cloning)) {
                this.#cloningOptions = {
                    onSet: cloning,
                    onGet: cloning,
                    onSubscribe: cloning
                }

            } else throw new UpStateError(
                "'cloning' values can only either be 'deep', 'shallow' or 'off'",
                "MISSING_ARG"
            );

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

        if (persistentCollections !== undefined) {
            if (persistentCollections && !Array.isArray(persistentCollections)) {
                for (const collectionKey in persistentCollections) {
                    const persistence = persistentCollections[collectionKey];
                    const state = this.#state[collectionKey] || {};

                    if (state !== undefined) {
                        this.#persistentCollections.set(collectionKey, Utility.normalizePersistence(persistence));
                        this.storageHandlerInstance.set({ collection: collectionKey, state, persistence });
                    }
                }
            } else throw new UpStateError(
                "'persistentCollections' value has to be an object mapping 'collection' to 'persistence' type",
                "INVALID_ARG"
            );
        }

    }

    // =========================================================================
    // subscribe / batchSubscribe / unsubscribe / batchUnsubscribe
    // =========================================================================

    /**
     * Registers a callback that fires whenever the target value changes.
     *
     * Subscriptions are lightweight — they are stored in a nested `Map`
     * structure and resolved in a single pass during each state update with
     * no diffing overhead.
     *
     * **Propagation modes** — controls which changes trigger the callback:
     *
     * | Mode | Fires when… |
     * |------|-------------|
     * | `"self"` (default) | The subscribed route itself changes |
     * | `"tree"` | The subscribed route **or** any route that shares a path prefix changes |
     * | `"descendants"` | A **descendant** of the subscribed route changes |
     * | `"ancestors"` | An **ancestor** of the subscribed route changes |
     *
     * @param {SubscribeObject} options
     * @returns {function():void} An `unsub()` function.  Call it to
     *   unregister this specific subscription.
     * @throws {UpStateError} `MISSING_ARG` — `collection` or `callback` is absent.
     * @throws {UpStateError} `INVALID_ARG` — any argument has the wrong type,
     *   `propagation` is not a recognised value, or `key` is already in use.
     *
     * @example <caption>Basic subscription</caption>
     * const unsub = UpState.subscribe({
     *   collection: "user",
     *   route: "profile.name",
     *   callback: (name) => console.log("Name changed:", name),
     * });
     * // Later:
     * unsub();
     *
     * @example <caption>Watching an entire collection with a stable key</caption>
     * UpState.subscribe({
     *   collection: "cart",
     *   key: "cart-watcher",
     *   callback: (cart) => renderCart(cart),
     * });
     *
     * @example <caption>Propagation — parent notified when any child changes</caption>
     * UpState.subscribe({
     *   collection: "settings",
     *   route: "theme",
     *   propagation: "descendants",
     *   callback: (themeSection) => applyTheme(themeSection),
     * });
     */
    subscribe({ collection, route, callback, key, propagation = "none" } = {}) {
        const propagationOptions = new Set(["none", "both", "up", "down"]);
        const publicPropagationOptions = new Set(["self", "tree", "descendants", "ancestors"]);

        switch (propagation) {
            case "self": propagation = "none"; break;
            case "tree": propagation = "both"; break;
            case "descendants": propagation = "up"; break;
            case "ancestors": propagation = "down"; break;
        }

        if (!propagationOptions.has(propagation)) {
            throw new UpStateError(
                `'propagation' must be one of: ${[...publicPropagationOptions].join(", ")}`,
                "INVALID_ARG"
            );
        }

        if (collection === undefined || collection === "") {
            throw new UpStateError("'collection' name is required", "MISSING_ARG");
        }

        if (route && typeof route !== "string") {
            throw new UpStateError("'route' value has to be a String", "INVALID_ARG");
        }

        if (typeof collection !== "string") {
            throw new UpStateError("'collection' value has to be a String", "INVALID_ARG");
        }

        if (callback === undefined) {
            throw new UpStateError("'subscription' callback is required", "MISSING_ARG");
        }

        if (typeof callback !== "function") {
            throw new UpStateError("'subscription' callback has to be a function", "INVALID_ARG");
        }

        if (key && typeof key !== "string") {
            throw new UpStateError("'key' value has to be a string", "INVALID_ARG");
        }

        if (this.#unsubCallbacks.has(key)) {
            throw new UpStateError("the 'key' entered is already in use", "INVALID_ARG");
        }

        key = key ?? crypto.randomUUID();

        route = route ?? FIREONENTIRECOLLECTION;

        if (!this.#subscriptions.has(collection)) {
            this.#subscriptions.set(collection, new Map());
        }

        const routeMap = this.#subscriptions.get(collection);

        if (!routeMap.has(route)) {
            const subObj = {
                splitRoute: (route === FIREONENTIRECOLLECTION)
                    ? [] : route.split(/[./]/),

                routeNode: new Map(),
            }
            routeMap.set(route, subObj);
        }

        const subscriptionObj = routeMap.get(route);

        const routeNode = Object.freeze({
            route,
            propagation,
            callback,
            key
        });

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
        }

        this.#unsubCallbacks.set(key, unsub);

        return unsub;
    }

    // -----------------------------------------------------------------------

    /**
     * Registers multiple subscriptions in one call.  Equivalent to calling
     * {@link State#subscribe} for each item in the array.
     *
     * All items **must** include a `key` property — the return value maps
     * each `key` to its corresponding `unsub()` function.
     *
     * @param {SubscribeObject[]} arrayOfSubscriptionObjects - Each object
     *   must satisfy the same requirements as the argument to
     *   {@link State#subscribe}, and **must** include a `key`.
     * @returns {Object.<string, function():void>} A map of `{ key: unsub }`.
     * @throws {UpStateError} `INVALID_ARG` — argument is not an array, or
     *   any individual subscription object fails validation.
     *
     * @example
     * const unsubs = UpState.batchSubscribe([
     *   { collection: "user",  route: "name",  key: "user-name",  callback: onName },
     *   { collection: "cart",                  key: "cart-watch", callback: onCart },
     * ]);
     * // To remove all at once:
     * Object.values(unsubs).forEach(fn => fn());
     */
    batchSubscribe(arrayOfSubscriptionObjects) {
        if (!Array.isArray(arrayOfSubscriptionObjects)) {
            throw new UpStateError(
                "'batchSubscribe' was expecting an array of objects meant for the subscribe method",
                "INVALID_ARG"
            );
        }

        const unsubs = {};

        arrayOfSubscriptionObjects.forEach(obj => {
            unsubs[obj.key] = this.subscribe(obj)
        });

        return unsubs;
    }

    // -----------------------------------------------------------------------

    /**
     * Unregisters a subscription by its `key` string.
     *
     * If the removed subscription was the last one for its route, the route
     * entry is cleaned up automatically.  If it was also the last route for
     * its collection, the collection entry is removed too.
     *
     * @param {string} key - The stable key that was provided (or auto-generated)
     *   when the subscription was created.
     * @returns {void}
     * @throws {UpStateError} `INVALID_ARG` — `key` is not a string, or no
     *   subscription with that key exists.
     *
     * @example
     * UpState.subscribe({ collection: "user", key: "my-sub", callback: fn });
     * UpState.unsubscribe("my-sub");
     */
    unsubscribe(key) {

        if (typeof key !== "string") {
            throw new UpStateError("'key' has to be a string", "INVALID_ARG");
        }
        if (!this.#unsubCallbacks.has(key)) {
            throw new UpStateError(`no subscription found for key "${key}"`, "INVALID_ARG");
        }

        this.#unsubCallbacks.get(key)();
    }

    // -----------------------------------------------------------------------

    /**
     * Unregisters multiple subscriptions by key in one call.  Equivalent to
     * calling {@link State#unsubscribe} for each key in the array.
     *
     * @param {string[]} keys - Array of subscription key strings.
     * @returns {void}
     * @throws {UpStateError} `INVALID_BATCH_UNSUB_ARGUMENT` — argument is
     *   not an array.
     * @throws {UpStateError} `INVALID_ARG` — any key in the array is invalid
     *   or not found (thrown by the underlying `unsubscribe` call).
     *
     * @example
     * UpState.batchUnsubscribe(["user-name", "cart-watch", "session-exp"]);
     */
    batchUnsubscribe(keys) {
        if (!Array.isArray(keys)) {
            throw new UpStateError(
                "'batchUnsubscribe' was expecting an array of keys",
                "INVALID_BATCH_UNSUB_ARGUMENT"
            );
        }

        keys.forEach(key => this.unsubscribe(key));
    }

    // =========================================================================
    // Internal subscription-firing helpers
    // =========================================================================

    /**
     * Compares two pre-split route arrays and returns a set of boolean flags
     * indicating their directional relationship.  Used to evaluate
     * propagation rules without re-splitting strings on every fire.
     *
     * @param {string[]} splitFired - The route segments of the route that
     *   just changed.
     * @param {string[]} splitSub - The route segments of the subscription
     *   being evaluated.
     * @returns {{ both: boolean, up: boolean, down: boolean }}
     *   - `both` — the two routes share a common prefix (either is a
     *     prefix of the other, or they are equal).
     *   - `up` — `splitSub` is at or above `splitFired` in the tree
     *     (the subscription is an ancestor or equal).
     *   - `down` — `splitSub` is at or below `splitFired` in the tree
     *     (the subscription is a descendant or equal).
     * @private
     */
    #compareRoutes(splitFired, splitSub) {
        const shorter = Math.min(splitFired.length, splitSub.length);
        let sharedPrefix = true;

        for (let i = 0; i < shorter; i++) {
            if (splitFired[i] !== splitSub[i]) {
                sharedPrefix = false;
                break;
            }
        }

        return {
            both: sharedPrefix,
            up: sharedPrefix && splitSub.length <= splitFired.length,
            down: sharedPrefix && splitFired.length <= splitSub.length,
        };
    }

    /**
     * Fires all subscribers in `routeMap` when an entire collection has been
     * set (i.e. no specific route was targeted).
     *
     * - Subscribers with `propagation: "self"` and a specific route are
     *   skipped (they should only fire when their exact route changes).
     * - All other subscribers receive the value at their own subscribed path:
     *   collection-level subscribers receive the full collection; route-level
     *   subscribers receive the value at their specific route.
     *
     * @param {Map} routeMap - The route → subscription map for the collection.
     * @param {string} collection - The collection name.
     * @param {Set<string>} firedCallbacks - Accumulates keys of callbacks
     *   already fired in this pass to prevent duplicate invocations.
     * @private
     */
    #fireEntireCollection(routeMap, collection, firedCallbacks) {

        routeMap.forEach((value) => {
            value.routeNode.forEach((v) => {
                if (firedCallbacks.has(v.key)) return;
                firedCallbacks.add(v.key);

                // "none" only fires when its exact route is targeted.
                // For collection-level subs that means a full-collection set(), not a route change.
                if (v.propagation !== "none" || v.route === FIREONENTIRECOLLECTION) {
                    let data;
                    if (v.route === FIREONENTIRECOLLECTION) {
                        data = this.#cloneValue(
                            this.#state[collection],
                            this.#cloningOptions.onSubscribe
                        );
                    } else {
                        const { targetParent, targetKey } = Utility.getPathInfo(collection, v.route, this.#state);
                        data = this.#cloneValue(
                            targetParent?.[targetKey],
                            this.#cloningOptions.onSubscribe
                        );
                    }

                    v.callback(data);
                }
            });
        });
    }

    /**
     * Fires subscribers in `routeMap` when a specific route within a
     * collection has changed.
     *
     * The fired route is split and cached in the per-collection LRU cache
     * (max 1 000 entries per collection).  For each registered subscription,
     * propagation rules are evaluated via {@link State#compareRoutes} and the
     * subscriber receives the value at its own subscribed route (not
     * necessarily the changed route).
     *
     * @param {Map} routeMap - The route → subscription map for the collection.
     * @param {string} collection - The collection name.
     * @param {string} route - The specific route that changed.
     * @param {Set<string>} firedCallbacks - Accumulates keys of callbacks
     *   already fired to prevent duplicate invocations.
     * @private
     */
    #fireSpecificRoute(routeMap, collection, route, firedCallbacks) {
        if (!this.#splitRouteCache.has(collection)) {
            this.#splitRouteCache.set(collection, new Map());
        }

        const collectionCache = this.#splitRouteCache.get(collection);

        if (!collectionCache.has(route)) {
            if (collectionCache.size >= 1000) {
                collectionCache.delete(collectionCache.keys().next().value);
            }
            collectionCache.set(route, route.split(/[./]/));
        } else {
            // Re-insert to mark as recently used
            const val = collectionCache.get(route);
            collectionCache.delete(route);
            collectionCache.set(route, val);
        }

        const splitFired = collectionCache.get(route);

        for (const [key, value] of routeMap) {

            if (key === FIREONENTIRECOLLECTION) {
                // A collection-level subscriber with propagation "none" means:
                // "only fire when the whole collection is set", so skip it here.
                const collectionState = this.#cloneValue(
                    this.#state[collection],
                    this.#cloningOptions.onSubscribe
                );

                value.routeNode.forEach((v) => {
                    if (firedCallbacks.has(v.key)) return;
                    firedCallbacks.add(v.key);

                    if (v.propagation !== "none") {
                        v.callback(collectionState);
                    }
                });

            } else {
                const match = this.#compareRoutes(splitFired, value.splitRoute);
                const { targetParent, targetKey } = Utility.getPathInfo(collection, key, this.#state);
                const data = this.#cloneValue(
                    targetParent?.[targetKey],
                    this.#cloningOptions.onSubscribe
                );

                value.routeNode.forEach((v) => {
                    if (firedCallbacks.has(v.key)) return;
                    firedCallbacks.add(v.key);

                    switch (v.propagation) {
                        case "up": if (match.up) v.callback(data); break;
                        case "down": if (match.down) v.callback(data); break;
                        case "both": if (match.both) v.callback(data); break;
                        case "none": if (route === v.route) v.callback(data); break;
                    }
                });
            }
        }
    }

    /**
     * Orchestrator that routes a state-change notification to either
     * {@link State#fireEntireCollection} or {@link State#fireSpecificRoute}
     * depending on whether a specific route was provided.
     *
     * A `firedCallbacks` Set is created fresh for each notification cycle to
     * ensure every subscriber fires at most once per change, even when
     * propagation could otherwise reach it via multiple paths.
     *
     * @param {string} collection - The collection that changed.
     * @param {string | undefined} route - The specific route that changed,
     *   or `undefined` to indicate the whole collection was replaced.
     * @returns {void}
     * @private
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
     * Clones `value` according to the requested cloning `mode`.
     * Primitives and `null` are always returned as-is (no cloning needed).
     *
     * @param {*} value - The value to (possibly) clone.
     * @param {"deep"|"shallow"|"off"} mode - The cloning strategy.
     * @returns {*} Cloned or original value.
     * @private
     */
    #cloneValue(value, mode) {
        if (!value || typeof value !== "object") return value;
        switch (mode) {
            case "off": return value;
            case "shallow": return Array.isArray(value) ? [...value] : { ...value };
            default: return Utility.clone(value, this.#silenceWarnings);
        }
    }

    // =========================================================================
    // set / batchSet
    // =========================================================================

    /**
     * Writes a value to state and notifies affected subscribers.
     *
     * When `route` is omitted the entire collection is replaced.  When
     * `route` is provided only the nested value at that path is updated;
     * missing intermediate objects are created automatically.
     *
     * If the collection was registered as persistent via
     * `config({ persistentCollections })`, or if a `persistence` option is
     * supplied on this call, the value is also written to the appropriate
     * Web Storage driver.
     *
     * After writing, an `"update"` `CustomEvent` is dispatched on the
     * `UpState` instance (unless `allowEventDispatches` is `false`).
     *
     * @param {SetObject} setObject
     * @returns {void}
     * @throws {UpStateError} `MISSING_ARG` — `collection` is absent or empty,
     *   or `state` is `undefined`.
     * @throws {UpStateError} `INVALID_ARG` — `collection` is not a string,
     *   `persistence` is malformed, or the resolved persistence `type` is
     *   neither `"session"` nor `"permanent"`.
     *
     * @example <caption>Replace an entire collection</caption>
     * UpState.set({ collection: "user", state: { name: "Alice", age: 30 } });
     *
     * @example <caption>Update a nested route</caption>
     * UpState.set({ collection: "user", route: "address.city", state: "Nairobi" });
     *
     * @example <caption>Persist to sessionStorage with a 4-hour expiry</caption>
     * UpState.set({
     *   collection: "auth",
     *   state: { token: "abc123" },
     *   persistence: { type: "session", expiry: "4h" },
     * });
     */
    set(setObject = {}) { this.#factorySet(setObject) }

    /**
     * Internal implementation shared by {@link State#set} and
     * {@link State#batchSet}.
     *
     * @param {SetObject} setObject
     * @param {{ fireSubscriptionCallbacks?: boolean, dispatchUpdateEvent?: boolean }} [options]
     * @private
     */
    #factorySet(
        { collection, state, route, persistence },
        { fireSubscriptionCallbacks = true, dispatchUpdateEvent = true } = {}) {

        fireSubscriptionCallbacks = !!fireSubscriptionCallbacks;

        if (collection === undefined || collection === "") {
            throw new UpStateError("'collection' value has to be be a String", "MISSING_ARG");
        }

        if (typeof collection !== "string") {
            throw new UpStateError("'collection' can only be a String", "INVALID_ARG");
        }

        // Avoid falsy checks — they would incorrectly reject valid values like 0, false, []
        if (state === undefined) {
            throw new UpStateError("state value cannot be undefined", "INVALID_ARG");
        }

        state = (typeof state === 'object' && state !== null)
            ? this.#cloneValue(state, this.#cloningOptions.onSet)
            : state;

        const destination = {};

        if (!route) {
            this.#state[collection] = state;
            destination.targetParent = this.#state;
            destination.targetKey = collection;

            if (fireSubscriptionCallbacks) {
                this.#fireSubscriptionCallbacks(collection);
            }
        } else {
            const { targetParent, targetKey } = Utility.getPathInfo(collection, route, this.#state, true);
            destination.targetParent = targetParent;
            destination.targetKey = targetKey;
            if (targetParent) {
                targetParent[targetKey] = state;

                if (fireSubscriptionCallbacks) {
                    this.#fireSubscriptionCallbacks(collection, route);
                }
            }
        }

        // Call-level persistence takes priority — only fall back to config if no valid value was provided
        // Normalize: accept string shorthand or full object
        if (persistence !== undefined) {
            if (typeof persistence === "string") {

                persistence = { type: persistence, expiry: "never" };

            } else if (typeof persistence === "object" && persistence !== null && !Array.isArray(persistence)) {
                if (!persistence.type) {
                    throw new UpStateError("persistence object must include a 'type' of 'session' or 'permanent'", "INVALID_ARG");
                }
            } else {
                throw new UpStateError("'persistence' must be a string or an object with a 'type' property", "INVALID_ARG");
            }
        }

        // Fall back to collection-level config if no call-level persistence
        persistence = persistence ?? this.#persistentCollections.get(collection);

        if (persistence) {
            const type = String(persistence.type).toLowerCase();
            if (type !== "permanent" && type !== "session") {
                throw new UpStateError("'persistence' type can only be either 'session' or 'permanent'", "INVALID_ARG");
            }
            this.storageHandlerInstance.set({ collection, state, route, persistence });
        }

        if (dispatchUpdateEvent && this.#allowEventDispatches) {

            this.dispatchEvent(new CustomEvent("update", {
                detail: { collection, route, destination, state, action: "set" },
                cancelable: true,
            }));
        }
    }

    // =========================================================================
    // get / batchGet
    // =========================================================================

    /**
     * Reads a value from state and returns it wrapped in a {@link Result}.
     *
     * Can be called in two forms:
     * - **Positional:** `get(collection, route?)`
     * - **Object:** `get({ collection, route? })`
     *
     * When called with no arguments, the entire state tree is returned.
     * When called with only a `collection`, the whole collection is returned.
     * When called with a `route`, the value at that nested path is returned.
     *
     * The returned value is cloned according to the `cloning.onGet` option
     * (default: deep clone), so mutations to the returned value will not
     * affect the store.
     *
     * @param {string | { collection: string, route?: string } | undefined} [collectionOrObject]
     *   Collection name, or an object `{ collection, route }`.  When omitted,
     *   the entire state is returned.
     * @param {string} [route] - Dot/slash-delimited path within the collection.
     *   Ignored when the first argument is an object (use `object.route` instead).
     * @returns {Result} A {@link Result} wrapping the retrieved value.
     *   Returns `new Result(null)` if the collection does not exist.
     * @throws {UpStateError} `MISSING_ARG` — `collection` is an empty string.
     * @throws {UpStateError} `INVALID_ARG` — `collection` is not a string.
     *
     * @example <caption>Positional form</caption>
     * const city = UpState.get("user", "address.city").raw;
     *
     * @example <caption>Object form</caption>
     * const city = UpState.get({ collection: "user", route: "address.city" }).raw;
     *
     * @example <caption>Entire collection as array</caption>
     * const users = UpState.get("users").asArray;
     *
     * @example <caption>Map over results</caption>
     * const names = UpState.get("users").mapArray(u => u.name);
     */
    get(collectionOrObject, route) {
        let collection = collectionOrObject;

        if (typeof collectionOrObject === "object" && collectionOrObject !== null) {
            collection = collectionOrObject.collection;
            route = collectionOrObject.route;
        }

        if (collection === undefined) return new Result(this.#cloneValue(this.#state, this.#cloningOptions.onGet));

        if (collection === "") {
            throw new UpStateError("'collection' value has to be be a String", "MISSING_ARG");
        }

        if (typeof collection !== "string") {
            throw new UpStateError("'collection' value has to be be a String", "INVALID_ARG");
        }

        if (!(collection in this.#state)) return new Result(null);

        if (!route) return new Result(this.#cloneValue(this.#state[collection], this.#cloningOptions.onGet));

        const { targetParent, targetKey } = Utility.getPathInfo(collection, route, this.#state);
        const outputValue = targetParent?.[targetKey];
        const output = (typeof outputValue === 'object' && outputValue !== null)
            ? this.#cloneValue(outputValue, this.#cloningOptions.onGet)
            : outputValue;

        return new Result(output);
    }

    // =========================================================================
    // remove / batchRemove
    // =========================================================================

    /**
     * Removes a value from state and notifies affected subscribers.
     *
     * Can be called in two forms:
     * - **Positional:** `remove(collection, route?)`
     * - **Object:** `remove({ collection, route? })`
     *
     * When `route` is omitted the entire collection is deleted.  When
     * `unsubscribeOnDelete` is `true` (the default), all subscriptions for
     * that collection are also automatically removed.
     *
     * The removed value is also deleted from both `localStorage` and
     * `sessionStorage` regardless of which driver it was originally written to.
     *
     * After removal, an `"update"` `CustomEvent` is dispatched on the
     * `UpState` instance (unless `allowEventDispatches` is `false`).
     *
     * @param {string | RemoveObject} collectionOrObject - Collection name, or
     *   an object `{ collection, route? }`.
     * @param {string} [route] - Dot/slash-delimited path to remove.  Ignored
     *   when the first argument is an object.
     * @returns {void}
     * @throws {UpStateError} `MISSING_ARG` — `collection` is absent or empty.
     * @throws {UpStateError} `INVALID_ARG` — `collection` is not a string.
     *
     * @example <caption>Remove a specific nested value</caption>
     * UpState.remove("user", "address.city");
     *
     * @example <caption>Delete an entire collection</caption>
     * UpState.remove("auth");
     *
     * @example <caption>Object form</caption>
     * UpState.remove({ collection: "user", route: "tempToken" });
     */
    remove(collectionOrObject, route) {

        let collection = collectionOrObject;

        if (typeof collectionOrObject === "object" && collectionOrObject !== null) {
            collection = collectionOrObject.collection;
            route = collectionOrObject.route;
        }

        this.#factoryRemove(collection, route)
    }

    /**
     * Internal implementation shared by {@link State#remove} and
     * {@link State#batchRemove}.
     *
     * @param {string} collection
     * @param {string | undefined} route
     * @param {{ dispatchUpdateEvent?: boolean, fireSubscriptionCallbacks?: boolean }} [options]
     * @returns {object | undefined} The parent object from which the value was
     *   deleted, or `undefined` if the target was not found.
     * @private
     */
    #factoryRemove(collection, route, { dispatchUpdateEvent = true, fireSubscriptionCallbacks = true } = {}) {

        fireSubscriptionCallbacks = !!fireSubscriptionCallbacks;
        if (collection === undefined || collection === "") {
            throw new UpStateError("'collection' value has to be be a String", "MISSING_ARG");
        }

        if (typeof collection !== "string") {
            throw new UpStateError("'collection' value has to be be a String", "INVALID_ARG");
        }

        const destination = {};

        if (!route) {
            destination.targetParent = this.#state;
            destination.targetKey = collection;
            delete this.#state[collection];

            this.#splitRouteCache.delete(collection);

            if (this.#subscriptions.has(collection)) {
                const subs = this.#subscriptions.get(collection);

                if (!this.#silenceWarnings && !this.#unsubscribeOnDelete) {
                    console.warn(`the removed collection '${collection}' has active subscriptions that may cause memory leaks or unintended behavior. Consider enabling 'unsubscribeOnDelete' in the config to automatically remove them `)
                }

                if (this.#unsubscribeOnDelete) {
                    subs.forEach((value) => {
                        value.routeNode.forEach((v) => {
                            this.#unsubCallbacks.get(v.key)?.();
                        });
                    });

                    if (!this.#silenceWarnings) {
                        console.warn(`all subscriptions attached to the collection'${collection}' have been removed`)
                    }
                }
            }

            if (fireSubscriptionCallbacks) {
                this.#fireSubscriptionCallbacks(collection);
            }

        } else {
            const { targetParent, targetKey } = Utility.getPathInfo(collection, route, this.#state, false);
            destination.targetParent = targetParent;
            destination.targetKey = targetKey;
            if (targetParent && targetKey in targetParent) {
                delete targetParent[targetKey];

                if (this.#splitRouteCache.has(collection)) {
                    const collectionCache = this.#splitRouteCache.get(collection);

                    collectionCache.delete(route);
                }

                if (fireSubscriptionCallbacks) {
                    this.#fireSubscriptionCallbacks(collection, route);
                }

            }
        }

        this.storageHandlerInstance.remove(collection, route);

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

    // =========================================================================
    // batchSet / batchGet / batchRemove
    // =========================================================================

    /**
     * Applies multiple `set` operations atomically with respect to subscriber
     * notifications — all writes happen first, then each unique
     * `(collection, route)` pair fires its subscribers exactly once.
     *
     * This prevents intermediate states from being observed by subscribers
     * when several interdependent values need to change together.
     *
     * A single `"update"` `CustomEvent` with `action: "batchSet"` is
     * dispatched after all writes and notifications complete.
     *
     * @param {SetObject[]} arrayOfSetObjects - Array of objects, each
     *   satisfying the same requirements as the argument to {@link State#set}.
     * @returns {void}
     * @throws {UpStateError} `INVALID_ARG` — argument is not an array, or
     *   any individual set object fails validation.
     *
     * @example
     * UpState.batchSet([
     *   { collection: "user",    state: { name: "Alice" } },
     *   { collection: "session", state: { token: "xyz" }, persistence: "session" },
     *   { collection: "ui",      route: "theme", state: "dark" },
     * ]);
     */
    batchSet(arrayOfSetObjects) {
        if (!Array.isArray(arrayOfSetObjects)) {
            throw new UpStateError(
                "was expecting an array of objects meant for the Upstate.set method",
                "INVALID_ARG"
            );
        }
        const changedRoutes = new Map(); // collection → Set of routes

        arrayOfSetObjects.forEach(setObject => {
            this.#factorySet(setObject, { fireSubscriptionCallbacks: false, dispatchUpdateEvent: false });

            if (!changedRoutes.has(setObject.collection)) changedRoutes.set(setObject.collection, new Set());

            changedRoutes.get(setObject.collection).add(setObject.route || null);

        });

        changedRoutes.forEach((routes, collection) => {

            routes.forEach(route => {
                this.#fireSubscriptionCallbacks(collection, route ?? undefined);
            });
        });

        if (this.#allowEventDispatches) {
            this.dispatchEvent(new CustomEvent("update", {
                detail: {
                    action: "batchSet",
                    count: arrayOfSetObjects.length,
                    routeMap: changedRoutes,
                },
                cancelable: true,
            }));
        }
    }

    // -----------------------------------------------------------------------

    /**
     * Reads multiple values from state in one call.  Equivalent to calling
     * {@link State#get} for each item in the array.
     *
     * @param {Array<{ collection: string, route?: string }>} arrayOfGetRequests
     *   Each object must contain at least a `collection` property.
     * @returns {Result[]} An array of {@link Result} instances in the same
     *   order as the input array.
     * @throws {UpStateError} `INVALID_ARG` — argument is not an array.
     *
     * @example
     * const [userResult, cartResult] = UpState.batchGet([
     *   { collection: "user", route: "name" },
     *   { collection: "cart" },
     * ]);
     * console.log(userResult.raw, cartResult.asArray);
     */
    batchGet(arrayOfGetRequests) {
        if (!Array.isArray(arrayOfGetRequests)) {
            throw new UpStateError(
                "'batchGet' expects an array of objects meant for the 'get' method",
                "INVALID_ARG"
            );
        }

        return arrayOfGetRequests.map(req => this.get(req.collection, req.route));
    }

    // -----------------------------------------------------------------------

    /**
     * Applies multiple `remove` operations atomically with respect to
     * subscriber notifications — all deletes happen first, then each unique
     * `(collection, route)` pair fires its subscribers exactly once.
     *
     * A single `"update"` `CustomEvent` with `action: "batchRemove"` is
     * dispatched after all removals and notifications complete.
     *
     * @param {RemoveObject[]} arrayOfRemoveRequests - Array of objects, each
     *   satisfying the same requirements as the argument to
     *   {@link State#remove}.
     * @returns {void}
     * @throws {UpStateError} `INVALID_ARG` — argument is not an array, or
     *   any individual remove object fails validation.
     *
     * @example
     * UpState.batchRemove([
     *   { collection: "auth" },
     *   { collection: "user", route: "tempData" },
     * ]);
     */
    batchRemove(arrayOfRemoveRequests) {
        if (!Array.isArray(arrayOfRemoveRequests)) {
            throw new UpStateError(
                " 'batchRemove' was expecting an array of objects meant for the 'remove' method",
                "INVALID_ARG"
            );
        }

        const changedRoutes = new Map(); // collection → Set of routes

        arrayOfRemoveRequests.forEach(removeObject => {
            this.#factoryRemove(removeObject.collection, removeObject.route, {
                dispatchUpdateEvent: false,
                fireSubscriptionCallbacks: false
            });

            if (!changedRoutes.has(removeObject.collection)) {
                changedRoutes.set(removeObject.collection, new Set());
            }

            changedRoutes.get(removeObject.collection).add(removeObject.route || null);
        });

        // Fire per-route, not per-collection — mirrors batchSet behaviour
        changedRoutes.forEach((routes, collection) => {
            routes.forEach(route => {
                this.#fireSubscriptionCallbacks(collection, route ?? undefined);
            });
        });

        if (this.#allowEventDispatches) {
            this.dispatchEvent(new CustomEvent("update", {
                detail: {
                    action: "batchRemove",
                    count: arrayOfRemoveRequests.length,
                    routeMap: changedRoutes, // updated to match batchSet's event shape
                },
                cancelable: true,
            }));
        }
    }

    // =========================================================================
    // purge
    // =========================================================================

    /**
     * Completely resets UpState — wipes all in-memory state, subscriptions,
     * caches, and (by default) both `localStorage` and `sessionStorage`.
     *
     * Intended for scenarios such as user logout, where all application state
     * must be torn down cleanly in one operation.
     *
     * After purging, a `"purge"` `CustomEvent` with
     * `detail: { timestamp: number }` is dispatched on the `UpState`
     * instance, allowing top-level components to react (e.g. redirect to a
     * login page).
     *
     * **What is cleared:**
     * - All subscriptions and unsub callbacks
     * - The split-route LRU cache
     * - All in-memory state
     * - The persistent-collections config
     * - `localStorage` and `sessionStorage` (unless `keepStorage: true`)
     *
     * @param {{ keepStorage?: boolean }} [options]
     * @param {boolean} [options.keepStorage=false] - When `true`, the Web
     *   Storage entries are left intact (in-memory state is still cleared).
     *   Useful when you want to reset the runtime state but preserve
     *   persisted data for the next page load.
     * @returns {void}
     *
     * @example <caption>Full reset on logout</caption>
     * UpState.purge();
     *
     * @example <caption>Reset runtime only, keep persisted prefs</caption>
     * UpState.purge({ keepStorage: true });
     *
     * @example <caption>React to purge in a top-level listener</caption>
     * UpState.on("purge", () => router.push("/login"));
     */
    purge({ keepStorage = false } = {}) {

        // 1. Drop all subscriptions — bypass individual unsubs to avoid mutation-during-iteration
        this.#subscriptions.clear();
        this.#unsubCallbacks.clear();

        // 2. Clear auxiliary caches
        this.#splitRouteCache.clear();

        // 3. Wipe in-memory state
        this.#state = Object.create(null);

        // 4. Reset persistent collection config
        this.#persistentCollections.clear();

        // 5. Clear storage (opt-out with keepStorage: true)
        if (!keepStorage) {
            this.storageHandlerInstance.virtualLocalStorage.session = {};
            this.storageHandlerInstance.virtualLocalStorage.permanent = {};
            sessionStorage.removeItem(UPSTATE_STORAGE_KEY);
            localStorage.removeItem(UPSTATE_STORAGE_KEY);
        }

        // 6. Notify the app that a purge happened, so components can react (redirect to login, etc.)
        if (this.#allowEventDispatches) {
            this.dispatchEvent(new CustomEvent("purge", {
                detail: { timestamp: Date.now() }
            }));
        }
    }

    // =========================================================================
    // Debug / Introspection — private implementations
    // =========================================================================

    /** @private */
    #stateSnapshot() {
        return Utility.clone(this.#state, this.#silenceWarnings);
    }

    /** @private */
    #activeSubscriptions() {
        const output = {};

        this.#subscriptions.forEach((routeMap, collection) => {
            output[collection] = {};

            routeMap.forEach((value, route) => {
                const safeRoute =
                    route === FIREONENTIRECOLLECTION
                        ? "<entire-collection>"
                        : route;

                output[collection][safeRoute] = [...value.routeNode.values()].map(sub => ({
                    key: sub.key,
                    propagation: sub.propagation,
                }));
            });
        });

        return Utility.clone(output, this.#silenceWarnings);
    }

    /** @private */
    #metrics() {
        let subscriptionCount = 0;

        this.#subscriptions.forEach(routeMap => {
            routeMap.forEach(value => {
                subscriptionCount += value.routeNode.size;
            });
        });

        return {
            version: VERSION,
            collections: Object.keys(this.#state).length,
            subscriptions: subscriptionCount,
            splitRouteCaches: this.#splitRouteCache.size,
        };
    }

    /** @private */
    #collections() {
        return Object.keys(this.#state);
    }

    /** @private */
    #routes(collection) {
        if (!(collection in this.#state)) return [];

        const output = [];
        const visited = new WeakSet();

        const walk = (obj, prefix = "") => {
            if (!obj || typeof obj !== "object") return;

            if (visited.has(obj)) return;
            visited.add(obj);

            Object.keys(obj).forEach((key) => {
                const route = prefix ? `${prefix}.${key}` : key;

                output.push(route);

                walk(obj[key], route);
            });
        };

        walk(this.#state[collection]);

        return output;
    }

    /** @private */
    #has(collection, route) {
        if (!(collection in this.#state)) return false;

        if (!route) return true;

        const { targetParent, targetKey } =
            Utility.getPathInfo(collection, route, this.#state);

        return (
            !!targetParent &&
            Object.prototype.hasOwnProperty.call(targetParent, targetKey)
        );
    }

    /** @private */
    #persistence() {
        const output = {};

        this.#persistentCollections.forEach((value, key) => {
            output[key] = Utility.clone(value, this.#silenceWarnings);
        });

        return output;
    }

    /** @private */
    #routeInspect(collection, route) {
        const exists = this.#has(collection, route);

        const result = exists
            ? this.get(collection, route).raw
            : undefined;

        return {
            exists,
            type: Array.isArray(result)
                ? "array"
                : result === null
                    ? "null"
                    : typeof result,
            collection,
            route: route ?? null,
            value: Utility.clone(result, this.#silenceWarnings),
        };
    }

    /** @private */
    #splitRouteCacheInfo() {
        return {
            splitRouteCache: {
                size: this.#splitRouteCache.size,
                keys: [...this.#splitRouteCache.keys()],
            },
        };
    }

    /** @private */
    #clearSplitRouteCache() {
        const size = this.#splitRouteCache.size;

        this.#splitRouteCache.clear();

        return {
            cleared: size,
        };
    }

    /** @private */
    #trace({ collection, route, key, ttl = 60000 } = {}) {
        // 1. Validate TTL
        const numericTtl = Number(ttl);
        if (isNaN(numericTtl)) {
            throw new UpStateError(
                "'ttl' can only be a number",
                "INVALID_ARG"
            );
        }

        key = key || `trace-${collection}-${route || "root"}-${Date.now()}`;

        // 2. Start the subscription
        const unsub = this.subscribe({
            collection,
            route,
            key,
            propagation: "tree",
            callback: (value) => {
                console.group(`%c ◆ UpState Trace %c ${collection}${route ? `:${route}` : ""}`, "color: #00ffcc; font-weight: bold;", "color: #eee;");
                console.log("timestamp:", new Date().toISOString());
                console.log("value:", value);
                console.groupEnd();
            }
        });

        // 3. Define the cleanup function first
        let ttlId;
        const stopTrace = () => {
            unsub();
            if (ttlId) clearTimeout(ttlId);
            // Optional: log that the trace was cleaned up
        };

        // 4. Set the auto-destruct timer
        ttlId = setTimeout(stopTrace, numericTtl);

        return stopTrace;
    }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

/**
 * The default UpState singleton — a frozen instance of {@link State}.
 *
 * Import this in your application code:
 * ```js
 * import UpState from "./upstate.js";
 * ```
 *
 * The instance is frozen (`Object.freeze`) so its public methods cannot be
 * accidentally reassigned at runtime.
 *
 * If you need multiple independent state stores (e.g. in a micro-frontend
 * architecture), import the named `State` class and instantiate it directly:
 * ```js
 * import { State } from "./upstate.js";
 * const myStore = new State();
 * ```
 *
 * @type {Readonly<State>}
 */
const UpState = new State();
Object.freeze(UpState);

export { State };
export default UpState;


console.group("%c 🎩 UpState v4.3.0: Aggressive Stress Test ", "background: #222; color: #bada55; font-size: 16px; font-weight: bold; padding: 10px;");

// Utility to measure time
const timeIt = (name, fn) => {
    const start = performance.now();
    fn();
    const end = performance.now();
    console.log(`%c[${name}]%c completed in %c${(end - start).toFixed(2)}ms`, "color: #20b9d4; font-weight: bold;", "color: inherit;", "color: #ffaa00; font-weight: bold;");
};

// ---------------------------------------------------------------------------
// TEST 1: The "Machine Gun" (Raw Set/Get Velocity)
// ---------------------------------------------------------------------------
timeIt("Test 1: 100,000 Rapid Sets & Gets", () => {
    // Disable cloning for raw speed benchmarking
    UpState.config({ cloning: "off" }); 
    
    for (let i = 0; i < 100000; i++) {
        UpState.set({ collection: "velocity", route: `key_${i}`, state: i, fireSubscriptionCallbacks: false });
    }
    
    let checksum = 0;
    for (let i = 0; i < 100000; i++) {
        checksum += UpState.get("velocity", `key_${i}`).raw;
    }
    
    if (checksum !== 4999950000) console.error("Test 1 Failed: Data mismatch");
});

// ---------------------------------------------------------------------------
// TEST 2: The "Deep Web" (Extreme Object Nesting & Route Parsing)
// ---------------------------------------------------------------------------
timeIt("Test 2: Deep Route Parsing (50 levels deep)", () => {
    UpState.config({ cloning: "deep" }); // Turn deep cloning back on!
    
    let deepRoute = "level_0";
    for (let i = 1; i <= 50; i++) { deepRoute += `.level_${i}`; }

    // Write to the absolute bottom of the ocean
    UpState.set({ collection: "abyss", route: deepRoute, state: "The Kraken" });

    // Read from the bottom
    const kraken = UpState.get("abyss", deepRoute).raw;
    if (kraken !== "The Kraken") console.error("Test 2 Failed: Could not fetch from abyss");
    
    // Test the Split Route Cache by fetching it 10,000 times
    for (let i = 0; i < 10000; i++) {
        UpState.get("abyss", deepRoute);
    }
});

// ---------------------------------------------------------------------------
// TEST 3: The "Gossip Network" (Massive Subscription Propagation)
// ---------------------------------------------------------------------------
timeIt("Test 3: 10,000 Related Subscriptions Firing", () => {
    let triggerCount = 0;
    const keys = [];

    // Attach 10,000 listeners to ancestors and descendants
    for (let i = 0; i < 10000; i++) {
        const key = `sub_${i}`;
        UpState.subscribe({
            collection: "gossip",
            route: "company.department.team", 
            propagation: i % 2 === 0 ? "up" : "down", // Mix of up and down propagation
            key,
            callback: () => { triggerCount++; }
        });
        keys.push(key);
    }

    // Trigger an exact match (should fire everything related)
    UpState.set({ collection: "gossip", route: "company.department.team.employee", state: { name: "Bob" } });
    
    // Clean up
    UpState.batchUnsubscribe(keys);
    
    console.log(`   -> Fired ${triggerCount} callbacks in one event loop.`);
});

// ---------------------------------------------------------------------------
// TEST 4: The "Batch Bruiser" (Heavy Array Processing)
// ---------------------------------------------------------------------------
timeIt("Test 4: Batch Setting 5,000 Payloads", () => {
    const payload = [];
    for (let i = 0; i < 5000; i++) {
        payload.push({
            collection: "batch",
            route: `item_${i}`,
            state: { id: i, data: new Array(50).fill("heavy_string") }
        });
    }

    UpState.batchSet(payload);
});

// ---------------------------------------------------------------------------
// TEST 5: The "Memory Churn" (Subscribe/Unsubscribe Leaks)
// ---------------------------------------------------------------------------
timeIt("Test 5: Memory Churn (50,000 Subscribe/Unsubscribe cycles)", () => {
    for (let i = 0; i < 50000; i++) {
        const unsub = UpState.subscribe({
            collection: "churn",
            route: "temp",
            callback: () => {}
        });
        unsub(); // Immediately destroy it
    }
    
    // Check if the registry actually cleaned up
    const metrics = UpState.debug.metrics();
    if (metrics.subscriptions > 0) {
        console.warn(`   -> Warning: ${metrics.subscriptions} dangling subscriptions detected!`);
    } else {
        console.log("   -> Memory clean. No dangling subscriptions.");
    }
});

// ---------------------------------------------------------------------------
// THE AFTERMATH
// ---------------------------------------------------------------------------
console.log("%c--- Engine Diagnostics After Stress ---", "color: #a03131; font-weight: bold;");
console.dir(UpState.debug.metrics());
console.dir(UpState.debug.splitRouteCacheInfo());

// Purge the system to prove it can clean up its own mess
UpState.purge();
console.log("System Purged. Test Complete.");
console.groupEnd();
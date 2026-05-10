"use strict";
const VERSION = "5.0.0";

const FIREONENTIRECOLLECTION = Symbol("fireOnEntireCollection");
const UPSTATE_STORAGE_KEY = "__UPSTATE_α_8f2b4491-9081-_LOCAL_4c12-b7d6-ec2026af999a_STORAGE__";

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

class Utility {
    static stripPrototype(object) {
        return Object.assign(Object.create(null), object);
    }

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

    static resolveExpiry(expiry) {
        if (!expiry || expiry === "never") return null;
        if (typeof expiry === "number") return Date.now() + expiry;

        // Parse shorthand strings: "30d", "12h", "30m"
        const units = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
        const match = String(expiry).match(/^(\d+)(ms|s|m|h|d)$/);
        if (match) return Date.now() + (parseInt(match[1]) * units[match[2]]);

        throw new UpStateError("'expiry' must be 'never', a number (ms), or a shorthand like '30d'", "INVALID_ARG");
    }

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

class UpStateError extends Error {
    constructor(message, code = "GENERAL_ERROR") {
        super(message);
        this.name = "UpStateError";
        this.code = code;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, UpStateError);
        }
    }
}

class Result {

    #data;

    constructor(input) {
        /** @type {*} */
        this.#data = (input === undefined || input === null) ? null : input;

        Object.freeze(this);
    }

    get raw() {
        return this.#data;
    }

    get asArray() {
        if (this.#data === null) return [];

        if (Array.isArray(this.#data)) return this.#data;

        if (typeof this.#data === "object" && Object.prototype.toString.call(this.#data) === '[object Object]') {
            return Object.values(this.#data)
        };
        return [this.#data];
    }

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

    mapArray(callback) {
        const newArray = [];
        const currentList = this.asArray;

        for (let i = 0; i < currentList.length; i++) {
            const newValue = callback(currentList[i], i);
            newArray.push(newValue ?? null);
        }

        return newArray;
    }

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

class StorageHandler {
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

        this.virtualLocalStorage = {
            session: strip(session),
            permanent: strip(local),
        };
    }

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

class State extends EventTarget {

    #state = Object.create(null);

    #persistentCollections = new Map();
    #splitRouteCache = new Map();
    #unsubCallbacks = new Map();
    #subscriptions = new Map();

    #allowEventDispatches = true;
    #unsubscribeOnDelete = true;
    #silenceWarnings = false;

    #cloningOptions = {
        onSet: "deep",
        onGet: "deep",
        onSubscribe: "deep"
    }

    debug;

    constructor() {
        super();

        this.storageHandlerInstance = new StorageHandler(this.#silenceWarnings);

        this.#state = Utility.deepMerge(
            this.storageHandlerInstance.virtualLocalStorage.permanent,
            this.storageHandlerInstance.virtualLocalStorage.session,
        );

        this.on = this.addEventListener.bind(this);
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

    unsubscribe(key) {

        if (typeof key !== "string") {
            throw new UpStateError("'key' has to be a string", "INVALID_ARG");
        }
        if (!this.#unsubCallbacks.has(key)) {
            throw new UpStateError(`no subscription found for key "${key}"`, "INVALID_ARG");
        }

        this.#unsubCallbacks.get(key)();
    }

    batchUnsubscribe(keys) {
        if (!Array.isArray(keys)) {
            throw new UpStateError(
                "'batchUnsubscribe' was expecting an array of keys",
                "INVALID_BATCH_UNSUB_ARGUMENT"
            );
        }

        keys.forEach(key => this.unsubscribe(key));
    }
    // New helper — one pass, derives up/down from shared-prefix + length
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

    // Orchestrator — now just routing logic, no implementation detail
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

    #cloneValue(value, mode) {
        if (!value || typeof value !== "object") return value;
        switch (mode) {
            case "off": return value;
            case "shallow": return Array.isArray(value) ? [...value] : { ...value };
            default: return Utility.clone(value, this.#silenceWarnings);
        }
    }

    set(setObject = {}) { this.#factorySet(setObject) }

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

    remove(collectionOrObject, route) {

        let collection = collectionOrObject;

        if (typeof collectionOrObject === "object" && collectionOrObject !== null) {
            collection = collectionOrObject.collection;
            route = collectionOrObject.route;
        }

        this.#factoryRemove(collection, route)
    }

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

    batchGet(arrayOfGetRequests) {
        if (!Array.isArray(arrayOfGetRequests)) {
            throw new UpStateError(
                "'batchGet' expects an array of objects meant for the 'get' method",
                "INVALID_ARG"
            );
        }

        return arrayOfGetRequests.map(req => this.get(req.collection, req.route));
    }

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

    // ---------------------------------------------------------------------------
    // DEBUG / Introspection APIs
    // ---------------------------------------------------------------------------
    #stateSnapshot() {
        return Utility.clone(this.#state, this.#silenceWarnings);
    }

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

    #collections() {
        return Object.keys(this.#state);
    }

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

    #persistence() {
        const output = {};

        this.#persistentCollections.forEach((value, key) => {
            output[key] = Utility.clone(value, this.#silenceWarnings);
        });

        return output;
    }

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

    #splitRouteCacheInfo() {
        return {
            splitRouteCache: {
                size: this.#splitRouteCache.size,
                keys: [...this.#splitRouteCache.keys()],
            },
        };
    }

    #clearSplitRouteCache() {
        const size = this.#splitRouteCache.size;

        this.#splitRouteCache.clear();

        return {
            cleared: size,
        };
    }

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

const UpState = new State();
Object.freeze(UpState);

export { State };
export default UpState;
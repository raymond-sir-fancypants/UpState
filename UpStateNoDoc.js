"use strict";
// UpState version 4.2.0

const FIREONENTIRECOLLECTION = Symbol("fireOnEntireCollection");

class Utility {

    static JSONHydrator(jsonString) {
        if (!jsonString) return {};

        // This regex covers the full ISO 8601 spectrum used by JSON.stringify:
        // YYYY-MM-DDTHH:mm:ss.sssZ or YYYY-MM-DDTHH:mm:ss+HH:mm
        const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[-+]\d{2}:\d{2})?$/;

        try {
            return JSON.parse(jsonString, (key, value) => {
                if (typeof value === 'string' && isoDateRegex.test(value)) {
                    const potentialDate = new Date(value);

                    // Ensure it's a valid date (not "Feb 31st") before returning the object
                    return !isNaN(potentialDate.getTime()) ? potentialDate : value;
                }
                return value;
            });
        } catch (e) {
            // Fallback for malformed JSON
            try {
                return JSON.parse(jsonString);
            } catch {
                return {};
            }
        }
    }

    static deepMerge(target, source) {
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

        return output;
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

    static clone(object, seen = new WeakMap(), warned = false) {

        // 1. Primitives and null are fine
        if (!object || typeof object !== "object") {
            return object;
        }

        // 2. CHECK THE MEMORY: Have we seen this object in this recursion tree?
        if (seen.has(object)) {
            return seen.get(object);
        }

        try {
            return structuredClone(object);
        } catch (err) {
            // WHY? state should be data not behaviour
            // if (!libraryState.silenceWarnings && !warned) {
            //     console.warn("structuredClone failed, falling back to manual cleanup", object, err);
            // }

            // 3. Handle Arrays
            if (Array.isArray(object)) {
                const newArr = [];
                seen.set(object, newArr); // Remember the reference
                object.forEach((item, index) => {
                    newArr[index] = this.clone(item, seen, true);
                });
                return newArr;
            }

            // 4. Handle Objects
            const newObj = {};
            seen.set(object, newObj); // Remember the reference before recursing deeper

            for (const key in object) {
                if (Object.prototype.hasOwnProperty.call(object, key)) {
                    const val = object[key];

                    // Skip functions and properties that are actually the 'window'
                    if (typeof val !== 'function' && (typeof window === "undefined" || val !== window)) {
                        newObj[key] = this.clone(val, seen, true);
                    }
                }
            }
            return newObj;
        }
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

    constructor() {

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

        this.virtualLocalStorage = {
            session: sessionParsed,
            permanent: permanentParsed
        }
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
                if (targetParent) {
                    delete targetParent[targetKey];
                }
            }

            this.virtualLocalStorage[virtualDriver] = localState;

            driver.setItem("UpState", JSON.stringify(localState));
        }

        remove(localStorage, "permanent");
        remove(sessionStorage, "session");
    }
}

const storageHandlerInstance = new StorageHandler();

class State extends EventTarget {

    #state = Object.create(null);

    #persistentCollections = new Map();
    #killResponseRegistry = new Map();
    #killRequestRegistry = new Map();
    #requestDetailCache = new Map();
    #killEmitRegistry = new Map();
    #splitRouteCache = new Map();
    #unsubCallbacks = new Map();
    #subscriptions = new Map();
    #ttlTimeout = new Map();

    #allowEventDispatches = true;
    #silenceWarnings = false;

    #bus = new EventTarget();

    #cloningOptions = {
        onSet: "deep",
        onGet: "deep",
        onSubscribe: "deep"
    }

    constructor() {
        super();
        this.#state = Utility.deepMerge(
            storageHandlerInstance.virtualLocalStorage.permanent,
            storageHandlerInstance.virtualLocalStorage.session,
        );

        this.on = this.addEventListener.bind(this);
        this.off = this.removeEventListener.bind(this);
        this.emit = this.dispatchEvent.bind(this);
    }

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
            "MISSING_ARG"
        );
    }

    subscribe({ collection, route, callback, key, propagation = "none" } = {}) {
        const propagationOptions = new Set(["none", "both", "up", "down"]);
        const publicPropagationOptions = new Set(["exact", "related", "ancestors", "descendants"]);

        switch (propagation) {
            case "exact": propagation = "none"; break;
            case "related": propagation = "both"; break;
            case "ancestors": propagation = "up"; break;
            case "descendants": propagation = "down"; break;
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

        if (typeof collection !== "string") {
            throw new UpStateError("'collection' value has to be be a String", "INVALID_ARG");
        }

        if (callback === undefined) {
            throw new UpStateError("'subscription' callback is required", "MISSING_ARG");
        }

        if (typeof callback !== "function") {
            throw new UpStateError("'subscription' callback has to be a function", "INVALID_ARG");
        }

        if (key === undefined) {
            throw new UpStateError("'key' is required", "MISSING_ARG");
        }

        if (typeof key !== "string") {
            throw new UpStateError("'key' value has to be a string", "INVALID_ARG");
        }

        if (this.#unsubCallbacks.has(key)) {
            throw new UpStateError("the 'key' entered is already in use", "INVALID_ARG");
        }

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

    batchSubscriptions(arrayOfSubscriptionObjects) {
        if (!Array.isArray(arrayOfSubscriptionObjects)) {
            throw new UpStateError(
                "'batchSubscriptions' was expecting an array of objects meant for the subscribe method",
                "INVALID_ARG"
            );
        }

        const unsubs = {};

        arrayOfSubscriptionObjects.forEach(obj => {
            unsubs[obj.key] = this.subscribe(obj)
        });

        return unsubs;
    }

    unsubscribe(keys) {

        const unsubFunc = (key) => {
            if (typeof key !== "string") {
                throw new UpStateError("'key' has to be a string", "INVALID_ARG");
            }
            if (!this.#unsubCallbacks.has(key)) {
                throw new UpStateError(`no subscription found for key "${key}"`, "INVALID_ARG");
            }

            this.#unsubCallbacks.get(key)();
        }

        if (Array.isArray(keys)) {
            keys.forEach(key => unsubFunc(key));
        } else {
            unsubFunc(keys);
        }
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
        const collectionState = this.#cloneValue(
            this.#state[collection],
            this.#cloningOptions.onSubscribe
        );

        routeMap.forEach((value) => {
            value.routeNode.forEach((v) => {
                if (firedCallbacks.has(v.key)) return;
                firedCallbacks.add(v.key);

                // "none" only fires when its exact route is targeted.
                // For collection-level subs that means a full-collection set(), not a route change.
                if (v.propagation !== "none" || v.route === FIREONENTIRECOLLECTION) {
                    v.callback(collectionState);
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
            default: return Utility.clone(value);
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
        if (typeof persistence !== "string" && persistence !== undefined) {
            throw new UpStateError(
                "'persistence' can only be a string",
                "INVALID_ARG"
            );

        }

        persistence = persistence ?? this.#persistentCollections.get(collection);

        if (persistence) {
            const persistenceValue = String(persistence).toLowerCase();
            if (persistenceValue === "permanent" || persistenceValue === "session") {
                storageHandlerInstance.set({ collection, state, route, persistence },)
            } else {
                throw new UpStateError(
                    "'persistence' value can only be either 'session' or 'permanent'",
                    "INVALID_ARG"
                );
            }
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

        // console.log(collection,route)
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

        storageHandlerInstance.remove(collection, route,);

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

        const data = {};

        arrayOfGetRequests.forEach(req => {
            if (!data[req.collection]) {
                data[req.collection] = [];
            }
            data[req.collection].push(this.get(req.collection, req.route).raw);
        });

        return new Result(data);
    }

    batchRemove(arrayOfRemoveRequests) {
        if (!Array.isArray(arrayOfRemoveRequests)) {
            throw new UpStateError(
                " 'batchRemove' was expecting an array of objects meant for the 'remove' method",
                "INVALID_ARG"
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

        collectionSet.forEach(collection => this.#fireSubscriptionCallbacks(collection))

        if (this.#allowEventDispatches) {
            this.dispatchEvent(new CustomEvent("update", {
                detail: {
                    action: "batchRemove",
                    count: arrayOfRemoveRequests.length,
                    collections: collectionSet,
                },
                cancelable: true,
            }));
        }
    }

    emitState({ name, id, payload, collection, route, callback, transform } = {}) {

        if (name === undefined) {
            throw new UpStateError(`'name' is required`, "MISSING_ARG");
        }

        if (typeof name !== "string") {
            throw new UpStateError(`'name' can only be a string`, "INVALID_ARG");
        }

        if (id !== undefined && typeof id !== "string" && typeof id !== "number") {
            throw new UpStateError(`'id' can only be a string`, "INVALID_ARG");
        }

        if (typeof callback !== "function" && callback !== undefined) {
            throw new UpStateError(`'callback' can only be a function`, "INVALID_ARG");
        }

        if (typeof transform !== "function" && transform !== undefined) {
            throw new UpStateError(`'transform' can only be a function`, "INVALID_ARG");
        }

        const data = this.get(collection, route);

        const resolved = transform ? transform(data) : data;

        this.#bus.dispatchEvent(
            new CustomEvent(name, {
                detail: { payload, data: resolved, callback }
            })
        );
    }

    onEmit({ name, callback }) {

        if (name === undefined) {
            throw new UpStateError(`'name' is required`, "MISSING_ARG"
            );
        }

        if (typeof name !== "string") {
            throw new UpStateError(`'name' can only be a string`, "INVALID_ARG");
        }

        if (this.#killEmitRegistry.has(name)) {
            throw new UpStateError(`there is already an 'onEmit' with this name`, "INVALID_ARG");
        }

        if (typeof callback !== "function") {
            throw new UpStateError(`'callback' can only be a function`, "INVALID_ARG");
        }

        let abortCont = new AbortController();

        this.#bus.addEventListener(name, event => {
            const detail = event.detail;
            callback({
                payload: detail.payload,
                data: detail.data,
                callback: detail.callback
            });
        }, { signal: abortCont.signal })

        this.#killEmitRegistry.set(name, () => {
            if (abortCont) {
                abortCont.abort()
                abortCont = null;
            }
        })
    }

    #kill(name, where) {
        if (name === undefined) { throw new UpStateError(`'name' is required`, "MISSING_ARG"); }
        if (typeof name !== "string") { throw new UpStateError(`'name' can only be a string`, "INVALID_ARG"); }
        if (where.has(name)) {
            where.get(name)();
            where.delete(name);
        }
    }


    request({ name, id, payload, destination, callback, transform, ttl = 120 } = {}) {

        ttl = Number(ttl);

        if (isNaN(ttl)) {
            throw new UpStateError(`'ttl' can only be a number`, "INVALID_ARG");
        }

        ttl = ttl * 1000;

        if (name === undefined) {
            throw new UpStateError(`'name' is required`, "MISSING_ARG");
        }

        if (typeof name !== "string") {
            throw new UpStateError(`'name' can only be a string`, "INVALID_ARG");
        }


        if (id !== undefined && typeof id !== "string" && typeof id !== "number") {
            throw new UpStateError(`'id' can only be a string`, "INVALID_ARG");
        }

        if (typeof callback !== "function" && callback !== undefined) {
            throw new UpStateError(`'callback' can only be a function`, "INVALID_ARG");
        }

        if (typeof transform !== "function" && transform !== undefined) {
            throw new UpStateError(`'transform' can only be a function`, "INVALID_ARG");
        }

        const uid = id ?? crypto.randomUUID();


        this.#ttlTimeout.set(uid, setTimeout(e => {
            this.response(uid, {
                error: true,
                payload: null
            });
            this.#ttlTimeout.delete(uid)
        }, ttl))

        this.#bus.dispatchEvent(
            new CustomEvent(name, {
                detail: {
                    payload,
                    destination,
                    uid,
                    transform,
                    callback,
                    ttl,
                }
            })
        );

        return uid;
    }

    onRequest({ name, id, callback }) {

        if (id !== undefined && typeof id !== "string" && typeof id !== "number") {
            throw new UpStateError(`'id' can only be a string`, "INVALID_ARG");
        }

        if (name === undefined) {
            throw new UpStateError(`'name' is required`, "MISSING_ARG");
        }

        if (typeof name !== "string") {
            throw new UpStateError(`'name' can only be a string`, "INVALID_ARG");
        }

        if (this.#killRequestRegistry.has(name)) {
            throw new UpStateError(`there is already an 'onRequest' with this name`, "INVALID_ARG");
        }

        if (callback === undefined) {
            throw new UpStateError(`'callback' is required`, "INVALID_ARG");
        }

        if (typeof callback !== "function") {
            throw new UpStateError(`'callback' can only be a function`, "INVALID_ARG");
        }

        let abortCont = new AbortController();

        this.#bus.addEventListener(name, event => {
            const detail = event.detail;
            const uid = id ?? detail.uid;

            const baggage = Object.create(null);

            baggage.uid = detail.uid;
            baggage.destination = detail.destination;
            baggage.transform = detail.transform;
            baggage.callback = detail.callback;

            this.#requestDetailCache.set(uid, baggage);

            callback(uid, detail.payload);

        }, { signal: abortCont.signal })

        this.#killRequestRegistry.set(name, () => {
            if (abortCont) {
                abortCont.abort()
                abortCont = null;
            }
        })
    }

    response(idOrObject, data) {

        let id = idOrObject;

        if (typeof idOrObject === "object" && idOrObject !== null) {
            id = idOrObject.id;
            data = idOrObject.data;
        }

        if (!this.#requestDetailCache.has(id)) {
            throw new UpStateError(
                `'id' should be set to the first perimitor of the receiveRequest's callback`,
                "INVALID_ARG"
            );
        }

        const baggage = this.#requestDetailCache.get(id);

        const resolved = baggage.transform ? baggage.transform(data) : data;

        if (baggage.callback) baggage.callback(resolved);
        if (baggage.destination) this.set({ ...baggage.destination, state: resolved });

        this.#requestDetailCache.delete(id);

        clearTimeout(this.#ttlTimeout.get(id));
        this.#ttlTimeout.delete(id);

        this.#bus.dispatchEvent(
            new CustomEvent(baggage.uid, {
                detail: { payload: resolved }
            })
        );
    }

    onResponse({ id, once, abortController, callback }) {
        const options = {};
        options.once = once ? !!once : true;

        if (abortController !== undefined && !(abortController instanceof AbortController)) {
            throw new UpStateError(`invalid abortSignal`, "INVALID_ARG");
        }

        if (id === undefined) {
            throw new UpStateError(`'id' is required`, "INVALID_ARG"
            );
        }

        if (typeof id !== "string" && typeof id !== "number") {
            throw new UpStateError(`'id' can only be a string`, "INVALID_ARG"
            );
        }

        if (this.#killResponseRegistry.has(id)) {
            throw new UpStateError(`there is already an 'onResponse' with this name`, "INVALID_ARG");
        }

        if (typeof callback !== "function") {
            throw new UpStateError(`'callback' can only be a function`, "INVALID_ARG"
            );
        }

        abortController = abortController ? abortController : new AbortController();
        options.signal = abortController.signal;

        this.#bus.addEventListener(id, event => {
            callback({ error: false, payload: event.detail.payload });

            if (options.once) { this.killOnResponse(id); }
            clearTimeout(this.#ttlTimeout.get(id));
            this.#ttlTimeout.delete(id);
        }, options);

        this.#killResponseRegistry.set(id, () => {
            if (abortController) {
                abortController.abort()
                abortController = null;
            }
        })
    }

    killOnEmit(type) { this.#kill(type, this.#killEmitRegistry) }
    killOnRequest(type) { this.#kill(type, this.#killRequestRegistry) }
    killOnResponse(id) { this.#kill(id, this.#killResponseRegistry) }

}

const UpState = new State();
Object.freeze(UpState);
export { State };
export default UpState;
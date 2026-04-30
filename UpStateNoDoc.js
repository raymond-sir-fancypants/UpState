"use strict";
// UpState version 4.0.0

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

    #allowEventDispatches = true;

    #subscriptions = {
        collections: {},
        callbacks: {}
    };

    #unsubCallbacks = {};

    #silenceWarnings = false;

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

    subscribe({ collection, route, callback, unsubscribeKey } = {}) {

        if (collection === undefined || collection === "") {
            throw new UpStateError("'collection' name is required", "MISSING_COLLECTION_REF");
        }

        if (typeof collection !== "string") {
            throw new UpStateError("'collection' value has to be be a String", "INVALID_COLLECTION_REF");
        }

        if (callback === undefined) {
            throw new UpStateError("'subscription' callback is required", "MISSING_SUB_Callback_REF");
        }

        if (typeof callback !== "function") {
            throw new UpStateError("'subscription' callback has to be a function", "INVALID_SUB_Callback");
        }

        if (typeof unsubscribeKey !== "string" && unsubscribeKey !== undefined) {
            throw new UpStateError("'unsubscribeKey' value has to be a string", "INVALID_UNSUB_KEY");
        }

        route = route ?? "fireOnEntireCollection";

        // console.log(route)

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

            // Only remove the route from the Set when no callbacks remain
            if (this.#subscriptions.callbacks[collection][route].length === 0) {
                this.#subscriptions.collections[collection]?.delete(route);
            }

            if (unsubscribeKey) delete this.#unsubCallbacks[unsubscribeKey]
        }

        if (unsubscribeKey) {
            this.#unsubCallbacks[unsubscribeKey] = unsub;
        }

        return unsub;
    }

    batchSubscriptions(arrayOfSubscriptionObjects) {
        if (!Array.isArray(arrayOfSubscriptionObjects)) {
            throw new UpStateError(
                "'batchSubscriptions' was expecting an array of objects meant for the subscribe method",
                "INVALID_BATCH_SUB_ARGUMENT"
            );
        }

        return arrayOfSubscriptionObjects.map(obj => this.subscribe(obj))
    }

    unsubscribe(keys) {

        const unsubFunc = (key) => {
            if (typeof key !== "string" && key !== undefined) {
                throw new UpStateError("'unsubscribeKey' value has to be a string", "INVALID_UNSUB_KEY");
            }

            if (typeof key !== "string" || !this.#unsubCallbacks[key]) {
                throw new UpStateError(`no subscription found for key "${key}"`, "INVALID_UNSUB_KEY");
            }

            this.#unsubCallbacks[key]();
        }

        if (Array.isArray(keys)) {

            keys.forEach(key => unsubFunc(key))

        } else {
            unsubFunc(keys)
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

    #fireSubscriptionCallbacks(collection, changedPath) {
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


                const cbs = this.#subscriptions.callbacks[collection][key];
                if (Array.isArray(cbs)) {
                    cbs.forEach(cb => {
                        if (typeof cb === 'function') {
                            const data = this.#cloneValue(this.#state[collection], this.#cloningOptions.onSubscribe);
                            cb(new Result(data))
                        }
                    });
                }

            } else if (compare) {

                const destination = Utility.getPathInfo(
                    collection,
                    key,
                    this.#state,
                    false
                );
                const actualValue = destination?.targetParent?.[destination.targetKey];

                // Trigger the callback
                const cbs = this.#subscriptions.callbacks[collection][key];

                if (Array.isArray(cbs)) {
                    cbs.forEach(cb => {
                        if (typeof cb === 'function') {
                            const data = this.#cloneValue(actualValue, this.#cloningOptions.onSubscribe);
                            cb(new Result(data))
                        }
                    });
                }
            }
        }
    }

    set(setObject = {}) { this.#factorySet(setObject) }

    #factorySet(
        { collection, state, route, persistence },
        { fireSubscriptionCallbacks = true, dispatchUpdateEvent = true } = {}) {

        fireSubscriptionCallbacks = !!fireSubscriptionCallbacks;

        if (collection === undefined || collection === "") {
            throw new UpStateError("'collection' value has to be be a String", "MISSING_COLLECTION_REF");
        }

        if (typeof collection !== "string") {
            throw new UpStateError("'collection' can only be a String", "INVALID_COLLECTION_REF");
        }

        // Avoid falsy checks — they would incorrectly reject valid values like 0, false, []
        if (state === undefined) {
            throw new UpStateError("state value cannot be undefined", "INVALID_STATE_VALUE");
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
                "INVALID_PERSISTENCE_VALUE"
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
                    "INVALID_PERSISTENCE_VALUE"
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

    get(collection, route) {

        if (collection === undefined) return new Result(this.#cloneValue(this.#state, this.#cloningOptions.onGet));

        if (collection === "") {
            throw new UpStateError("'collection' value has to be be a String", "MISSING_COLLECTION_REF");
        }

        if (typeof collection !== "string") {
            throw new UpStateError("'collection' value has to be be a String", "INVALID_COLLECTION_REF");
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

    remove(collection, route) { this.#factoryRemove(collection, route) }

    #factoryRemove(collection, route, { dispatchUpdateEvent = true, fireSubscriptionCallbacks = true } = {}) {

        // console.log(collection,route)
        fireSubscriptionCallbacks = !!fireSubscriptionCallbacks;
        if (collection === undefined || collection === "") {
            throw new UpStateError("'collection' value has to be be a String", "MISSING_COLLECTION_REF");
        }

        if (typeof collection !== "string") {
            throw new UpStateError("'collection' value has to be be a String", "INVALID_COLLECTION_REF");
        }

        const destination = {};

        if (!route) {
            destination.targetParent = this.#state;
            destination.targetKey = collection;
            delete this.#state[collection];

            if (fireSubscriptionCallbacks) {
                this.#fireSubscriptionCallbacks(collection);
            }
        } else {
            const { targetParent, targetKey } = Utility.getPathInfo(collection, route, this.#state, false);
            destination.targetParent = targetParent;
            destination.targetKey = targetKey;
            if (targetParent && targetKey in targetParent) {
                delete targetParent[targetKey];

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
                "INVALID_BATCH_SET_ARGUMENT"
            );
        }
        const changedRoutes = new Map(); // collection → Set of routes

        arrayOfSetObjects.forEach(setObject => {
            this.#factorySet(setObject, { fireSubscriptionCallbacks: false, dispatchUpdateEvent: false });

            if (!changedRoutes.has(setObject.collection)) changedRoutes.set(setObject.collection, new Set());

            changedRoutes.get(setObject.collection).add(setObject.route || "fireOnEntireCollection");

        });

        changedRoutes.forEach((routes, collection) => {

            // Fire collection-level subscribers once

            // Fire route-level subscribers per changed route, skipping collection-level
            routes.forEach(route => {


                if (route) this.#fireSubscriptionCallbacks(collection, route);
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

    batchRemove(arrayOfRemoveRequests) {
        if (!Array.isArray(arrayOfRemoveRequests)) {
            throw new UpStateError(
                " 'batchRemove' was expecting an array of objects meant for the 'remove' method",
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
}

const UpState = new State();
Object.freeze(UpState);
export default UpState;
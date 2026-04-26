"use strict";

// upstate version 1.2.0

class Utility {

    static JSONHydrator(jsonString) {

        const raw = jsonString;

        if (!raw) return {};

        try {
            return JSON.parse(raw, (k, v) => {
                // Regex to catch ISO date strings automatically
                const isISO = typeof v === 'string' &&
                    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v);
                return isISO ? new Date(v) : v;
            });
        } catch (e) {
            return JSON.parse(raw);
        }

    }

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

const objectA = {
  id: "primary-instance",
  active: true,
  version: 1.0,
  metadata: {
    author: "Admin",
    tags: ["vanilla", "js", "web"],
    stats: {
      uptime: 99.9,
      errors: 0
    }
  },
  connection_logs: [
    { id: 1, type: "ping", status: "ok" },
    { id: 2, type: "ping", status: "ok" }
  ],
  settings: {
    theme: "dark",
    notifications: {
      email: true,
      push: false
    }
  },
  unused_key: "i should stay here"
};

const objectB = {
  id: "updated-instance", // Collision: should overwrite "primary-instance"
  active: false,          // Collision: should overwrite true
  new_feature: "enabled", // New key: should be added
  metadata: {
    author: "Lead Dev",   // Deep Collision: should update "Admin"
    tags: ["network"],    // Array Collision: will this overwrite or append?
    stats: {
      errors: 5           // Partial Deep Update: uptime should remain 99.9
    }
  },
  connection_logs: [
    { id: 3, type: "jitter", status: "high" } // New array item
  ],
  settings: {
    notifications: {
      push: true          // Deep Update: email should remain true
    }
  }
};


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

    get list() {
        if (this.#data === null) return [];

        if (Array.isArray(this.#data)) return this.#data;

        if (typeof this.#data === "object" && Object.prototype.toString.call(this.#data) === '[object Object]') {
            return Object.values(this.#data)
        };
        return [this.#data];
    }

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

    iterateAsMap(callBack) {
        const currentMap = this.map; // Call getter once
        const keys = Object.keys(currentMap);
        const newMap = {};

        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const newValue = callBack(key, currentMap[key]);
            newMap[key] = newValue ?? null;
        }
        return newMap;
    }

    iterateAsList(callBack) {
        const newArray = [];
        const currentList = this.list;

        for (let i = 0; i < currentList.length; i++) {
            const newValue = callBack(i, currentList[i]);
            newArray.push(newValue ?? null);
        }

        return newArray;
    }
}

class StorageHandler {

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

class State extends EventTarget {

    #state = {};

    #persistantCollections = [];

    #allowEventDispatches = true;

    constructor() {
        super();

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

        this.#state = Utility.deepMerge(sessionParsed, permanentParsed);
    }

    config({
        persistantCollections = [],
        allowEventDispatches = true,
    }) {
        this.#allowEventDispatches = !!allowEventDispatches;

        if (Array.isArray(persistantCollections)) {
            // this sets a collection level persistace
            //this.set can overide it for property level persistence
            this.#persistantCollections = persistantCollections;

            this.#persistantCollections.forEach(collection => {
                if (Object.keys(collection)[0] in this.#state) {

                    const key = Object.keys(collection)[0];
                    const persistence = collection[key]
                    const state = this.#state[key]

                    StorageHandler.set({ collection: key, state, persistence })
                }
            })

        } else {
            throw new UpStateError(
                "persistantCollections should be an array of collection names",
                "MISSING_CONFIG_ERR"
            );
        }
    }

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
        const markedForpersistence = this.#persistantCollections.find(obj => collection in obj);

        const persistenceValue = String(persistence).toLowerCase();

        if (markedForpersistence && !(persistenceValue === "permanent" || persistenceValue === "session")) {
            persistence = markedForpersistence[collection];
        }

        if (persistence) {
            const persistenceValue = String(persistence).toLowerCase();
            if (persistenceValue === "permanent" || persistenceValue === "session") {
                StorageHandler.set({ collection, state, route, persistence });
            } else {
                throw new UpStateError(
                    "invalid persistence value; it can only be 'session' or 'permanent'",
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

        if (collection === undefined) return new Result(structuredClone(this.#state));

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
                    collections: [...new Set(collections)],
                    stateInputs
                },
                cancelable: true,
            }));
        }
    }

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
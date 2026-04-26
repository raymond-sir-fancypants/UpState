"use strict";

// upstate version 1.0.1

class Utility {

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

        // Config-level persistence overrides call-level persistence
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
                    state: structuredClone(this.#state),
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

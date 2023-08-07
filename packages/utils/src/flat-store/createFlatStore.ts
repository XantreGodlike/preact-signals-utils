import { signal } from "@preact-signals/unified-signals";
import { Opaque } from "type-fest";
import { setterOfFlatStore } from "./setter";

const __storeState = Symbol("store-state");
const handler: ProxyHandler<any> = {
  get(target, key) {
    const storageState = target[__storeState];
    if (!(key in target)) {
      return storageState[key]?.value;
    }
    if (typeof target[key] === "function") {
      return target[key];
    }

    storageState[key] = signal(target[key]);
    delete target[key];
    return storageState[key].value;
  },
  set(target, key, value) {
    if (typeof target[key] === "function") {
      target[key] = value;
      return true;
    }
    const storageState = target[__storeState];
    if (key in target) {
      delete target[key];
    }
    if (!storageState[key]) {
      storageState[key] = signal(value);
      return true;
    }

    storageState[key].value = value;
    return true;
  },
  deleteProperty(target, key) {
    const storage =
      key in target
        ? target
        : key in target[__storeState]
        ? target[__storeState]
        : null;
    if (!storage) {
      return false;
    }
    delete storage[key];
    return true;
  },
  has(target, key) {
    return key in target || key in target[__storeState];
  },
  ownKeys(target) {
    return [...Object.keys(target), ...Object.keys(target[__storeState])];
  },
  getOwnPropertyDescriptor() {
    return {
      enumerable: true,
      configurable: true,
    };
  },
};

export type FlatStore<T extends Record<any, any>> = Opaque<
  T,
  "@preact-signals/utils;flatStore"
>;

export type ReadonlyFlatStore<T extends Record<any, any>> = Readonly<
  FlatStore<T>
>;

export const flatStore = <T extends Record<any, any>>(
  initialState: T
): FlatStore<T> =>
  new Proxy(Object.assign({ [__storeState]: {} }, initialState), handler);

export const createFlatStore = <T extends Record<any, any>>(
  initialState: T
) => {
  const store = flatStore(initialState);

  return [store, setterOfFlatStore(store)] as const;
};

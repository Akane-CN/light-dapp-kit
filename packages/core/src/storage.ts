/**
 * Tiny IndexedDB wrapper for light-dapp-kit's own metadata.
 * The light client's own databases are managed by ckb-light-client-db-worker.
 */
import type { Hex } from "@ckb-ccc/core";
import type { WatchList } from "./watch.js";

export interface Meta {
  networkSecretKey?: Hex;
  watches?: ReturnType<WatchList["toJSON"]>;
  upstreamVersion?: string;
  schemaVersion?: number;
}

const META_DB = "light-dapp-kit-meta";
const STORE = "meta";
const SCHEMA_VERSION = 1;

function openMeta(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(META_DB, SCHEMA_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadMeta(networkKey: string): Promise<Meta | undefined> {
  const db = await openMeta();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(networkKey);
      req.onsuccess = () => resolve(req.result as Meta | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveMeta(networkKey: string, patch: Meta): Promise<void> {
  const db = await openMeta();
  try {
    const current = (await loadMeta(networkKey)) ?? {};
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ ...current, ...patch, schemaVersion: SCHEMA_VERSION }, networkKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Delete the light client databases and our metadata for one network. */
export async function clearDatabases(networkDbName: string): Promise<void> {
  const names = (await indexedDB.databases?.())?.map((d) => d.name).filter(Boolean) as string[] | undefined;
  const targets = (names ?? []).filter((n) => n.startsWith(networkDbName));
  await Promise.all(targets.map((n) => new Promise<void>((res) => { const r = indexedDB.deleteDatabase(n); r.onsuccess = r.onerror = r.onblocked = () => res(); })));
  const db = await openMeta();
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(networkDbName);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}

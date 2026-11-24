// Свои нарезанные брейки хранятся в IndexedDB: исходный файл + маркеры слайсов.

export interface StoredKit {
  id: string;
  name: string;
  file: ArrayBuffer;
  markers: number[]; // начала слайсов, в сэмплах (в частоте дискретизации AudioContext на момент нарезки)
  sampleRate: number;
  created: number;
}

const DB = 'padwork';
const STORE = 'kits';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export function listStoredKits(): Promise<StoredKit[]> {
  return tx('readonly', (s) => s.getAll() as IDBRequest<StoredKit[]>).catch(() => []);
}

export function putStoredKit(kit: StoredKit): Promise<IDBValidKey> {
  return tx('readwrite', (s) => s.put(kit));
}

export function deleteStoredKit(id: string): Promise<undefined> {
  return tx('readwrite', (s) => s.delete(id));
}

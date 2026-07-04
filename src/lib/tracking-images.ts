const DB_NAME = 'thuoc-nhac-tracking-images';
const DB_VERSION = 1;
const STORE_NAME = 'images';
const MAX_IMAGE_WIDTH = 1600;
const JPEG_QUALITY = 0.82;

export interface LocalImageRecord {
  key: string;
  blob: Blob;
  mimeType: string;
  size: number;
  createdAt: string;
}

export async function saveTrackingImage(file: File, key: string): Promise<LocalImageRecord> {
  const blob = await compressImage(file);
  const record: LocalImageRecord = {
    key,
    blob,
    mimeType: blob.type || 'image/jpeg',
    size: blob.size,
    createdAt: new Date().toISOString(),
  };

  const db = await openImageDb();
  await runStoreRequest(db, 'readwrite', (store) => store.put(record));
  db.close();
  return record;
}

export async function getTrackingImageUrl(key: string): Promise<string | null> {
  const db = await openImageDb();
  const record = await runStoreRequest<LocalImageRecord | undefined>(db, 'readonly', (store) => store.get(key));
  db.close();
  if (!record?.blob) return null;
  return URL.createObjectURL(record.blob);
}

export async function deleteTrackingImage(key: string) {
  const db = await openImageDb();
  await runStoreRequest(db, 'readwrite', (store) => store.delete(key));
  db.close();
}

function openImageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runStoreRequest<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_WIDTH / bitmap.width);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    return file;
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', JPEG_QUALITY);
  });
}

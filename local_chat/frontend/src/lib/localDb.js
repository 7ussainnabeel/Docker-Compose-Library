import { openDB } from 'idb';

const DB_NAME = 'lan-messenger-db';
const DB_VERSION = 1;

const dbPromise = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    const messages = db.createObjectStore('messages', { keyPath: 'id' });
    messages.createIndex('conversationId', 'conversationId');
    messages.createIndex('createdAt', 'createdAt');

    db.createObjectStore('settings', { keyPath: 'key' });
  }
});

export async function saveMessage(message) {
  const db = await dbPromise;
  await db.put('messages', message);
}

export async function loadMessagesByConversation(conversationId) {
  const db = await dbPromise;
  const tx = db.transaction('messages', 'readonly');
  const index = tx.store.index('conversationId');
  return index.getAll(conversationId);
}

export async function loadMessageById(messageId) {
  const db = await dbPromise;
  return db.get('messages', messageId);
}

export async function deleteMessagesByConversation(conversationId) {
  const db = await dbPromise;
  const tx = db.transaction('messages', 'readwrite');
  const index = tx.store.index('conversationId');
  const keys = await index.getAllKeys(conversationId);
  for (const key of keys) {
    await tx.store.delete(key);
  }
  await tx.done;
}

export async function deleteMessageById(messageId) {
  const db = await dbPromise;
  await db.delete('messages', messageId);
}

export async function saveSetting(key, value) {
  const db = await dbPromise;
  await db.put('settings', { key, value });
}

export async function loadSetting(key) {
  const db = await dbPromise;
  const row = await db.get('settings', key);
  return row?.value;
}

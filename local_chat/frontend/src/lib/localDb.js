import { deleteDB, openDB } from 'idb';

const DB_NAME = 'lan-messenger-db';
const DB_VERSION = 2;

function createDbPromise() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, _oldVersion, _newVersion, transaction) {
    let messages;
    if (!db.objectStoreNames.contains('messages')) {
      messages = db.createObjectStore('messages', { keyPath: 'id' });
      messages.createIndex('conversationId', 'conversationId');
      messages.createIndex('createdAt', 'createdAt');
    } else {
      messages = transaction.objectStore('messages');
      if (!messages.indexNames.contains('conversationId')) {
        messages.createIndex('conversationId', 'conversationId');
      }
      if (!messages.indexNames.contains('createdAt')) {
        messages.createIndex('createdAt', 'createdAt');
      }
    }

    if (!messages.indexNames.contains('conversationId_createdAt')) {
      messages.createIndex('conversationId_createdAt', ['conversationId', 'createdAt']);
    }

    if (!db.objectStoreNames.contains('settings')) {
      db.createObjectStore('settings', { keyPath: 'key' });
    }
    }
  });
}

let dbPromise = createDbPromise();
let dbRecoveryAttempted = false;

async function getDb() {
  try {
    return await dbPromise;
  } catch (error) {
    const recoverable = error?.name === 'AbortError' || error?.name === 'VersionError';
    if (!recoverable || dbRecoveryAttempted) {
      throw error;
    }

    dbRecoveryAttempted = true;
    await deleteDB(DB_NAME);
    dbPromise = createDbPromise();
    return dbPromise;
  }
}

export async function saveMessage(message) {
  const db = await getDb();
  await db.put('messages', message);
}

export async function loadMessagesByConversation(conversationId) {
  const db = await getDb();
  const tx = db.transaction('messages', 'readonly');
  const index = tx.store.index('conversationId');
  return index.getAll(conversationId);
}

export async function loadMessagesByConversationPaged(conversationId, { before = null, limit = 120 } = {}) {
  const db = await getDb();
  const tx = db.transaction('messages', 'readonly');
  const store = tx.objectStore('messages');
  const index = store.index('conversationId_createdAt');

  const boundedLimit = Math.max(10, Math.min(Number(limit) || 120, 500));
  const upperTs = before == null ? Number.MAX_SAFE_INTEGER : Math.max(0, Number(before) - 1);
  const range = IDBKeyRange.bound([conversationId, 0], [conversationId, upperTs]);
  let cursor = await index.openCursor(range, 'prev');
  const rows = [];
  while (cursor && rows.length < boundedLimit) {
    rows.push(cursor.value);
    cursor = await cursor.continue();
  }

  return rows.reverse();
}

export async function countMessagesByConversation(conversationId) {
  const db = await getDb();
  const tx = db.transaction('messages', 'readonly');
  const index = tx.store.index('conversationId');
  return index.count(conversationId);
}

export async function loadMessageById(messageId) {
  const db = await getDb();
  return db.get('messages', messageId);
}

export async function deleteMessagesByConversation(conversationId) {
  const db = await getDb();
  const tx = db.transaction('messages', 'readwrite');
  const index = tx.store.index('conversationId');
  const keys = await index.getAllKeys(conversationId);
  for (const key of keys) {
    await tx.store.delete(key);
  }
  await tx.done;
}

export async function deleteMessageById(messageId) {
  const db = await getDb();
  await db.delete('messages', messageId);
}

export async function saveSetting(key, value) {
  const db = await getDb();
  await db.put('settings', { key, value });
}

export async function loadSetting(key) {
  const db = await getDb();
  const row = await db.get('settings', key);
  return row?.value;
}

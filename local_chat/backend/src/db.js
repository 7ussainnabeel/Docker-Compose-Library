const Database = require('better-sqlite3');

function initDb(dbFile) {
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');

  function ensureColumn(tableName, columnName, ddl) {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    if (!columns.some((col) => col.name === columnName)) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${ddl}`);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      avatar TEXT,
      about TEXT,
      pin TEXT,
      last_seen INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      from_user TEXT NOT NULL,
      to_user TEXT,
      group_id TEXT,
      payload TEXT NOT NULL,
      mime_type TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      event_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      user_id TEXT,
      remote_ip TEXT,
      details TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS temp_chat_settings (
      conversation_key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      peer_a TEXT,
      peer_b TEXT,
      group_id TEXT,
      duration_ms INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_direct ON messages (from_user, to_user, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_group ON messages (group_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_pending_user ON pending (user_id, created_at);
  `);

  ensureColumn('users', 'about', 'about TEXT');
  ensureColumn('users', 'pin', 'pin TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_pin ON users(pin) WHERE pin IS NOT NULL');

  const statements = {
    upsertUser: db.prepare(`
      INSERT INTO users (id, username, avatar, about, pin, last_seen)
      VALUES (@id, @username, @avatar, @about, @pin, @last_seen)
      ON CONFLICT(id) DO UPDATE SET
        username=excluded.username,
        avatar=excluded.avatar,
        about=excluded.about,
        pin=COALESCE(excluded.pin, users.pin),
        last_seen=excluded.last_seen
    `),
    listUsers: db.prepare('SELECT id, username, avatar, about, last_seen FROM users ORDER BY username ASC'),
    getUserById: db.prepare('SELECT id, username, avatar, about, pin, last_seen FROM users WHERE id = ? LIMIT 1'),
    findUserByPin: db.prepare('SELECT id, username, avatar, about, pin, last_seen FROM users WHERE pin = ? LIMIT 1'),
    insertGroup: db.prepare('INSERT INTO groups (id, name, created_by, created_at) VALUES (?, ?, ?, ?)'),
    groupById: db.prepare('SELECT id, name, created_by, created_at FROM groups WHERE id = ? LIMIT 1'),
    addMember: db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)'),
    groupsForUser: db.prepare(`
      SELECT g.id, g.name, g.created_by, g.created_at
      FROM groups g
      INNER JOIN group_members gm ON gm.group_id = g.id
      WHERE gm.user_id = ?
      ORDER BY g.created_at DESC
    `),
    membersForGroup: db.prepare('SELECT user_id FROM group_members WHERE group_id = ?'),
    insertMessage: db.prepare(`
      INSERT INTO messages (id, kind, from_user, to_user, group_id, payload, mime_type, created_at)
      VALUES (@id, @kind, @from_user, @to_user, @group_id, @payload, @mime_type, @created_at)
    `),
    directHistory: db.prepare(`
      SELECT * FROM messages
      WHERE kind IN ('direct-text', 'direct-photo', 'voice-note')
      AND (
        (from_user = @me AND to_user = @peer) OR
        (from_user = @peer AND to_user = @me)
      )
      ORDER BY created_at ASC
      LIMIT 1000
    `),
    groupHistory: db.prepare(`
      SELECT * FROM messages
      WHERE kind IN ('group-text', 'group-photo', 'voice-note')
      AND group_id = ?
      ORDER BY created_at ASC
      LIMIT 1000
    `),
    deleteDirectHistory: db.prepare(`
      DELETE FROM messages
      WHERE (
        (from_user = @me AND to_user = @peer) OR
        (from_user = @peer AND to_user = @me)
      )
    `),
    deleteGroupHistory: db.prepare('DELETE FROM messages WHERE group_id = ?'),
    upsertTempChat: db.prepare(`
      INSERT INTO temp_chat_settings (
        conversation_key, kind, peer_a, peer_b, group_id, duration_ms, expires_at, created_by, created_at
      ) VALUES (
        @conversation_key, @kind, @peer_a, @peer_b, @group_id, @duration_ms, @expires_at, @created_by, @created_at
      )
      ON CONFLICT(conversation_key) DO UPDATE SET
        duration_ms=excluded.duration_ms,
        expires_at=excluded.expires_at,
        created_by=excluded.created_by,
        created_at=excluded.created_at
    `),
    getTempDirect: db.prepare(`
      SELECT * FROM temp_chat_settings
      WHERE kind='direct' AND peer_a=@peer_a AND peer_b=@peer_b
      LIMIT 1
    `),
    getTempGroup: db.prepare(`
      SELECT * FROM temp_chat_settings
      WHERE kind='group' AND group_id=?
      LIMIT 1
    `),
    deleteTempByKey: db.prepare('DELETE FROM temp_chat_settings WHERE conversation_key = ?'),
    enqueuePending: db.prepare('INSERT INTO pending (user_id, event_json, created_at) VALUES (?, ?, ?)'),
    pendingForUser: db.prepare('SELECT id, event_json FROM pending WHERE user_id = ? ORDER BY created_at ASC'),
    deletePending: db.prepare('DELETE FROM pending WHERE id = ?'),
    countPendingForUser: db.prepare('SELECT COUNT(*) AS total FROM pending WHERE user_id = ?'),
    insertAudit: db.prepare(`
      INSERT INTO audit_logs (event_type, user_id, remote_ip, details, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
  };

  return { db, statements };
}

module.exports = { initDb };

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
      role TEXT NOT NULL DEFAULT 'member',
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
      created_at INTEGER NOT NULL,
      edited_text TEXT,
      edited_at INTEGER,
      deleted_for_me BOOLEAN DEFAULT 0,
      deleted_for_all BOOLEAN DEFAULT 0,
      pinned BOOLEAN DEFAULT 0,
      pinned_at INTEGER,
      forwarded_from_id TEXT,
      forwarded_from_user TEXT
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

    CREATE TABLE IF NOT EXISTS recorded_calls (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      initiator_id TEXT NOT NULL,
      group_id TEXT,
      peer_id TEXT,
      recording_url TEXT,
      duration_ms INTEGER NOT NULL,
      file_size INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS call_participants (
      call_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      left_at INTEGER,
      PRIMARY KEY (call_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_direct ON messages (from_user, to_user, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_group ON messages (group_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_pending_user ON pending (user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_recorded_calls_group ON recorded_calls (group_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_recorded_calls_direct ON recorded_calls (peer_id, created_at);
  `);

  ensureColumn('users', 'about', 'about TEXT');
  ensureColumn('users', 'pin', 'pin TEXT');
  ensureColumn('group_members', 'role', "role TEXT NOT NULL DEFAULT 'member'");
  ensureColumn('groups', 'avatar', 'avatar TEXT');
  ensureColumn('messages', 'edited_text', 'edited_text TEXT');
  ensureColumn('messages', 'edited_at', 'edited_at INTEGER');
  ensureColumn('messages', 'deleted_for_me', 'deleted_for_me BOOLEAN DEFAULT 0');
  ensureColumn('messages', 'deleted_for_all', 'deleted_for_all BOOLEAN DEFAULT 0');
  ensureColumn('messages', 'pinned', 'pinned BOOLEAN DEFAULT 0');
  ensureColumn('messages', 'pinned_at', 'pinned_at INTEGER');
  ensureColumn('messages', 'forwarded_from_id', 'forwarded_from_id TEXT');
  ensureColumn('messages', 'forwarded_from_user', 'forwarded_from_user TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_pinned ON messages (group_id, pinned) WHERE pinned = 1');
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
    addMember: db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)'),
    setMemberRole: db.prepare('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?'),
    removeMember: db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?'),
    memberRecordForGroupUser: db.prepare('SELECT group_id, user_id, role FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1'),
    groupsForUser: db.prepare(`
      SELECT g.id, g.name, g.created_by, g.created_at, gm.role AS my_role
      FROM groups g
      INNER JOIN group_members gm ON gm.group_id = g.id
      WHERE gm.user_id = ?
      ORDER BY g.created_at DESC
    `),
    membersForGroup: db.prepare('SELECT user_id FROM group_members WHERE group_id = ?'),
    membersDetailedForGroup: db.prepare(`
      SELECT gm.user_id AS id, gm.role, u.username, u.avatar, u.about
      FROM group_members gm
      INNER JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ?
      ORDER BY CASE gm.role WHEN 'admin' THEN 0 ELSE 1 END, u.username COLLATE NOCASE ASC
    `),
    renameGroup: db.prepare('UPDATE groups SET name = ? WHERE id = ?'),
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
    `),
    // Message operations
    editMessage: db.prepare('UPDATE messages SET edited_text = ?, edited_at = ? WHERE id = ?'),
    deleteMessageForMe: db.prepare('UPDATE messages SET deleted_for_me = 1 WHERE id = ?'),
    deleteMessageForAll: db.prepare('UPDATE messages SET deleted_for_all = 1 WHERE id = ?'),
    pinMessage: db.prepare('UPDATE messages SET pinned = 1, pinned_at = ? WHERE id = ?'),
    unpinMessage: db.prepare('UPDATE messages SET pinned = 0, pinned_at = NULL WHERE id = ?'),
    getPinnedMessagesForGroup: db.prepare(`
      SELECT * FROM messages
      WHERE group_id = ? AND pinned = 1
      ORDER BY pinned_at DESC
    `),
    getPinnedMessagesForDirect: db.prepare(`
      SELECT * FROM messages
      WHERE (
        (from_user = @me AND to_user = @peer) OR
        (from_user = @peer AND to_user = @me)
      )
      AND pinned = 1
      ORDER BY pinned_at DESC
    `),
    setGroupAvatar: db.prepare('UPDATE groups SET avatar = ? WHERE id = ?'),
    getGroupById: db.prepare('SELECT * FROM groups WHERE id = ? LIMIT 1'),
    // Recording operations
    insertRecording: db.prepare(`
      INSERT INTO recorded_calls (id, kind, initiator_id, group_id, peer_id, recording_url, duration_ms, file_size, created_at)
      VALUES (@id, @kind, @initiator_id, @group_id, @peer_id, @recording_url, @duration_ms, @file_size, @created_at)
    `),
    getRecordingsForGroup: db.prepare(`
      SELECT * FROM recorded_calls
      WHERE group_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `),
    getRecordingsForDirect: db.prepare(`
      SELECT * FROM recorded_calls
      WHERE peer_id = ? OR (initiator_id = ? AND kind = 'direct')
      ORDER BY created_at DESC
      LIMIT 100
    `),
    addCallParticipant: db.prepare(`
      INSERT OR IGNORE INTO call_participants (call_id, user_id, joined_at)
      VALUES (?, ?, ?)
    `),
    updateCallParticipantLeft: db.prepare(`
      UPDATE call_participants SET left_at = ? WHERE call_id = ? AND user_id = ?
    `)
  };

  return { db, statements };
}

module.exports = { initDb };

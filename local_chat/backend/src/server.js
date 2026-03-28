require('dotenv').config();

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const selfsigned = require('selfsigned');

const { initDb } = require('./db');
const { startDiscovery } = require('./discovery');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'chat.sqlite');
const FRONTEND_DIST = process.env.FRONTEND_DIST || path.join(__dirname, '..', '..', 'frontend', 'dist');
const HTTP_BODY_LIMIT = process.env.HTTP_BODY_LIMIT || '1mb';
const WS_MAX_PAYLOAD = Number(process.env.WS_MAX_PAYLOAD || 1048576);
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 60000);
const RATE_MAX_REQUESTS = Number(process.env.RATE_MAX_REQUESTS || 240);
const MAX_TEXT_LENGTH = Number(process.env.MAX_TEXT_LENGTH || 3000);
const MAX_TEXT_CIPHER_LENGTH = Number(process.env.MAX_TEXT_CIPHER_LENGTH || MAX_TEXT_LENGTH * 120);
const MAX_PHOTO_CIPHER_LENGTH = Number(process.env.MAX_PHOTO_CIPHER_LENGTH || 600000);
const MAX_GROUP_MEMBERS = Number(process.env.MAX_GROUP_MEMBERS || 128);
const MAX_PENDING_PER_USER = Number(process.env.MAX_PENDING_PER_USER || 5000);
const TLS_ENABLED = String(process.env.TLS_ENABLED || 'false').toLowerCase() === 'true';
const TLS_KEY_FILE = process.env.TLS_KEY_FILE || '';
const TLS_CERT_FILE = process.env.TLS_CERT_FILE || '';
const TLS_HOSTS = process.env.TLS_HOSTS || '';

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: HTTP_BODY_LIMIT }));

const { db, statements } = initDb(DB_FILE);
const onlineUsers = new Map();
const rateBucket = new Map();
const groupCalls = new Map();

db.exec("UPDATE group_members SET role = 'member' WHERE role IS NULL OR role NOT IN ('admin', 'member')");
db.exec(`
  UPDATE group_members
  SET role = 'admin'
  WHERE EXISTS (
    SELECT 1 FROM groups g
    WHERE g.id = group_members.group_id
      AND g.created_by = group_members.user_id
  )
`);

const discovery = startDiscovery({
  port: PORT,
  name: process.env.MDNS_NAME || `LAN Messenger ${PORT}`
});

function getTlsOptions() {
  if (TLS_KEY_FILE && TLS_CERT_FILE && fs.existsSync(TLS_KEY_FILE) && fs.existsSync(TLS_CERT_FILE)) {
    return {
      key: fs.readFileSync(TLS_KEY_FILE),
      cert: fs.readFileSync(TLS_CERT_FILE)
    };
  }

  const localIps = [];
  const interfaces = os.networkInterfaces();
  Object.values(interfaces).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (!entry || entry.internal) return;
      if (entry.family === 'IPv4' || entry.family === 'IPv6') {
        localIps.push(entry.address);
      }
    });
  });

  const configuredHosts = TLS_HOSTS
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  const hostEntries = ['localhost', ...configuredHosts];
  const ipEntries = ['127.0.0.1', '::1', ...localIps];

  const isIpValue = (value) => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) || value.includes(':');

  hostEntries.forEach((value) => {
    if (isIpValue(value)) ipEntries.push(value);
  });

  const finalHosts = Array.from(new Set(hostEntries.filter((value) => !isIpValue(value))));
  const finalIps = Array.from(new Set(ipEntries));

  const altNames = [
    ...finalHosts.map((value) => ({ type: 2, value })),
    ...finalIps.map((ip) => ({ type: 7, ip })),
  ];

  const attrs = [{ name: 'commonName', value: 'LAN Messenger Local' }];
  const pems = selfsigned.generate(attrs, {
    days: 3650,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames
      }
    ]
  });

  return {
    key: pems.private,
    cert: pems.cert
  };
}

function safeSend(ws, payload) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function audit(eventType, userId, remoteIp, details) {
  try {
    statements.insertAudit.run(eventType, userId || null, remoteIp || null, JSON.stringify(details || {}), Date.now());
  } catch {
    // Audit logging should never crash runtime paths.
  }
}

function makeUserList() {
  const users = statements.listUsers.all();
  const online = new Set(onlineUsers.keys());
  return users.map((u) => ({ ...u, online: online.has(u.id) }));
}

function broadcastPresence() {
  const payload = { action: 'presence-update', users: makeUserList() };
  for (const { ws } of onlineUsers.values()) {
    safeSend(ws, payload);
  }
}

function enqueueOrSend(userId, event) {
  const recipient = onlineUsers.get(userId);
  if (recipient) {
    safeSend(recipient.ws, event);
    return;
  }

  const pendingCount = statements.countPendingForUser.get(userId)?.total || 0;
  if (pendingCount >= MAX_PENDING_PER_USER) return;

  statements.enqueuePending.run(userId, JSON.stringify(event), Date.now());
}

function deliverPending(userId, ws) {
  const rows = statements.pendingForUser.all(userId);
  for (const row of rows) {
    try {
      safeSend(ws, JSON.parse(row.event_json));
    } finally {
      statements.deletePending.run(row.id);
    }
  }
}

function groupMembers(groupId) {
  return statements.membersForGroup.all(groupId).map((r) => r.user_id);
}

function groupMemberDetails(groupId) {
  const online = new Set(onlineUsers.keys());
  return statements.membersDetailedForGroup.all(groupId).map((member) => ({
    ...member,
    online: online.has(member.id)
  }));
}

function isGroupMember(groupId, userId) {
  if (!groupId || !userId) return false;
  const members = groupMembers(groupId);
  return members.includes(userId);
}

function isGroupAdmin(groupId, userId) {
  if (!groupId || !userId) return false;
  const group = statements.groupById.get(groupId);
  if (!group) return false;
  if (group.created_by === userId) return true;
  const membership = statements.memberRecordForGroupUser.get(groupId, userId);
  return Boolean(membership && membership.role === 'admin');
}

function broadcastGroupMeta(groupId, actorId = null) {
  const group = statements.groupById.get(groupId);
  if (!group) return;
  const members = groupMemberDetails(groupId);
  const memberIds = members.map((m) => m.id);
  const payload = {
    action: 'group-meta-updated',
    group,
    members,
    updatedBy: actorId,
    updatedAt: Date.now()
  };
  memberIds.forEach((memberId) => enqueueOrSend(memberId, payload));
}

function directPair(userA, userB) {
  return [userA, userB].sort();
}

function directConversationKey(userA, userB) {
  const [a, b] = directPair(userA, userB);
  return `direct:${a}:${b}`;
}

function groupConversationKey(groupId) {
  return `group:${groupId}`;
}

function getOrCreateGroupCall(groupId) {
  if (!groupCalls.has(groupId)) {
    groupCalls.set(groupId, { participants: new Set(), startedAt: Date.now() });
  }
  return groupCalls.get(groupId);
}

function emitGroupCallStatus(groupId) {
  const session = groupCalls.get(groupId);
  const participants = session ? Array.from(session.participants) : [];
  const payload = {
    action: 'group-call-status',
    groupId,
    ongoing: participants.length > 0,
    participants,
    participantCount: participants.length,
    startedAt: session?.startedAt || null,
    updatedAt: Date.now()
  };

  const members = groupMembers(groupId);
  members.forEach((memberId) => enqueueOrSend(memberId, payload));
}

function removeUserFromAllGroupCalls(userId) {
  for (const [groupId, session] of groupCalls.entries()) {
    if (!session.participants.has(userId)) continue;
    session.participants.delete(userId);
    if (session.participants.size === 0) {
      groupCalls.delete(groupId);
    }
    emitGroupCallStatus(groupId);
  }
}

function getTempSetting({ me, peerId, groupId }) {
  if (peerId) {
    const [peerA, peerB] = directPair(me, peerId);
    const row = statements.getTempDirect.get({ peer_a: peerA, peer_b: peerB });
    if (!row) return null;
    if (Date.now() > row.expires_at) {
      statements.deleteTempByKey.run(row.conversation_key);
      return null;
    }
    return row;
  }

  if (groupId) {
    const row = statements.getTempGroup.get(groupId);
    if (!row) return null;
    if (Date.now() > row.expires_at) {
      statements.deleteTempByKey.run(row.conversation_key);
      return null;
    }
    return row;
  }

  return null;
}

function isRateLimited(ip) {
  const now = Date.now();
  const bucket = rateBucket.get(ip) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + RATE_WINDOW_MS;
  }

  bucket.count += 1;
  rateBucket.set(ip, bucket);
  return bucket.count > RATE_MAX_REQUESTS;
}

function isValidEncryptedPayload(payload) {
  return payload
    && typeof payload === 'object'
    && typeof payload.iv === 'string'
    && typeof payload.cipher === 'string'
    && payload.iv.length <= 128
    && payload.cipher.length <= MAX_PHOTO_CIPHER_LENGTH;
}

app.use((req, res, next) => {
  const remoteIp = req.ip || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(`http:${remoteIp}`)) {
    audit('http-rate-limited', null, remoteIp, { path: req.path, method: req.method });
    return res.status(429).json({ error: 'Too many requests' });
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (TLS_ENABLED) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return next();
});

app.get('/health', (_, res) => {
  res.json({ ok: true, now: Date.now() });
});

app.get('/api/discovery', (_, res) => {
  res.json({ peers: discovery.listPeers() });
});

app.get('/api/config', (_, res) => {
  res.json({
    wsPath: '/ws',
    aesMode: 'AES-GCM',
    mdnsType: '_lanmsg._tcp'
  });
});

app.use(express.static(FRONTEND_DIST));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  return res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
});

const server = TLS_ENABLED ? https.createServer(getTlsOptions(), app) : http.createServer(app);
const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: WS_MAX_PAYLOAD
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.remoteIp = ws._socket?.remoteAddress || 'unknown';
  audit('ws-connected', null, ws.remoteIp, {});

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    if (raw.length > WS_MAX_PAYLOAD) {
      safeSend(ws, { action: 'error', code: 'payload-too-large' });
      audit('ws-payload-too-large', ws.userId, ws.remoteIp, { bytes: raw.length });
      return;
    }

    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      audit('ws-invalid-json', ws.userId, ws.remoteIp, {});
      return;
    }

    const actionName = typeof data?.action === 'string' ? data.action : null;
    const shouldRateLimit = actionName && actionName !== 'hello';
    if (shouldRateLimit && isRateLimited(`ws:${ws.remoteIp}`)) {
      safeSend(ws, { action: 'error', code: 'rate-limited' });
      audit('ws-rate-limited', ws.userId, ws.remoteIp, { action: actionName });
      return;
    }

    try {
      const action = data.action;
      const allowedActions = new Set([
        'hello',
        'typing',
        'create-group',
        'group-meta-request',
        'group-rename',
        'add-group-members',
        'remove-group-member',
        'set-group-member-role',
        'history-request',
        'delete-chat',
        'set-temp-chat',
        'clear-temp-chat',
        'direct-message',
        'direct-read',
        'group-message',
        'voice-note-start',
        'voice-note-chunk',
        'voice-note-end',
        'call-offer',
        'call-answer',
        'call-ice',
        'call-end',
        'call-fallback',
        'group-call-status-request',
        'group-call-join'
      ]);

      if (!allowedActions.has(action)) {
        safeSend(ws, { action: 'error', code: 'invalid-action' });
        audit('ws-invalid-action', ws.userId, ws.remoteIp, { action });
        return;
      }

      if (action === 'hello') {
        const requestedPin = typeof data.pin === 'string' ? data.pin.trim() : '';
        if (requestedPin && !/^(\d{4}|\d{6})$/.test(requestedPin)) {
          safeSend(ws, { action: 'error', code: 'invalid-pin' });
          return;
        }
        const authMode = typeof data.authMode === 'string' ? data.authMode : 'login';

        const requestedUsername = (data.username || 'Anonymous').slice(0, 30);
        const requestedAvatar = typeof data.avatar === 'string' && data.avatar.length <= 180000 ? data.avatar : null;
        const requestedAbout = typeof data.about === 'string'
          ? data.about.trim().slice(0, 120)
          : 'Hey there! I am using LAN Messenger.';
        const profileUpdate = Boolean(data.profileUpdate);
        if (profileUpdate && !ws.userId) {
          safeSend(ws, { action: 'error', code: 'unauthorized-profile-update' });
          return;
        }

        const byPin = requestedPin ? statements.findUserByPin.get(requestedPin) : null;
        if (authMode === 'login' && !byPin) {
          safeSend(ws, { action: 'error', code: 'pin-not-found' });
          return;
        }

        if (profileUpdate && byPin && byPin.id !== ws.userId) {
          safeSend(ws, { action: 'error', code: 'pin-in-use' });
          return;
        }

        if (authMode === 'new' && byPin && !profileUpdate) {
          safeSend(ws, { action: 'error', code: 'pin-in-use' });
          return;
        }

        const userId = profileUpdate
          ? ws.userId
          : authMode === 'login'
          ? byPin.id
          : (byPin?.id || data.userId || uuidv4());
        const existingUser = statements.getUserById.get(userId);

        let username = requestedUsername;
        let avatar = requestedAvatar;
        let about = requestedAbout || 'Hey there! I am using LAN Messenger.';

        if ((byPin || existingUser) && !profileUpdate) {
          const source = byPin || existingUser;
          username = source.username || username;
          avatar = source.avatar ?? avatar;
          about = source.about || about;
        }

        ws.userId = userId;
        onlineUsers.set(userId, { ws, username, avatar, about });

        statements.upsertUser.run({
          id: userId,
          username,
          avatar,
          about,
          pin: requestedPin || existingUser?.pin || byPin?.pin || null,
          last_seen: Date.now()
        });

        safeSend(ws, {
          action: 'hello-ack',
          userId,
          profile: {
            userId,
            username,
            avatar,
            about,
            pinSet: Boolean(requestedPin || existingUser?.pin || byPin?.pin)
          },
          users: makeUserList(),
          groups: statements.groupsForUser.all(userId)
        });

        deliverPending(userId, ws);
        broadcastPresence();
        audit('hello', userId, ws.remoteIp, { username, pinSet: Boolean(requestedPin), authMode });
        return;
      }

    if (!ws.userId) return;

    if (action === 'typing') {
      if (typeof data.isTyping !== 'boolean') return;

      if (data.groupId && !isGroupMember(data.groupId, ws.userId)) {
        safeSend(ws, { action: 'error', code: 'forbidden-group-access' });
        audit('forbidden-group-access', ws.userId, ws.remoteIp, { action, groupId: data.groupId });
        return;
      }

      const event = {
        action: 'typing',
        from: ws.userId,
        to: data.to || null,
        groupId: data.groupId || null,
        isTyping: Boolean(data.isTyping)
      };

      if (event.to) enqueueOrSend(event.to, event);
      if (event.groupId) {
        const members = groupMembers(event.groupId).filter((id) => id !== ws.userId);
        members.forEach((memberId) => enqueueOrSend(memberId, event));
      }
      return;
    }

    if (action === 'create-group') {
      const groupId = uuidv4();
      const name = (data.name || 'New Group').slice(0, 64);
      const members = Array.isArray(data.members) ? data.members : [];
      const uniqueMembers = Array.from(new Set([ws.userId, ...members])).slice(0, MAX_GROUP_MEMBERS);

      statements.insertGroup.run(groupId, name, ws.userId, Date.now());
      uniqueMembers.forEach((memberId) => statements.addMember.run(groupId, memberId, memberId === ws.userId ? 'admin' : 'member'));

      const event = { action: 'group-created', group: { id: groupId, name, created_by: ws.userId, created_at: Date.now() } };
      uniqueMembers.forEach((memberId) => enqueueOrSend(memberId, event));
      broadcastGroupMeta(groupId, ws.userId);
      audit('group-created', ws.userId, ws.remoteIp, { groupId, size: uniqueMembers.length });
      return;
    }

    if (action === 'group-meta-request') {
      if (!data.groupId) {
        safeSend(ws, { action: 'error', code: 'group-not-found' });
        return;
      }

      if (!isGroupMember(data.groupId, ws.userId)) {
        safeSend(ws, { action: 'error', code: 'forbidden-group-access' });
        audit('forbidden-group-access', ws.userId, ws.remoteIp, { action, groupId: data.groupId });
        return;
      }

      const group = statements.groupById.get(data.groupId);
      if (!group) {
        safeSend(ws, { action: 'error', code: 'group-not-found' });
        return;
      }

      safeSend(ws, {
        action: 'group-meta-response',
        group,
        members: groupMemberDetails(data.groupId)
      });
      return;
    }

    if (action === 'group-rename') {
      if (!data.groupId || typeof data.name !== 'string') {
        safeSend(ws, { action: 'error', code: 'invalid-group-name' });
        return;
      }

      if (!isGroupMember(data.groupId, ws.userId)) {
        safeSend(ws, { action: 'error', code: 'forbidden-group-access' });
        audit('forbidden-group-access', ws.userId, ws.remoteIp, { action, groupId: data.groupId });
        return;
      }

      const name = data.name.trim().slice(0, 64);
      if (!name) {
        safeSend(ws, { action: 'error', code: 'invalid-group-name' });
        return;
      }

      statements.renameGroup.run(name, data.groupId);
      broadcastGroupMeta(data.groupId, ws.userId);
      audit('group-renamed', ws.userId, ws.remoteIp, { groupId: data.groupId });
      return;
    }

    if (action === 'add-group-members') {
      if (!data.groupId || !Array.isArray(data.members)) {
        safeSend(ws, { action: 'error', code: 'invalid-group-members-payload' });
        return;
      }

      if (!isGroupAdmin(data.groupId, ws.userId)) {
        safeSend(ws, { action: 'error', code: 'forbidden-group-admin' });
        audit('forbidden-group-admin', ws.userId, ws.remoteIp, { action, groupId: data.groupId });
        return;
      }

      const candidates = Array.from(new Set(
        data.members
          .filter((id) => typeof id === 'string')
          .map((id) => id.trim())
          .filter((id) => id.length > 0 && id.length <= 80)
      )).slice(0, MAX_GROUP_MEMBERS);

      const before = new Set(groupMembers(data.groupId));
      candidates.forEach((memberId) => statements.addMember.run(data.groupId, memberId, 'member'));
      const after = groupMembers(data.groupId);
      const addedMembers = after.filter((memberId) => !before.has(memberId));
      const group = statements.groupById.get(data.groupId);

      if (!group) {
        safeSend(ws, { action: 'error', code: 'group-not-found' });
        return;
      }

      addedMembers.forEach((memberId) => enqueueOrSend(memberId, { action: 'group-created', group }));
      broadcastGroupMeta(data.groupId, ws.userId);

      safeSend(ws, { action: 'group-members-added-ack', groupId: data.groupId, count: addedMembers.length });
      audit('group-members-added', ws.userId, ws.remoteIp, { groupId: data.groupId, count: addedMembers.length });
      return;
    }

    if (action === 'remove-group-member') {
      if (!data.groupId || !data.memberId) {
        safeSend(ws, { action: 'error', code: 'invalid-group-members-payload' });
        return;
      }

      if (!isGroupAdmin(data.groupId, ws.userId)) {
        safeSend(ws, { action: 'error', code: 'forbidden-group-admin' });
        audit('forbidden-group-admin', ws.userId, ws.remoteIp, { action, groupId: data.groupId });
        return;
      }

      const group = statements.groupById.get(data.groupId);
      if (!group) {
        safeSend(ws, { action: 'error', code: 'group-not-found' });
        return;
      }

      if (data.memberId === group.created_by) {
        safeSend(ws, { action: 'error', code: 'cannot-remove-group-creator' });
        return;
      }

      const member = statements.memberRecordForGroupUser.get(data.groupId, data.memberId);
      if (!member) {
        safeSend(ws, { action: 'error', code: 'group-member-not-found' });
        return;
      }

      statements.removeMember.run(data.groupId, data.memberId);
      enqueueOrSend(data.memberId, { action: 'group-removed', groupId: data.groupId, removedBy: ws.userId, createdAt: Date.now() });
      broadcastGroupMeta(data.groupId, ws.userId);
      audit('group-member-removed', ws.userId, ws.remoteIp, { groupId: data.groupId, memberId: data.memberId });
      return;
    }

    if (action === 'set-group-member-role') {
      if (!data.groupId || !data.memberId || !['admin', 'member'].includes(data.role)) {
        safeSend(ws, { action: 'error', code: 'invalid-group-role' });
        return;
      }

      const group = statements.groupById.get(data.groupId);
      if (!group) {
        safeSend(ws, { action: 'error', code: 'group-not-found' });
        return;
      }

      if (group.created_by !== ws.userId) {
        safeSend(ws, { action: 'error', code: 'forbidden-group-owner' });
        audit('forbidden-group-owner', ws.userId, ws.remoteIp, { action, groupId: data.groupId });
        return;
      }

      if (data.memberId === group.created_by) {
        safeSend(ws, { action: 'error', code: 'cannot-change-group-creator-role' });
        return;
      }

      const member = statements.memberRecordForGroupUser.get(data.groupId, data.memberId);
      if (!member) {
        safeSend(ws, { action: 'error', code: 'group-member-not-found' });
        return;
      }

      statements.setMemberRole.run(data.role, data.groupId, data.memberId);
      broadcastGroupMeta(data.groupId, ws.userId);
      audit('group-member-role-updated', ws.userId, ws.remoteIp, { groupId: data.groupId, memberId: data.memberId, role: data.role });
      return;
    }

    if (action === 'history-request') {
      const limit = Math.max(20, Math.min(Number(data.limit) || 120, 300));
      const before = Number(data.before);
      const hasBefore = Number.isFinite(before) && before > 0;

      if (data.peerId) {
        const messages = hasBefore
          ? db.prepare(`
              SELECT * FROM messages
              WHERE kind IN ('direct-text', 'direct-photo', 'voice-note')
              AND (
                (from_user = @me AND to_user = @peer) OR
                (from_user = @peer AND to_user = @me)
              )
              AND created_at < @before
              ORDER BY created_at DESC
              LIMIT @limit
            `).all({ me: ws.userId, peer: data.peerId, before, limit })
          : db.prepare(`
              SELECT * FROM messages
              WHERE kind IN ('direct-text', 'direct-photo', 'voice-note')
              AND (
                (from_user = @me AND to_user = @peer) OR
                (from_user = @peer AND to_user = @me)
              )
              ORDER BY created_at DESC
              LIMIT @limit
            `).all({ me: ws.userId, peer: data.peerId, limit });

        const ordered = messages.reverse();
        safeSend(ws, { action: 'history-response', peerId: data.peerId, messages: ordered, hasMore: messages.length === limit });
        return;
      }

      if (data.groupId) {
        if (!isGroupMember(data.groupId, ws.userId)) {
          safeSend(ws, { action: 'error', code: 'forbidden-group-access' });
          audit('forbidden-group-access', ws.userId, ws.remoteIp, { action, groupId: data.groupId });
          return;
        }

        const messages = hasBefore
          ? db.prepare(`
              SELECT * FROM messages
              WHERE kind IN ('group-text', 'group-photo', 'voice-note')
              AND group_id = @groupId
              AND created_at < @before
              ORDER BY created_at DESC
              LIMIT @limit
            `).all({ groupId: data.groupId, before, limit })
          : db.prepare(`
              SELECT * FROM messages
              WHERE kind IN ('group-text', 'group-photo', 'voice-note')
              AND group_id = @groupId
              ORDER BY created_at DESC
              LIMIT @limit
            `).all({ groupId: data.groupId, limit });

        const ordered = messages.reverse();
        safeSend(ws, { action: 'history-response', groupId: data.groupId, messages: ordered, hasMore: messages.length === limit });
      }
      return;
    }

    if (action === 'delete-chat') {
      if (data.peerId) {
        statements.deleteDirectHistory.run({ me: ws.userId, peer: data.peerId });

        const event = {
          action: 'chat-deleted',
          peerId: data.peerId,
          deletedBy: ws.userId,
          createdAt: Date.now()
        };

        safeSend(ws, event);
        enqueueOrSend(data.peerId, {
          action: 'chat-deleted',
          peerId: ws.userId,
          deletedBy: ws.userId,
          createdAt: Date.now()
        });
        audit('chat-deleted-direct', ws.userId, ws.remoteIp, { peerId: data.peerId });
        return;
      }

      if (data.groupId) {
        if (!isGroupMember(data.groupId, ws.userId)) {
          safeSend(ws, { action: 'error', code: 'forbidden-group-access' });
          audit('forbidden-group-access', ws.userId, ws.remoteIp, { action, groupId: data.groupId });
          return;
        }

        statements.deleteGroupHistory.run(data.groupId);

        const members = groupMembers(data.groupId);
        members.forEach((memberId) => enqueueOrSend(memberId, {
          action: 'chat-deleted',
          groupId: data.groupId,
          deletedBy: ws.userId,
          createdAt: Date.now()
        }));
        audit('chat-deleted-group', ws.userId, ws.remoteIp, { groupId: data.groupId });
      }
      return;
    }

    if (action === 'set-temp-chat') {
      const durationMs = Number(data.durationMs || 0);
      const allowedDurations = new Set([10 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000, 2 * 60 * 60 * 1000]);
      if (!allowedDurations.has(durationMs)) {
        safeSend(ws, { action: 'error', code: 'invalid-temp-duration' });
        return;
      }

      const expiresAt = Date.now() + durationMs;
      if (data.peerId) {
        const [peerA, peerB] = directPair(ws.userId, data.peerId);
        const conversationKey = directConversationKey(ws.userId, data.peerId);
        statements.upsertTempChat.run({
          conversation_key: conversationKey,
          kind: 'direct',
          peer_a: peerA,
          peer_b: peerB,
          group_id: null,
          duration_ms: durationMs,
          expires_at: expiresAt,
          created_by: ws.userId,
          created_at: Date.now()
        });

        const event = { action: 'temp-chat-updated', peerId: data.peerId, durationMs, expiresAt, by: ws.userId };
        safeSend(ws, event);
        enqueueOrSend(data.peerId, { action: 'temp-chat-updated', peerId: ws.userId, durationMs, expiresAt, by: ws.userId });
        audit('temp-chat-direct', ws.userId, ws.remoteIp, { peerId: data.peerId, durationMs, expiresAt });
        return;
      }

      if (data.groupId) {
        if (!isGroupMember(data.groupId, ws.userId)) {
          safeSend(ws, { action: 'error', code: 'forbidden-group-access' });
          audit('forbidden-group-access', ws.userId, ws.remoteIp, { action, groupId: data.groupId });
          return;
        }

        const conversationKey = groupConversationKey(data.groupId);
        statements.upsertTempChat.run({
          conversation_key: conversationKey,
          kind: 'group',
          peer_a: null,
          peer_b: null,
          group_id: data.groupId,
          duration_ms: durationMs,
          expires_at: expiresAt,
          created_by: ws.userId,
          created_at: Date.now()
        });

        const members = groupMembers(data.groupId);
        members.forEach((memberId) => enqueueOrSend(memberId, { action: 'temp-chat-updated', groupId: data.groupId, durationMs, expiresAt, by: ws.userId }));
        audit('temp-chat-group', ws.userId, ws.remoteIp, { groupId: data.groupId, durationMs, expiresAt });
      }
      return;
    }

    if (action === 'clear-temp-chat') {
      if (data.peerId) {
        const key = directConversationKey(ws.userId, data.peerId);
        statements.deleteTempByKey.run(key);
        safeSend(ws, { action: 'temp-chat-cleared', peerId: data.peerId });
        enqueueOrSend(data.peerId, { action: 'temp-chat-cleared', peerId: ws.userId });
        return;
      }

      if (data.groupId) {
        if (!isGroupMember(data.groupId, ws.userId)) {
          safeSend(ws, { action: 'error', code: 'forbidden-group-access' });
          audit('forbidden-group-access', ws.userId, ws.remoteIp, { action, groupId: data.groupId });
          return;
        }

        const key = groupConversationKey(data.groupId);
        statements.deleteTempByKey.run(key);
        const members = groupMembers(data.groupId);
        members.forEach((memberId) => enqueueOrSend(memberId, { action: 'temp-chat-cleared', groupId: data.groupId }));
      }
      return;
    }

    if (action === 'group-call-status-request') {
      if (!data.groupId || !isGroupMember(data.groupId, ws.userId)) {
        safeSend(ws, { action: 'error', code: 'forbidden-group-access' });
        return;
      }
      const session = groupCalls.get(data.groupId);
      safeSend(ws, {
        action: 'group-call-status',
        groupId: data.groupId,
        ongoing: Boolean(session && session.participants.size > 0),
        participants: session ? Array.from(session.participants) : [],
        participantCount: session ? session.participants.size : 0,
        startedAt: session?.startedAt || null,
        updatedAt: Date.now()
      });
      return;
    }

    if (action === 'group-call-join') {
      if (!data.groupId || !isGroupMember(data.groupId, ws.userId)) {
        safeSend(ws, { action: 'error', code: 'forbidden-group-access' });
        return;
      }

      const session = groupCalls.get(data.groupId);
      if (!session || session.participants.size === 0) {
        safeSend(ws, { action: 'error', code: 'group-call-not-active' });
        return;
      }

      session.participants.add(ws.userId);
      const targets = Array.from(session.participants).filter((id) => id !== ws.userId);
      targets.forEach((memberId) => enqueueOrSend(memberId, {
        action: 'group-call-join-request',
        groupId: data.groupId,
        from: ws.userId,
        createdAt: Date.now()
      }));

      emitGroupCallStatus(data.groupId);
      return;
    }

      if (action === 'direct-message') {
        if (!data.to || !isValidEncryptedPayload(data.payload)) {
          safeSend(ws, { action: 'error', code: 'invalid-direct-payload' });
          return;
        }

        const contentType = data.contentType === 'photo' ? 'photo' : 'text';
        const maxCipherLength = contentType === 'photo' ? MAX_PHOTO_CIPHER_LENGTH : MAX_TEXT_CIPHER_LENGTH;
        if ((data.payload.cipher || '').length > maxCipherLength) {
          safeSend(ws, { action: 'error', code: 'message-too-large' });
          return;
        }

        const tempSetting = getTempSetting({ me: ws.userId, peerId: data.to, groupId: null });
        const expiresAt = tempSetting ? Date.now() + tempSetting.duration_ms : null;

        const event = {
          action: 'direct-message',
          id: data.id || uuidv4(),
          from: ws.userId,
          to: data.to,
          payload: data.payload,
          contentType,
          expiresAt,
          createdAt: data.createdAt || Date.now()
        };

        statements.insertMessage.run({
          id: event.id,
          kind: contentType === 'photo' ? 'direct-photo' : 'direct-text',
          from_user: event.from,
          to_user: event.to,
          group_id: null,
          payload: JSON.stringify({ encrypted: event.payload, expiresAt }),
          mime_type: 'application/json',
          created_at: event.createdAt
        });

        const recipientOnline = onlineUsers.has(event.to);
        enqueueOrSend(event.to, event);
        safeSend(ws, { action: 'direct-message-ack', id: event.id });
        if (recipientOnline) {
          safeSend(ws, { action: 'direct-delivered', id: event.id, to: event.to });
        }
        audit('direct-message', ws.userId, ws.remoteIp, { to: event.to, id: event.id, contentType });
        return;
      }

    if (action === 'direct-read') {
      if (!data.peerId) return;

      const ids = Array.isArray(data.ids)
        ? data.ids.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 80).slice(0, 200)
        : [];

      if (!ids.length) return;

      enqueueOrSend(data.peerId, {
        action: 'direct-read',
        from: ws.userId,
        ids,
        createdAt: Date.now()
      });

      audit('direct-read', ws.userId, ws.remoteIp, { to: data.peerId, count: ids.length });
      return;
    }

      if (action === 'group-message') {
        if (!data.groupId || !isValidEncryptedPayload(data.payload)) {
          safeSend(ws, { action: 'error', code: 'invalid-group-payload' });
          return;
        }

        if (!isGroupMember(data.groupId, ws.userId)) {
          safeSend(ws, { action: 'error', code: 'forbidden-group-access' });
          audit('forbidden-group-access', ws.userId, ws.remoteIp, { action, groupId: data.groupId });
          return;
        }

        const contentType = data.contentType === 'photo' ? 'photo' : 'text';
        const maxCipherLength = contentType === 'photo' ? MAX_PHOTO_CIPHER_LENGTH : MAX_TEXT_CIPHER_LENGTH;
        if ((data.payload.cipher || '').length > maxCipherLength) {
          safeSend(ws, { action: 'error', code: 'message-too-large' });
          return;
        }

        const tempSetting = getTempSetting({ me: ws.userId, peerId: null, groupId: data.groupId });
        const expiresAt = tempSetting ? Date.now() + tempSetting.duration_ms : null;

        const event = {
          action: 'group-message',
          id: data.id || uuidv4(),
          from: ws.userId,
          groupId: data.groupId,
          payload: data.payload,
          contentType,
          expiresAt,
          createdAt: data.createdAt || Date.now()
        };

        statements.insertMessage.run({
          id: event.id,
          kind: contentType === 'photo' ? 'group-photo' : 'group-text',
          from_user: event.from,
          to_user: null,
          group_id: event.groupId,
          payload: JSON.stringify({ encrypted: event.payload, expiresAt }),
          mime_type: 'application/json',
          created_at: event.createdAt
        });

        const members = groupMembers(event.groupId).filter((id) => id !== ws.userId);
        members.forEach((memberId) => enqueueOrSend(memberId, event));
        safeSend(ws, { action: 'group-message-ack', id: event.id });
        audit('group-message', ws.userId, ws.remoteIp, { groupId: event.groupId, id: event.id, contentType });
        return;
      }

    if (action === 'voice-note-start' || action === 'voice-note-chunk' || action === 'voice-note-end') {
      if (!data.clipId || typeof data.clipId !== 'string' || data.clipId.length > 64) {
        safeSend(ws, { action: 'error', code: 'invalid-clip-id' });
        return;
      }

      if (data.groupId && !isGroupMember(data.groupId, ws.userId)) {
        safeSend(ws, { action: 'error', code: 'forbidden-group-access' });
        audit('forbidden-group-access', ws.userId, ws.remoteIp, { action, groupId: data.groupId });
        return;
      }

      if (action === 'voice-note-chunk' && !isValidEncryptedPayload(data.payload)) {
        safeSend(ws, { action: 'error', code: 'invalid-voice-payload' });
        return;
      }

      const event = {
        action,
        clipId: data.clipId,
        from: ws.userId,
        to: data.to || null,
        groupId: data.groupId || null,
        payload: data.payload || null,
        seq: data.seq || 0,
        mimeType: data.mimeType || 'audio/webm',
        createdAt: data.createdAt || Date.now()
      };

      if (action === 'voice-note-end') {
        statements.insertMessage.run({
          id: data.clipId,
          kind: 'voice-note',
          from_user: ws.userId,
          to_user: event.to,
          group_id: event.groupId,
          payload: JSON.stringify({ clipId: event.clipId, mimeType: event.mimeType }),
          mime_type: event.mimeType,
          created_at: event.createdAt
        });
      }

      if (event.to) enqueueOrSend(event.to, event);
      if (event.groupId) {
        const members = groupMembers(event.groupId).filter((id) => id !== ws.userId);
        members.forEach((memberId) => enqueueOrSend(memberId, event));
      }

      audit(action, ws.userId, ws.remoteIp, { clipId: data.clipId, to: event.to, groupId: event.groupId });
      return;
    }

    if (action === 'message-forward') {
      if (!data.messageId || !data.toGroupId && !data.toPeerId) return;

      try {
        const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(data.messageId);
        if (!msg) return;

        const newMsgId = uuidv4();
        const newMsg = {
          id: newMsgId,
          kind: data.toGroupId ? 'group-text' : 'direct-text',
          from_user: ws.userId,
          to_user: data.toPeerId || null,
          group_id: data.toGroupId || null,
          payload: msg.payload,
          mime_type: msg.mime_type,
          created_at: Date.now(),
          forwarded_from_id: msg.id,
          forwarded_from_user: msg.from_user
        };

        statements.insertMessage.run(newMsg);

        const event = {
          action: 'message',
          ...newMsg,
          replyTo: null,
          reaction: '',
          starred: false
        };

        if (data.toPeerId) {
          enqueueOrSend(data.toPeerId, event);
        } else if (data.toGroupId) {
          const members = groupMembers(data.toGroupId).filter((id) => id !== ws.userId);
          members.forEach((memberId) => enqueueOrSend(memberId, event));
        }

        safeSend(ws, { action: 'message-forward-ack', messageId: newMsgId });
        audit('message-forward', ws.userId, ws.remoteIp, { fromMsgId: data.messageId });
      } catch {
        safeSend(ws, { action: 'error', code: 'forward-failed' });
      }
      return;
    }

    if (action === 'message-edit') {
      if (!data.messageId || !data.editedText) return;

      try {
        const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(data.messageId);
        if (!msg || msg.from_user !== ws.userId) return;

        statements.editMessage.run(data.editedText, Date.now(), data.messageId);

        const event = {
          action: 'message-edited',
          messageId: data.messageId,
          editedText: data.editedText,
          editedAt: Date.now()
        };

        if (msg.to_user) {
          enqueueOrSend(msg.to_user, event);
        } else if (msg.group_id) {
          const members = groupMembers(msg.group_id).filter((id) => id !== ws.userId);
          members.forEach((memberId) => enqueueOrSend(memberId, event));
        }

        safeSend(ws, { action: 'message-edit-ack', messageId: data.messageId });
        audit('message-edit', ws.userId, ws.remoteIp, { messageId: data.messageId });
      } catch {
        safeSend(ws, { action: 'error', code: 'edit-failed' });
      }
      return;
    }

    if (action === 'message-delete-for-me') {
      if (!data.messageId) return;

      try {
        statements.deleteMessageForMe.run(data.messageId);
        safeSend(ws, { action: 'message-delete-ack', messageId: data.messageId });
        audit('message-delete-for-me', ws.userId, ws.remoteIp, { messageId: data.messageId });
      } catch {
        safeSend(ws, { action: 'error', code: 'delete-failed' });
      }
      return;
    }

    if (action === 'message-delete-for-all') {
      if (!data.messageId) return;

      try {
        const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(data.messageId);
        if (!msg || msg.from_user !== ws.userId) return;

        statements.deleteMessageForAll.run(data.messageId);

        const event = {
          action: 'message-deleted',
          messageId: data.messageId
        };

        if (msg.to_user) {
          enqueueOrSend(msg.to_user, event);
        } else if (msg.group_id) {
          const members = groupMembers(msg.group_id).filter((id) => id !== ws.userId);
          members.forEach((memberId) => enqueueOrSend(memberId, event));
        }

        safeSend(ws, { action: 'message-delete-ack', messageId: data.messageId });
        audit('message-delete-for-all', ws.userId, ws.remoteIp, { messageId: data.messageId });
      } catch {
        safeSend(ws, { action: 'error', code: 'delete-failed' });
      }
      return;
    }

    if (action === 'message-pin') {
      if (!data.messageId) return;

      try {
        const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(data.messageId);
        if (!msg) return;

        const isAdmin = db.prepare(
          'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?'
        ).get(msg.group_id, ws.userId)?.role === 'admin';

        if (msg.group_id && !isAdmin && msg.from_user !== ws.userId) return;

        statements.pinMessage.run(Date.now(), data.messageId);

        const event = {
          action: 'message-pinned',
          messageId: data.messageId,
          pinnedAt: Date.now()
        };

        if (msg.group_id) {
          const members = groupMembers(msg.group_id);
          members.forEach((memberId) => enqueueOrSend(memberId, event));
        } else if (msg.to_user) {
          enqueueOrSend(msg.to_user, event);
        }

        safeSend(ws, { action: 'message-pin-ack', messageId: data.messageId });
        audit('message-pin', ws.userId, ws.remoteIp, { messageId: data.messageId });
      } catch {
        safeSend(ws, { action: 'error', code: 'pin-failed' });
      }
      return;
    }

    if (action === 'message-unpin') {
      if (!data.messageId) return;

      try {
        const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(data.messageId);
        if (!msg) return;

        const isAdmin = db.prepare(
          'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?'
        ).get(msg.group_id, ws.userId)?.role === 'admin';

        if (msg.group_id && !isAdmin && msg.from_user !== ws.userId) return;

        statements.unpinMessage.run(data.messageId);

        const event = {
          action: 'message-unpinned',
          messageId: data.messageId
        };

        if (msg.group_id) {
          const members = groupMembers(msg.group_id);
          members.forEach((memberId) => enqueueOrSend(memberId, event));
        } else if (msg.to_user) {
          enqueueOrSend(msg.to_user, event);
        }

        safeSend(ws, { action: 'message-unpin-ack', messageId: data.messageId });
        audit('message-unpin', ws.userId, ws.remoteIp, { messageId: data.messageId });
      } catch {
        safeSend(ws, { action: 'error', code: 'unpin-failed' });
      }
      return;
    }

    if (action === 'get-pinned-messages') {
      if (!data.groupId && !data.peerId) return;

      try {
        let pinned = [];
        if (data.groupId) {
          pinned = statements.getPinnedMessagesForGroup.all(data.groupId);
        } else {
          pinned = statements.getPinnedMessagesForDirect.all({ me: ws.userId, peer: data.peerId });
        }

        safeSend(ws, {
          action: 'pinned-messages-list',
          groupId: data.groupId,
          peerId: data.peerId,
          messages: pinned
        });
        audit('get-pinned-messages', ws.userId, ws.remoteIp, { groupId: data.groupId, peerId: data.peerId });
      } catch {
        safeSend(ws, { action: 'error', code: 'get-pinned-failed' });
      }
      return;
    }

    if (action === 'call-recording-start') {
      if (!data.groupId && !data.peerId) return;

      try {
        const recordingId = uuidv4();
        const now = Date.now();
        const participants = data.groupId
          ? [ws.userId, ...groupMembers(data.groupId)].filter(Boolean)
          : [ws.userId, data.peerId].filter(Boolean);

        // Store recording metadata
        const recordingData = {
          id: recordingId,
          initiator_id: ws.userId,
          kind: data.groupId ? 'group' : 'direct',
          group_id: data.groupId || null,
          peer_id: data.peerId || null,
          recording_url: null,
          duration_ms: 0,
          file_size: 0,
          created_at: now
        };

        db.prepare(`
          INSERT INTO recorded_calls (id, initiator_id, kind, group_id, peer_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(recordingData.id, recordingData.initiator_id, recordingData.kind, recordingData.group_id, recordingData.peer_id, recordingData.created_at);

        participants.forEach((userId) => {
          db.prepare(`
            INSERT OR IGNORE INTO call_participants (call_id, user_id, joined_at)
            VALUES (?, ?, ?)
          `).run(recordingId, userId, now);
        });

        const event = {
          action: 'recording-started',
          recordingId: recordingId,
          initiatorId: ws.userId,
          createdAt: now
        };

        if (data.groupId) {
          const members = groupMembers(data.groupId);
          members.forEach((memberId) => enqueueOrSend(memberId, event));
        } else if (data.peerId) {
          enqueueOrSend(data.peerId, event);
        }

        safeSend(ws, { action: 'recording-start-ack', recordingId: recordingId });
        audit('call-recording-start', ws.userId, ws.remoteIp, { groupId: data.groupId, peerId: data.peerId });
      } catch (error) {
        safeSend(ws, { action: 'error', code: 'recording-start-failed', message: error.message });
      }
      return;
    }

    if (action === 'call-recording-stop') {
      if (!data.recordingId) return;

      try {
        const recording = db.prepare('SELECT * FROM recorded_calls WHERE id = ?').get(data.recordingId);
        if (!recording || recording.initiator_id !== ws.userId) return;

        const durationMs = data.durationMs || Date.now() - recording.created_at;

        db.prepare(`
          UPDATE recorded_calls SET duration_ms = ?, recording_url = ?, file_size = ? WHERE id = ?
        `).run(durationMs, data.recordingUrl || null, data.fileSize || 0, data.recordingId);

        // Mark all participants as left
        db.prepare(`
          UPDATE call_participants SET left_at = ? WHERE call_id = ? AND left_at IS NULL
        `).run(Date.now(), data.recordingId);

        const event = {
          action: 'recording-stopped',
          recordingId: data.recordingId,
          durationMs: durationMs,
          recordingUrl: data.recordingUrl || null
        };

        if (recording.group_id) {
          const members = groupMembers(recording.group_id);
          members.forEach((memberId) => enqueueOrSend(memberId, event));
        } else {
          enqueueOrSend(recording.peer_id, event);
        }

        safeSend(ws, { action: 'recording-stop-ack', recordingId: data.recordingId });
        audit('call-recording-stop', ws.userId, ws.remoteIp, { recordingId: data.recordingId });
      } catch (error) {
        safeSend(ws, { action: 'error', code: 'recording-stop-failed' });
      }
      return;
    }

    if (action === 'get-call-recordings') {
      if (!data.groupId && !data.peerId) return;

      try {
        let recordings = [];
        if (data.groupId) {
          recordings = statements.getRecordingsForGroup.all(data.groupId);
        } else {
          recordings = statements.getRecordingsForDirect.all(data.peerId, ws.userId);
        }

        safeSend(ws, {
          action: 'call-recordings-list',
          groupId: data.groupId,
          peerId: data.peerId,
          recordings: recordings
        });
        audit('get-call-recordings', ws.userId, ws.remoteIp, { groupId: data.groupId, peerId: data.peerId });
      } catch {
        safeSend(ws, { action: 'error', code: 'get-recordings-failed' });
      }
      return;
    }

    if (action === 'temp-chat-expire') {
      if (!data.conversationKey) return;

      try {
        // Delete all messages in the conversation
        const tempSettings = db.prepare(
          'SELECT * FROM temp_chat_settings WHERE conversation_key = ?'
        ).get(data.conversationKey);

        if (!tempSettings) return;

        if (tempSettings.kind === 'direct') {
          db.prepare(`
            DELETE FROM messages
            WHERE (
              (from_user = ? AND to_user = ?) OR
              (from_user = ? AND to_user = ?)
            )
          `).run(tempSettings.peer_a, tempSettings.peer_b, tempSettings.peer_b, tempSettings.peer_a);
        } else if (tempSettings.kind === 'group') {
          db.prepare('DELETE FROM messages WHERE group_id = ?').run(tempSettings.group_id);
        }

        // Delete temp settings
        statements.deleteTempByKey.run(data.conversationKey);

        const event = {
          action: 'temp-chat-expired',
          conversationKey: data.conversationKey
        };

        if (tempSettings.kind === 'direct') {
          enqueueOrSend(tempSettings.peer_a, event);
          enqueueOrSend(tempSettings.peer_b, event);
        } else {
          const members = groupMembers(tempSettings.group_id);
          members.forEach((memberId) => enqueueOrSend(memberId, event));
        }

        audit('temp-chat-expire', ws.userId, ws.remoteIp, { conversationKey: data.conversationKey });
      } catch {
        safeSend(ws, { action: 'error', code: 'temp-chat-expire-failed' });
      }
      return;
    }

      if (action === 'call-offer' || action === 'call-answer' || action === 'call-ice' || action === 'call-end' || action === 'call-fallback') {
        if (!data.to) return;

        if (data.groupId) {
          if (!isGroupMember(data.groupId, ws.userId) || !isGroupMember(data.groupId, data.to)) {
            safeSend(ws, { action: 'error', code: 'forbidden-group-access' });
            return;
          }
        }

        if (action === 'call-offer' && data.groupId) {
          const session = getOrCreateGroupCall(data.groupId);
          session.participants.add(ws.userId);
          session.participants.add(data.to);
          emitGroupCallStatus(data.groupId);
        }

        if (action === 'call-end' && data.groupId) {
          const session = groupCalls.get(data.groupId);
          if (session) {
            session.participants.delete(ws.userId);
            if (session.participants.size === 0) {
              groupCalls.delete(data.groupId);
            }
            emitGroupCallStatus(data.groupId);
          }
        }

        const event = {
          action,
          from: ws.userId,
          to: data.to,
          sdp: data.sdp || null,
          candidate: data.candidate || null,
          reason: data.reason || null,
          groupId: data.groupId || null,
          createdAt: Date.now()
        };

        enqueueOrSend(data.to, event);
        audit(action, ws.userId, ws.remoteIp, { to: data.to });
        return;
      }
    } catch (error) {
      safeSend(ws, { action: 'error', code: 'server-processing-error' });
      audit('ws-handler-error', ws.userId, ws.remoteIp, {
        action: data?.action || null,
        message: error?.message || 'unknown'
      });
    }
  });

  ws.on('close', () => {
    removeUserFromAllGroupCalls(ws.userId);

    if (ws.userId) {
      const persisted = statements.getUserById.get(ws.userId);
      statements.upsertUser.run({
        id: ws.userId,
        username: onlineUsers.get(ws.userId)?.username || 'Anonymous',
        avatar: onlineUsers.get(ws.userId)?.avatar || null,
        about: onlineUsers.get(ws.userId)?.about || persisted?.about || 'Hey there! I am using LAN Messenger.',
        pin: persisted?.pin || null,
        last_seen: Date.now()
      });
    }

    onlineUsers.delete(ws.userId);
    broadcastPresence();
    audit('ws-closed', ws.userId, ws.remoteIp, {});
  });
});

const heartbeat = setInterval(() => {
  wss.clients.forEach((socket) => {
    if (!socket.isAlive) {
      socket.terminate();
      return;
    }

    socket.isAlive = false;
    socket.ping();
  });
}, 30000);

server.listen(PORT, HOST, () => {
  const scheme = TLS_ENABLED ? 'https' : 'http';
  console.log(`LAN Messenger listening on ${scheme}://${HOST}:${PORT}`);
});

process.on('SIGINT', () => {
  clearInterval(heartbeat);
  discovery.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  clearInterval(heartbeat);
  discovery.stop();
  process.exit(0);
});

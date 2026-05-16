/**
 * Socket.io real-time layer: guilds, channels, DMs, RBAC, messages, reactions, typing.
 * Serves static files from this directory.
 */
'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PERMISSIONS = {
  VIEW_CHANNEL: 1 << 0,
  SEND_MESSAGES: 1 << 1,
  MANAGE_CHANNELS: 1 << 2,
  MANAGE_GUILD: 1 << 3,
  ADMINISTRATOR: 1 << 4,
  KICK_MEMBERS: 1 << 5,
};

function genId() {
  return crypto.randomBytes(10).toString('hex');
}

function genInviteCode() {
  return crypto.randomBytes(5).toString('hex').toUpperCase();
}

const DEFAULT_GUILD_ID = 'guild_default';
const inviteToGuild = {};

const store = {
  guilds: {
    [DEFAULT_GUILD_ID]: {
      id: DEFAULT_GUILD_ID,
      name: 'School Portal',
      icon: null,
      ownerId: null,
      roles: {
        role_everyone: {
          id: 'role_everyone',
          name: '@everyone',
          permissions: PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.SEND_MESSAGES,
        },
        role_admin: {
          id: 'role_admin',
          name: 'Admin',
          permissions: Object.values(PERMISSIONS).reduce((a, b) => a | b, 0),
        },
      },
      members: {},
      channels: [
        { id: 'ch_general', name: 'general', type: 'text', category: 'Text Channels', position: 0 },
        { id: 'ch_random', name: 'random', type: 'text', category: 'Text Channels', position: 1 },
        { id: 'ch_homework', name: 'homework-help', type: 'text', category: 'Text Channels', position: 2 },
        { id: 'ch_voice_lounge', name: 'Lounge', type: 'voice', category: 'Voice Channels', position: 0 },
      ],
    },
  },
  /** @type {Record<string, Array<object>>} */
  messages: {},
  /** @type {Record<string, Array<object>>} */
  dmMessages: {},
};

const chGeneral = store.guilds[DEFAULT_GUILD_ID].channels[0].id;
const chRandom = store.guilds[DEFAULT_GUILD_ID].channels[1].id;
const chHomework = store.guilds[DEFAULT_GUILD_ID].channels[2].id;

const defaultInvite = 'PORTAL01';
store.guilds[DEFAULT_GUILD_ID].invites = {
  [defaultInvite]: { code: defaultInvite, uses: 0, maxUses: 0 },
};
inviteToGuild[defaultInvite] = DEFAULT_GUILD_ID;

function msgKeyGuild(guildId, channelId) {
  return `g:${guildId}:c:${channelId}`;
}

function dmRoomKey(userA, userB) {
  return [userA, userB].sort().join('__');
}

function roomGuildChannel(guildId, channelId) {
  return `room:g:${guildId}:c:${channelId}`;
}

function roomDm(key) {
  return `room:dm:${key}`;
}

function roomGuild(guildId) {
  return `room:guild:${guildId}`;
}

function memberEffectivePermissions(guild, userId) {
  const m = guild.members[userId];
  if (!m) return 0;
  let p = 0;
  const roleIds = m.roles && m.roles.length ? m.roles : ['role_everyone'];
  for (const rid of roleIds) {
    const role = guild.roles[rid];
    if (role) p |= role.permissions | 0;
  }
  if (guild.ownerId === userId) p |= PERMISSIONS.ADMINISTRATOR;
  return p;
}

function hasPerm(guild, userId, flag) {
  const p = memberEffectivePermissions(guild, userId);
  if (p & PERMISSIONS.ADMINISTRATOR) return true;
  return (p & flag) === flag;
}

function guildPayload(guild, userId) {
  return {
    id: guild.id,
    name: guild.name,
    icon: guild.icon,
    ownerId: guild.ownerId,
    channels: guild.channels.map(c => ({ ...c })),
    myPermissions: memberEffectivePermissions(guild, userId),
    memberIds: Object.keys(guild.members || {}),
  };
}

function guildsForUser(userId) {
  return Object.values(store.guilds)
    .filter(g => g.members[userId])
    .map(g => guildPayload(g, userId));
}

function ensureMember(guild, userId) {
  if (!guild.members[userId]) {
    const isFirst = Object.keys(guild.members).length === 0;
    guild.members[userId] = {
      roles: isFirst ? ['role_everyone', 'role_admin'] : ['role_everyone'],
    };
    if (isFirst && !guild.ownerId) guild.ownerId = userId;
  }
}

function initMessageBuckets() {
  const g = store.guilds[DEFAULT_GUILD_ID];
  for (const ch of g.channels) {
    if (ch.type !== 'text') continue;
    const k = msgKeyGuild(g.id, ch.id);
    if (!store.messages[k]) store.messages[k] = [];
  }
}
initMessageBuckets();

const MAX_MESSAGES = 120;
const MAX_ATTACH_LEN = 2_000_000;

function trimMessages(key) {
  const arr = store.messages[key] || store.dmMessages[key];
  if (!arr) return;
  while (arr.length > MAX_MESSAGES) arr.shift();
}

function sanitizeAttachments(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 5).map(a => ({
    type: a.type === 'gif' ? 'gif' : 'file',
    name: String(a.name || 'file').slice(0, 200),
    url: typeof a.url === 'string' ? a.url.slice(0, MAX_ATTACH_LEN) : '',
    mime: typeof a.mime === 'string' ? a.mime.slice(0, 120) : '',
  })).filter(a => a.url.length > 0);
}

function normalizeReactions(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(r => ({
      emoji: String(r.emoji || '').slice(0, 16),
      count: Math.max(0, Number(r.count) || r.users?.length || 0),
      users: Array.isArray(r.users) ? [...new Set(r.users.map(String))] : [],
    }))
    .filter(r => r.emoji && r.count > 0);
}

function findMessage(list, id) {
  return list?.find(m => m.id === id) || null;
}

function canDeleteMessage(guild, msg, userId) {
  if (!msg) return false;
  if (msg.sender === userId) return true;
  if (!guild) return false;
  if (guild.ownerId === userId) return true;
  return hasPerm(guild, userId, PERMISSIONS.ADMINISTRATOR);
}

// ---- Express ----
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true },
});

app.use(express.json({ limit: '5mb' }));

const root = __dirname;
app.use(express.static(root));

app.get('/api/giphy/search', async (req, res) => {
  const q = String(req.query.q || 'trending');
  const key = process.env.GIPHY_API_KEY;
  if (!key) {
    return res.status(503).json({ error: 'Set GIPHY_API_KEY on the server for GIF search.' });
  }
  try {
    const url = q === 'trending' || !q.trim()
      ? `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(key)}&limit=24`
      : `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&limit=24`;
    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/** @type {Map<string, Set<string>>} username -> socket ids */
const socketsByUser = new Map();

function broadcastPresence() {
  const online = [...socketsByUser.keys()];
  io.emit('presence:list', { online });
}

const typingState = {};

function typingKeyGuild(guildId, channelId) {
  return `tg:${guildId}:${channelId}`;
}

function typingKeyDm(dmKey) {
  return `td:${dmKey}`;
}

function clearTypingForUser(username, key) {
  if (!typingState[key]) return;
  delete typingState[key][username];
  if (Object.keys(typingState[key]).length === 0) delete typingState[key];
}

io.on('connection', socket => {
  /** @type {string|null} */
  let user = null;

  socket.on('auth', (payload, cb) => {
    const username = typeof payload?.username === 'string' ? payload.username.trim().toLowerCase() : '';
    if (!username || username.length > 48 || !/^[a-z0-9._-]+$/.test(username)) {
      cb?.({ ok: false, error: 'Invalid username' });
      return;
    }
    user = username;
    if (!socketsByUser.has(user)) socketsByUser.set(user, new Set());
    socketsByUser.get(user).add(socket.id);

    const g = store.guilds[DEFAULT_GUILD_ID];
    ensureMember(g, user);

    for (const gid of Object.keys(store.guilds)) {
      if (store.guilds[gid].members[user]) socket.join(roomGuild(gid));
    }

    broadcastPresence();
    cb?.({
      ok: true,
      guilds: guildsForUser(user),
      defaultGuildId: DEFAULT_GUILD_ID,
      defaultChannels: {
        general: chGeneral,
        random: chRandom,
        homework: chHomework,
      },
      online: [...socketsByUser.keys()],
    });
  });

  socket.on('disconnect', () => {
    if (!user) return;
    const set = socketsByUser.get(user);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) socketsByUser.delete(user);
    }
    for (const k of Object.keys(typingState)) {
      clearTypingForUser(user, k);
      io.emit('typing:update', { key: k, users: Object.keys(typingState[k] || {}) });
    }
    broadcastPresence();
  });

  socket.on('guild:create', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const name = String(payload?.name || 'New Server').trim().slice(0, 64) || 'New Server';
    const icon = payload?.icon ? String(payload.icon).slice(0, 500_000) : null;
    const id = `guild_${genId()}`;
    const inviteCode = genInviteCode();
    store.guilds[id] = {
      id,
      name,
      icon,
      ownerId: user,
      roles: {
        role_everyone: {
          id: 'role_everyone',
          name: '@everyone',
          permissions: PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.SEND_MESSAGES,
        },
        role_admin: {
          id: 'role_admin',
          name: 'Admin',
          permissions: Object.values(PERMISSIONS).reduce((a, b) => a | b, 0),
        },
      },
      members: {
        [user]: { roles: ['role_everyone', 'role_admin'] },
      },
      channels: [
        { id: `ch_${genId()}`, name: 'general', type: 'text', category: 'Text Channels', position: 0 },
      ],
      invites: {
        [inviteCode]: { code: inviteCode, uses: 0, maxUses: 0 },
      },
    };
    inviteToGuild[inviteCode] = id;
    const ch0 = store.guilds[id].channels[0].id;
    store.messages[msgKeyGuild(id, ch0)] = [];
    socket.join(roomGuild(id));
    io.to(roomGuild(id)).emit('guild:sync', guildPayload(store.guilds[id], user));
    cb?.({ ok: true, guild: guildPayload(store.guilds[id], user), inviteCode });
  });

  socket.on('guild:join', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const code = String(payload?.code || '').trim().toUpperCase();
    const guildId = inviteToGuild[code];
    const guild = store.guilds[guildId];
    if (!guild || !guild.invites[code]) return cb?.({ ok: false, error: 'Invalid invite' });
    const inv = guild.invites[code];
    if (inv.maxUses > 0 && inv.uses >= inv.maxUses) return cb?.({ ok: false, error: 'Invite expired' });
    if (!guild.members[user]) {
      guild.members[user] = { roles: ['role_everyone'] };
      inv.uses += 1;
    }
    socket.join(roomGuild(guildId));
    io.to(roomGuild(guildId)).emit('guild:memberJoined', { guildId, username: user });
    cb?.({ ok: true, guild: guildPayload(guild, user) });
  });

  socket.on('guild:update', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const guildId = payload?.guildId;
    const guild = store.guilds[guildId];
    if (!guild || !guild.members[user]) return cb?.({ ok: false });
    if (!hasPerm(guild, user, PERMISSIONS.MANAGE_GUILD)) return cb?.({ ok: false, error: 'Missing MANAGE_GUILD' });
    if (payload.name != null) guild.name = String(payload.name).trim().slice(0, 64) || guild.name;
    if (payload.icon !== undefined) guild.icon = payload.icon ? String(payload.icon).slice(0, 500_000) : null;
    io.to(roomGuild(guildId)).emit('guild:sync', guildPayload(guild, user));
    cb?.({ ok: true, guild: guildPayload(guild, user) });
  });

  socket.on('channel:create', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const guildId = payload?.guildId;
    const guild = store.guilds[guildId];
    if (!guild || !guild.members[user]) return cb?.({ ok: false });
    if (!hasPerm(guild, user, PERMISSIONS.MANAGE_CHANNELS)) {
      return cb?.({ ok: false, error: 'Missing MANAGE_CHANNELS' });
    }
    const type = payload?.type === 'voice' ? 'voice' : 'text';
    const name = String(payload?.name || 'new-channel').trim().slice(0, 64).replace(/\s+/g, '-') || 'channel';
    const category = payload?.category != null ? String(payload.category).slice(0, 64) : 'Text Channels';
    const id = `ch_${genId()}`;
    const ch = { id, name, type, category, position: guild.channels.length };
    guild.channels.push(ch);
    if (type === 'text') store.messages[msgKeyGuild(guildId, id)] = [];
    io.to(roomGuild(guildId)).emit('guild:sync', guildPayload(guild, user));
    cb?.({ ok: true, channel: ch });
  });

  socket.on('invite:create', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const guildId = payload?.guildId;
    const guild = store.guilds[guildId];
    if (!guild || !guild.members[user]) return cb?.({ ok: false });
    if (!hasPerm(guild, user, PERMISSIONS.MANAGE_GUILD)) return cb?.({ ok: false, error: 'Missing MANAGE_GUILD' });
    const code = genInviteCode();
    guild.invites[code] = { code, uses: 0, maxUses: Number(payload?.maxUses) || 0 };
    inviteToGuild[code] = guildId;
    cb?.({ ok: true, code });
  });

  socket.on('channel:subscribe', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const { guildId, channelId } = payload || {};
    const guild = store.guilds[guildId];
    if (!guild || !guild.members[user]) return cb?.({ ok: false });
    const ch = guild.channels.find(c => c.id === channelId);
    if (!ch || ch.type !== 'text') return cb?.({ ok: false, error: 'Not a text channel' });
    if (!hasPerm(guild, user, PERMISSIONS.VIEW_CHANNEL)) return cb?.({ ok: false });
    socket.join(roomGuildChannel(guildId, channelId));
    const key = msgKeyGuild(guildId, channelId);
    if (!store.messages[key]) store.messages[key] = [];
    cb?.({ ok: true, messages: store.messages[key], guild: guildPayload(guild, user) });
  });

  socket.on('dm:subscribe', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const peer = String(payload?.peer || '').trim().toLowerCase();
    if (!peer || peer === user) return cb?.({ ok: false });
    const key = dmRoomKey(user, peer);
    socket.join(roomDm(key));
    if (!store.dmMessages[key]) store.dmMessages[key] = [];
    cb?.({ ok: true, messages: store.dmMessages[key], dmKey: key, peer });
  });

  socket.on('message:send', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const { guildId, channelId, content, replyingTo, attachments } = payload || {};
    const guild = store.guilds[guildId];
    if (!guild || !guild.members[user]) return cb?.({ ok: false });
    const ch = guild.channels.find(c => c.id === channelId);
    if (!ch || ch.type !== 'text') return cb?.({ ok: false });
    if (!hasPerm(guild, user, PERMISSIONS.SEND_MESSAGES)) return cb?.({ ok: false });
    const msg = {
      id: genId(),
      sender: user,
      content: String(content || '').slice(0, 4000),
      timestamp: Date.now(),
      editedAt: null,
      replyingTo: replyingTo && replyingTo.id
        ? { id: replyingTo.id, sender: String(replyingTo.sender || ''), content: String(replyingTo.content || '').slice(0, 200) }
        : null,
      attachments: sanitizeAttachments(attachments),
      reactions: [],
    };
    const key = msgKeyGuild(guildId, channelId);
    if (!store.messages[key]) store.messages[key] = [];
    store.messages[key].push(msg);
    trimMessages(key);
    io.to(roomGuildChannel(guildId, channelId)).emit('message:new', { guildId, channelId, message: msg });
    // Notify all members of the guild (including those not currently in the channel)
    io.to(roomGuild(guildId)).emit('notification:new', { guildId, channelId, message: msg });
    cb?.({ ok: true, message: msg });
  });

  socket.on('dm:send', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const peer = String(payload?.peer || '').trim().toLowerCase();
    if (!peer || peer === user) return cb?.({ ok: false });
    const key = dmRoomKey(user, peer);
    const msg = {
      id: genId(),
      sender: user,
      content: String(payload?.content || '').slice(0, 4000),
      timestamp: Date.now(),
      editedAt: null,
      replyingTo: payload?.replyingTo && payload.replyingTo.id
        ? { id: payload.replyingTo.id, sender: String(payload.replyingTo.sender || ''), content: String(payload.replyingTo.content || '').slice(0, 200) }
        : null,
      attachments: sanitizeAttachments(payload?.attachments),
      reactions: [],
    };
    if (!store.dmMessages[key]) store.dmMessages[key] = [];
    store.dmMessages[key].push(msg);
    trimMessages(key);
    io.to(roomDm(key)).emit('dm:message', { dmKey: key, message: msg });
    cb?.({ ok: true, message: msg });
  });

  socket.on('message:edit', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const { guildId, channelId, messageId, content } = payload || {};
    const guild = store.guilds[guildId];
    const key = msgKeyGuild(guildId, channelId);
    const list = store.messages[key];
    const msg = findMessage(list, messageId);
    if (!msg || msg.sender !== user) return cb?.({ ok: false });
    msg.content = String(content || '').slice(0, 4000);
    msg.editedAt = Date.now();
    io.to(roomGuildChannel(guildId, channelId)).emit('message:replace', { guildId, channelId, message: msg });
    cb?.({ ok: true, message: msg });
  });

  socket.on('dm:edit', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const { dmKey, messageId, content } = payload || {};
    const list = store.dmMessages[dmKey];
    const msg = findMessage(list, messageId);
    if (!msg || msg.sender !== user) return cb?.({ ok: false });
    msg.content = String(content || '').slice(0, 4000);
    msg.editedAt = Date.now();
    io.to(roomDm(dmKey)).emit('dm:messageReplace', { dmKey, message: msg });
    cb?.({ ok: true, message: msg });
  });

  socket.on('message:delete', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const { guildId, channelId, messageId } = payload || {};
    const guild = store.guilds[guildId];
    const key = msgKeyGuild(guildId, channelId);
    const list = store.messages[key];
    const msg = findMessage(list, messageId);
    if (!msg || !canDeleteMessage(guild, msg, user)) return cb?.({ ok: false });
    const idx = list.findIndex(m => m.id === messageId);
    if (idx >= 0) list.splice(idx, 1);
    io.to(roomGuildChannel(guildId, channelId)).emit('message:delete', { guildId, channelId, messageId });
    cb?.({ ok: true });
  });

  socket.on('dm:delete', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const { dmKey, messageId } = payload || {};
    const list = store.dmMessages[dmKey];
    const msg = findMessage(list, messageId);
    if (!msg || msg.sender !== user) return cb?.({ ok: false });
    const idx = list.findIndex(m => m.id === messageId);
    if (idx >= 0) list.splice(idx, 1);
    io.to(roomDm(dmKey)).emit('dm:messageDelete', { dmKey, messageId });
    cb?.({ ok: true });
  });

  socket.on('reaction:toggle', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const { guildId, channelId, messageId, emoji } = payload || {};
    const em = String(emoji || '').trim().slice(0, 16);
    if (!em) return cb?.({ ok: false });
    const key = msgKeyGuild(guildId, channelId);
    const list = store.messages[key];
    const msg = findMessage(list, messageId);
    if (!msg) return cb?.({ ok: false });
    msg.reactions = normalizeReactions(msg.reactions);
    let entry = msg.reactions.find(r => r.emoji === em);
    if (!entry) {
      entry = { emoji: em, count: 0, users: [] };
      msg.reactions.push(entry);
    }
    const ui = entry.users.indexOf(user);
    if (ui >= 0) {
      entry.users.splice(ui, 1);
      entry.count = entry.users.length;
    } else {
      entry.users.push(user);
      entry.count = entry.users.length;
    }
    msg.reactions = msg.reactions.filter(r => r.count > 0);
    io.to(roomGuildChannel(guildId, channelId)).emit('message:replace', { guildId, channelId, message: msg });
    cb?.({ ok: true, message: msg });
  });

  socket.on('dm:reaction', (payload, cb) => {
    if (!user) return cb?.({ ok: false });
    const { dmKey, messageId, emoji } = payload || {};
    const em = String(emoji || '').trim().slice(0, 16);
    const list = store.dmMessages[dmKey];
    const msg = findMessage(list, messageId);
    if (!msg) return cb?.({ ok: false });
    msg.reactions = normalizeReactions(msg.reactions);
    let entry = msg.reactions.find(r => r.emoji === em);
    if (!entry) {
      entry = { emoji: em, count: 0, users: [] };
      msg.reactions.push(entry);
    }
    const ui = entry.users.indexOf(user);
    if (ui >= 0) {
      entry.users.splice(ui, 1);
      entry.count = entry.users.length;
    } else {
      entry.users.push(user);
      entry.count = entry.users.length;
    }
    msg.reactions = msg.reactions.filter(r => r.count > 0);
    io.to(roomDm(dmKey)).emit('dm:messageReplace', { dmKey, message: msg });
    cb?.({ ok: true, message: msg });
  });

  socket.on('typing', payload => {
    if (!user) return;
    if (payload?.guildId && payload?.channelId) {
      const guild = store.guilds[payload.guildId];
      if (!guild || !guild.members[user]) return;
      const k = typingKeyGuild(payload.guildId, payload.channelId);
      if (!typingState[k]) typingState[k] = {};
      typingState[k][user] = Date.now();
      io.emit('typing:update', { key: k, users: Object.keys(typingState[k]) });
    } else if (payload?.dmKey) {
      const k = typingKeyDm(payload.dmKey);
      if (!typingState[k]) typingState[k] = {};
      typingState[k][user] = Date.now();
      io.emit('typing:update', { key: k, users: Object.keys(typingState[k]) });
    }
  });

  socket.on('typing:stop', payload => {
    if (!user) return;
    if (payload?.guildId && payload?.channelId) {
      const k = typingKeyGuild(payload.guildId, payload.channelId);
      clearTypingForUser(user, k);
      io.emit('typing:update', { key: k, users: Object.keys(typingState[k] || {}) });
    } else if (payload?.dmKey) {
      const k = typingKeyDm(payload.dmKey);
      clearTypingForUser(user, k);
      io.emit('typing:update', { key: k, users: Object.keys(typingState[k] || {}) });
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const k of Object.keys(typingState)) {
    for (const u of Object.keys(typingState[k])) {
      if (now - typingState[k][u] > 4000) delete typingState[k][u];
    }
    if (Object.keys(typingState[k]).length === 0) delete typingState[k];
  }
}, 2000);

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`Chat server http://localhost:${PORT}`);
});

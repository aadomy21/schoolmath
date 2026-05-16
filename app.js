/**
 * School portal — Firebase Auth + Socket.io realtime (guilds, DMs, RBAC).
 * Centralized AppState; replyTarget drives reply banner visibility only.
 */

const firebaseConfig = {
  apiKey: "AIzaSyAaPbKLUV7S1gtKDyr-keBjS38nViPRMkw",
  authDomain: "schoolmathpart.firebaseapp.com",
  databaseURL: "https://schoolmathpart-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "schoolmathpart",
  storageBucket: "schoolmathpart.firebasestorage.app",
  messagingSenderId: "525859836367",
  appId: "1:525859836367:web:843e220ad112d5327e02ba",
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

let db = null;
let firebaseMsgRef = null;
let firebaseTypingRef = null;

function getBackendMode() {
  const c = window.APP_CONFIG || {};
  if (c.backend === "firebase") return "firebase";
  if (c.backend === "socket") return "socket";
  if (c.socketUrl) return "socket";
  if (/github\.io$/i.test(location.hostname)) return "firebase";
  if (location.protocol === "file:") return "firebase";
  return "socket";
}

function isFirebaseBackend() {
  return AppState.backendMode === "firebase";
}

const ADMIN = "aadomy21";
const MAX_REACTION_TYPES = 12;
const TYPING_TIMEOUT_MS = 3200;

/** Mirrors server permission bits */
const PERM = {
  VIEW_CHANNEL: 1 << 0,
  SEND_MESSAGES: 1 << 1,
  MANAGE_CHANNELS: 1 << 2,
  MANAGE_GUILD: 1 << 3,
  ADMINISTRATOR: 1 << 4,
  KICK_MEMBERS: 1 << 5,
};

const AppState = {
  currentUser: null,
  backendMode: null,
  currentChatPath: "",
  socket: null,
  guilds: [],
  defaultGuildId: null,
  activeGuildId: null,
  activeChannelId: null,
  activeChannelType: "text",
  view: "guild",
  activeDmPeer: null,
  activeDmKey: null,
  roomMessages: [],
  replyTarget: null,
  editingMessageId: null,
  pendingAttachments: [],
  lastChannelByGuild: {},
  conversationScratch: {},
  virtualizationBuffer: 10,
  visibleMessageStart: 0,
  visibleMessageEnd: 0,
};

const FIREBASE_KEY_ESCAPES = {
  ".": "%2E",
  "#": "%23",
  "$": "%24",
  "/": "%2F",
  "[": "%5B",
  "]": "%5D",
};

const FIREBASE_KEY_UNESCAPES = Object.fromEntries(
  Object.entries(FIREBASE_KEY_ESCAPES).map(([key, value]) => [value, key])
);

function firebaseSafeKey(value) {
  return String(value || "").replace(/[.#$/\[\]]/g, ch => FIREBASE_KEY_ESCAPES[ch] || ch);
}

function firebaseKeyToUsername(key) {
  return String(key || "").replace(/%2E|%23|%24|%2F|%5B|%5D/g, match => FIREBASE_KEY_UNESCAPES[match] || match);
}

const $ = id => document.getElementById(id);

const UI = {
  mathCover: () => $("math-cover"),
  loginOverlay: () => $("login-overlay"),
  appUI: () => $("app-ui"),
  loginEmail: () => $("li-email"),
  loginPass: () => $("li-pass"),
  loginBtn: () => $("li-btn"),
  loginErr: () => $("login-err"),
  msgContainer: () => $("message-container"),
  consoleInput: () => $("console-input"),
  chatTitle: () => $("chat-title"),
  chatTopic: () => $("chat-topic"),
  myName: () => $("my-name-display"),
  statusText: () => $("status-text"),
  userAvatar: () => $("user-avatar"),
  dmList: () => $("dm-list"),
  membersList: () => $("members-list"),
  onlineCount: () => $("online-count"),
  membersPanel: () => $("members-panel"),
  replyBanner: () => $("reply-banner"),
  replyNameLabel: () => $("reply-name-label"),
  typingIndicator: () => $("typing-indicator"),
  contextMenu: () => $("context-menu"),
  menuDelete: () => $("menu-delete"),
  menuReply: () => $("menu-reply"),
  menuEdit: () => $("menu-edit"),
  toast: () => $("toast"),
  chatHeader: () => $("chat-header"),
  navStripInner: () => $("nav-strip-inner"),
  guildChannelsRoot: () => $("guild-channels-root"),
  sidebarHeader: () => $("sidebar-header"),
  sidebarFooter: () => $("sidebar-footer-actions"),
  btnCreateChannel: () => $("btn-create-channel"),
  attachmentStrip: () => $("attachment-strip"),
  fileInput: () => $("file-attach-input"),
  reactionPopover: () => $("reaction-popover"),
  genericModal: () => $("generic-modal"),
  genericModalTitle: () => $("generic-modal-title"),
  genericModalBody: () => $("generic-modal-body"),
  genericModalClose: () => $("generic-modal-close"),
};

let typingTimer = null;
let isTyping = false;
let membersOpen = false;
let activeMsgId = null;
let activeMsgData = null;
let toastTimer = null;

const QUICK_EMOJIS = ["😂", "🔥", "👍", "❤️", "😭", "💀", "✅", "🙏", "😊", "🤔", "👀", "🎉"];

// --- Scratch per conversation (draft + reply) ---
function convoKey() {
  if (AppState.view === "dm" && AppState.activeDmKey) return `dm:${AppState.activeDmKey}`;
  if (AppState.activeGuildId && AppState.activeChannelId) return `g:${AppState.activeGuildId}:${AppState.activeChannelId}`;
  return "_";
}

function saveConvoScratch() {
  AppState.conversationScratch[convoKey()] = {
    text: UI.consoleInput().value,
    replyTarget: AppState.replyTarget,
  };
}

function loadConvoScratch() {
  const s = AppState.conversationScratch[convoKey()];
  UI.consoleInput().value = s?.text || "";
  AppState.replyTarget = s?.replyTarget || null;
  syncReplyBanner();
}

// --- Reply banner (only when replyTarget non-null) ---
function syncReplyBanner() {
  const banner = UI.replyBanner();
  const label = UI.replyNameLabel();
  if (!AppState.replyTarget) {
    banner.classList.remove("active");
    label.textContent = "";
    return;
  }
  banner.classList.add("active");
  label.textContent = AppState.replyTarget.sender || "";
}

function cancelReply() {
  AppState.replyTarget = null;
  syncReplyBanner();
  updateInputPlaceholder();
  AppState.conversationScratch[convoKey()] = {
    ...AppState.conversationScratch[convoKey()],
    replyTarget: null,
  };
}

function setReply(msgId, sender, content) {
  AppState.replyTarget = { id: msgId, sender, content };
  syncReplyBanner();
  UI.consoleInput().focus();
  hideMenu();
  AppState.conversationScratch[convoKey()] = {
    ...AppState.conversationScratch[convoKey()],
    replyTarget: AppState.replyTarget,
  };
}

// --- Guild helpers ---
function activeGuild() {
  return AppState.guilds.find(g => g.id === AppState.activeGuildId) || null;
}

function myPerm(flag) {
  const g = activeGuild();
  if (!g) return false;
  const p = g.myPermissions | 0;
  if (p & PERM.ADMINISTRATOR) return true;
  return (p & flag) === flag;
}

function channelTopic(name) {
  const topics = {
    general: "General chat — keep it cool",
    random: "Anything goes",
    "homework-help": "Homework help — share resources",
  };
  return topics[name] || "";
}

function updateInputPlaceholder() {
  const inp = UI.consoleInput();
  if (AppState.view === "dm" && AppState.activeDmPeer) {
    inp.placeholder = `Message @${AppState.activeDmPeer}`;
  } else if (AppState.activeChannelId) {
    const ch = activeGuild()?.channels?.find(c => c.id === AppState.activeChannelId);
    inp.placeholder = ch ? `Message #${ch.name}` : "Message";
  } else inp.placeholder = "Message";
}

// --- Auth ---
window.onload = () => {
  UI.loginOverlay().classList.add("active");
  UI.loginPass().addEventListener("keydown", e => {
    if (e.key === "Enter") handleLogin();
  });
  UI.loginEmail().addEventListener("keydown", e => {
    if (e.key === "Enter") UI.loginPass().focus();
  });
};

function handleLogin() {
  const email = UI.loginEmail().value.trim();
  const pass = UI.loginPass().value;
  if (!email || !pass) {
    showLoginError("Please fill in both fields.");
    return;
  }
  const btn = UI.loginBtn();
  btn.disabled = true;
  btn.textContent = "Logging in…";
  UI.loginErr().textContent = "";
  auth.signInWithEmailAndPassword(email, pass)
    .then(() => {
      AppState.currentUser = email.split("@")[0].toLowerCase();
      UI.loginOverlay().classList.remove("active");
      revealApp();
    })
    .catch(err => {
      let msg = "Incorrect ID or access key.";
      if (err.code === "auth/too-many-requests") msg = "Too many attempts. Try again later.";
      if (err.code === "auth/invalid-email") msg = "Invalid email format.";
      showLoginError(msg);
      btn.disabled = false;
      btn.textContent = "Log In";
    });
}

function showLoginError(msg) {
  UI.loginErr().textContent = msg;
}

function revealApp() {
  UI.mathCover().style.display = "none";
  UI.appUI().classList.add("visible");
  const u = AppState.currentUser;
  UI.myName().textContent = u;
  UI.statusText().textContent = "Online";
  UI.statusText().style.color = "var(--green)";
  const av = UI.userAvatar();
  av.textContent = u[0].toUpperCase();
  if (u === ADMIN) av.style.background = "#e91e63";
  // Request notification permission after user login (user gesture)
  requestNotificationPermission();
  // Preload optional ping audio so playback is allowed after user gesture
  try {
    const a = new Audio('/ping.mp3');
    a.preload = 'auto';
    a.volume = 0.6;
    a.addEventListener('error', () => { window.__pingAudio = null; });
    window.__pingAudio = a;
  } catch (e) { window.__pingAudio = null; }
  startRealtime();
}

function updateUnreadBadge(count) {
  const b = document.getElementById('unread-badge');
  if (!b) return;
  const n = Number(count) || 0;
  if (n <= 0) {
    b.setAttribute('data-count', '0');
    b.textContent = '';
    b.setAttribute('aria-hidden', 'true');
  } else {
    b.setAttribute('data-count', String(n));
    b.textContent = String(n > 99 ? '99+' : n);
    b.removeAttribute('aria-hidden');
  }
}

// Clear unread badge when user focuses the window or opens a channel
window.addEventListener('focus', () => updateUnreadBadge(0));

function updateChromeForBackend() {
  const fb = isFirebaseBackend();
  const addA = $("btn-create-guild");
  const addJ = $("btn-join-guild");
  if (addA) addA.style.display = fb ? "none" : "";
  if (addJ) addJ.style.display = fb ? "none" : "";
}

function loadSocketIoClient() {
  return new Promise((resolve, reject) => {
    if (typeof io !== "undefined") return resolve();
    const s = document.createElement("script");
    s.src = "https://cdn.socket.io/4.8.1/socket.io.min.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("socket.io client load failed"));
    document.head.appendChild(s);
  });
}

function startRealtime() {
  AppState.backendMode = getBackendMode();
  updateChromeForBackend();
  if (isFirebaseBackend()) {
    db = firebase.database();
    connectFirebaseRealtime();
    return;
  }
  loadSocketIoClient()
    .then(() => {
      AppState.backendMode = "socket";
      updateChromeForBackend();
      connectSocket();
    })
    .catch(() => {
      AppState.backendMode = "firebase";
      db = firebase.database();
      connectFirebaseRealtime();
      updateChromeForBackend();
      showToast("Using Firebase (socket.io client could not be loaded).");
    });
}

function detachFirebaseMsgListener() {
  if (firebaseMsgRef) {
    firebaseMsgRef.off("value");
    firebaseMsgRef = null;
  }
}

function detachFirebaseTypingListener() {
  if (firebaseTypingRef) {
    firebaseTypingRef.off("value");
    firebaseTypingRef = null;
  }
}

function subscribeFirebaseRoom(path) {
  detachFirebaseMsgListener();
  detachFirebaseTypingListener();
  const ref = db.ref(path).limitToLast(60);
  firebaseMsgRef = ref;
  ref.on("value", snap => {
    if (firebaseMsgRef !== ref) return;
    AppState.roomMessages = [];
    UI.msgContainer().innerHTML = "";
    renderWelcomeBanner();
    let prevSender = null;
    let prevDate = null;
    let messageIndex = 0;
    snap.forEach(child => {
      const data = child.val();
      const tsRaw = data?.timestamp;
      const tsNum = typeof tsRaw === "number" ? tsRaw : (tsRaw && typeof tsRaw === "object" ? Date.now() : Date.now());
      const msgDate = new Date(tsNum).toDateString();
      const isGroup = prevSender === data.sender && prevDate === msgDate;
      if (prevDate !== msgDate) {
        renderDayDivider(tsNum);
        messageIndex++;
      }
      const id = child.key;
      renderMessage(id, data, !isGroup, messageIndex);
      messageIndex++;
      AppState.roomMessages.push({ id, ...data });
      prevSender = data.sender;
      prevDate = msgDate;
    });
    scrollToBottom();
    initVirtualization();
    setTimeout(() => updateVisibleMessages(), 50);
  });
}

function attachFirebaseTypingListener() {
  detachFirebaseTypingListener();
  const key = AppState.currentChatPath.replace(/\//g, "_");
  if (!key) return;
  const ref = db.ref(`typing/${key}`);
  firebaseTypingRef = ref;
  const currentUserKey = firebaseSafeKey(AppState.currentUser);
  ref.on("value", snap => {
    if (firebaseTypingRef !== ref) return;
    const typers = [];
    snap.forEach(c => {
      if (c.key !== currentUserKey) typers.push(firebaseKeyToUsername(c.key));
    });
    const indicator = UI.typingIndicator();
    if (!typers.length) {
      indicator.innerHTML = "";
      return;
    }
    let names;
    if (typers.length === 1) names = `${escHtml(typers[0])} is typing…`;
    else if (typers.length === 2) names = `${escHtml(typers[0])} and ${escHtml(typers[1])} are typing…`;
    else names = "Several people are typing…";
    indicator.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div><span>${names}</span>`;
  });
}

function registerPresenceFirebase() {
  const ref = db.ref(`system/users/${firebaseSafeKey(AppState.currentUser)}`);
  ref.set({ online: true, ts: firebase.database.ServerValue.TIMESTAMP });
  ref.onDisconnect().update({ online: false, ts: firebase.database.ServerValue.TIMESTAMP });
  setInterval(() => ref.update({ online: true, ts: firebase.database.ServerValue.TIMESTAMP }), 30000);
}

function syncUserListFirebase() {
  db.ref("system/users").on("value", snap => {
    const online = [];
    const allNames = [];
    snap.forEach(userSnap => {
      const name = firebaseKeyToUsername(userSnap.key);
      allNames.push(name);
      if ((userSnap.val() || {}).online === true) online.push(name);
    });
    renderMembersAndDms(online, allNames);
  });
}

function connectFirebaseRealtime() {
  const ALL = Object.values(PERM).reduce((a, b) => a | b, 0);
  const myPerms = AppState.currentUser === ADMIN ? ALL : (PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES);
  AppState.guilds = [{
    id: "fb_local",
    name: "School Portal",
    ownerId: ADMIN,
    myPermissions: myPerms,
    memberIds: [],
    channels: [
      { id: "general", name: "general", type: "text", category: "Text Channels" },
      { id: "random", name: "random", type: "text", category: "Text Channels" },
      { id: "homework", name: "homework-help", type: "text", category: "Text Channels" },
    ],
  }];
  AppState.defaultGuildId = "fb_local";
  registerPresenceFirebase();
  syncUserListFirebase();
  renderGuildNav();
  selectGuild("fb_local", { skipChannel: true });
  selectGuildChannel("fb_local", "general");
  updateSidebarManageUi();
  updateChromeForBackend();
}

function toggleReactionFirebase(msgId, emoji) {
  const base = AppState.currentChatPath;
  if (!base) return;
  const userKey = firebaseSafeKey(AppState.currentUser);
  const msgRef = db.ref(`${base}/${msgId}/reactions`);
  const userRef = db.ref(`${base}/${msgId}/reactions/${emoji}/${userKey}`);
  msgRef.once("value", snap => {
    const all = snap.val() || {};
    const hasEmoji = !!all[emoji];
    const hasMine = hasEmoji && !!all[emoji][userKey];
    if (hasMine) userRef.remove();
    else {
      const uniqueCount = Object.keys(all).length;
      if (!hasEmoji && uniqueCount >= MAX_REACTION_TYPES) {
        showToast(`Max ${MAX_REACTION_TYPES} unique reactions per message.`);
        return;
      }
      userRef.set(true);
    }
  });
}

// --- Notifications & Socket ---

function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  try {
    if (Notification.permission === 'default') Notification.requestPermission().catch(() => { });
  } catch (e) { }
}

function playPing() {
  // Prefer a short file /ping.mp3 if present, otherwise fall back to WebAudio oscillator
  if (window.__pingAudio && typeof window.__pingAudio.play === 'function') {
    const a = window.__pingAudio;
    try {
      a.currentTime = 0;
      a.play().catch(() => {
        // fall back to oscillator
        try { playOscillator(); } catch (e) { }
      });
      return;
    } catch (e) { }
  }
  try { playOscillator(); } catch (e) { }
}

function playOscillator() {
  const C = window.AudioContext || window.webkitAudioContext;
  const ctx = new C();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = 880;
  g.gain.value = 0.02;
  o.connect(g); g.connect(ctx.destination);
  o.start();
  setTimeout(() => { o.stop(); ctx.close(); }, 120);
}

function showDesktopNotification(title, body, icon, data) {
  if (!('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;
  try {
    const n = new Notification(title, { body, icon, data });
    n.onclick = () => { window.focus(); n.close(); };
    return true;
  } catch (e) { return false; }
}

function handleIncomingNotification({ guildId, channelId, message }) {
  if (!message) return;
  if (message.sender === AppState.currentUser) return;
  const channelName = (AppState.guilds.find(g => g.id === guildId)?.channels.find(c => c.id === channelId)?.name) || channelId;
  const title = `${message.sender} in #${channelName}`;
  const body = message.content ? (message.content.length > 120 ? message.content.slice(0, 120) + '…' : message.content) : 'New message';
  const shown = showDesktopNotification(title, body, '/avatar.png', { guildId, channelId, messageId: message.id });
  if (!shown) {
    const current = Number(document.getElementById('unread-badge')?.getAttribute('data-count') || 0) || 0;
    updateUnreadBadge(current + 1);
  }
  playPing();
}

// --- Socket ---
function connectSocket() {
  if (AppState.socket) AppState.socket.disconnect();
  const url = (window.APP_CONFIG && window.APP_CONFIG.socketUrl) || undefined;
  AppState.socket = io(url, { transports: ["websocket", "polling"] });

  AppState.socket.on("connect", () => {
    AppState.socket.emit("auth", { username: AppState.currentUser }, res => {
      if (!res?.ok) {
        showToast("Realtime connection failed.");
        return;
      }
      AppState.guilds = res.guilds || [];
      AppState.defaultGuildId = res.defaultGuildId;
      renderGuildNav();
      renderMembersAndDms(res.online || []);
      const gid = res.defaultGuildId;
      const chMap = res.defaultChannels || {};
      const firstText = AppState.guilds.find(g => g.id === gid)?.channels?.find(c => c.type === "text");
      const startCh = chMap.general || firstText?.id;
      selectGuild(gid, { skipChannel: true });
      if (startCh) selectGuildChannel(gid, startCh);
    });
  });

  AppState.socket.on("message:new", ({ guildId, channelId, message }) => {
    if (AppState.view !== "guild") return;
    if (guildId !== AppState.activeGuildId || channelId !== AppState.activeChannelId) return;
    AppState.roomMessages.push(message);
    appendOrRerenderMessage(message.id);
    scrollToBottom();
  });

  AppState.socket.on("message:replace", ({ guildId, channelId, message }) => {
    if (guildId !== AppState.activeGuildId || channelId !== AppState.activeChannelId) return;
    const i = AppState.roomMessages.findIndex(m => m.id === message.id);
    if (i >= 0) AppState.roomMessages[i] = message;
    replaceMessageNode(message);
  });

  AppState.socket.on("message:delete", ({ guildId, channelId, messageId }) => {
    if (guildId !== AppState.activeGuildId || channelId !== AppState.activeChannelId) return;
    AppState.roomMessages = AppState.roomMessages.filter(m => m.id !== messageId);
    document.querySelector(`.msg-wrap[data-id="${messageId}"]`)?.remove();
  });

  AppState.socket.on("dm:message", ({ dmKey, message }) => {
    if (AppState.view !== "dm" || dmKey !== AppState.activeDmKey) return;
    AppState.roomMessages.push(message);
    appendOrRerenderMessage(message.id);
    scrollToBottom();
  });

  AppState.socket.on("dm:messageReplace", ({ dmKey, message }) => {
    if (dmKey !== AppState.activeDmKey) return;
    const i = AppState.roomMessages.findIndex(m => m.id === message.id);
    if (i >= 0) AppState.roomMessages[i] = message;
    replaceMessageNode(message);
  });

  AppState.socket.on("dm:messageDelete", ({ dmKey, messageId }) => {
    if (dmKey !== AppState.activeDmKey) return;
    AppState.roomMessages = AppState.roomMessages.filter(m => m.id !== messageId);
    document.querySelector(`.msg-wrap[data-id="${messageId}"]`)?.remove();
  });

  AppState.socket.on("presence:list", ({ online }) => {
    renderMembersAndDms(online || []);
  });

  AppState.socket.on("notification:new", payload => {
    try { handleIncomingNotification(payload); } catch (e) { }
  });

  AppState.socket.on("typing:update", ({ key, users }) => {
    const expectGuild = AppState.view === "guild" && `tg:${AppState.activeGuildId}:${AppState.activeChannelId}` === key;
    const expectDm = AppState.view === "dm" && `td:${AppState.activeDmKey}` === key;
    if (!expectGuild && !expectDm) return;
    const typers = (users || []).filter(u => u !== AppState.currentUser);
    const indicator = UI.typingIndicator();
    if (!typers.length) {
      indicator.innerHTML = "";
      return;
    }
    let names;
    if (typers.length === 1) names = `${escHtml(typers[0])} is typing…`;
    else if (typers.length === 2) names = `${escHtml(typers[0])} and ${escHtml(typers[1])} are typing…`;
    else names = "Several people are typing…";
    indicator.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div><span>${names}</span>`;
  });

  AppState.socket.on("guild:sync", guild => {
    const idx = AppState.guilds.findIndex(g => g.id === guild.id);
    if (idx >= 0) AppState.guilds[idx] = guild;
    else AppState.guilds.push(guild);
    if (guild.id === AppState.activeGuildId) {
      renderChannelList();
      updateSidebarManageUi();
    }
    renderGuildNav();
  });

  AppState.socket.on("guild:memberJoined", () => {
    showToast("Someone joined a server you’re in.");
  });
}

function renderGuildNav() {
  const root = UI.navStripInner();
  root.innerHTML = "";
  for (const g of AppState.guilds) {
    const icon = document.createElement("div");
    icon.className = "server-icon" + (g.id === AppState.activeGuildId && AppState.view === "guild" ? " active" : "");
    icon.title = g.name;
    icon.textContent = (g.name[0] || "?").toUpperCase();
    icon.onclick = () => {
      AppState.view = "guild";
      selectGuild(g.id, { skipChannel: true });
      const last = AppState.lastChannelByGuild[g.id];
      const ch = g.channels.find(c => c.id === last && c.type === "text")
        || g.channels.find(c => c.type === "text");
      if (ch) selectGuildChannel(g.id, ch.id);
      renderGuildNav();
    };
    root.appendChild(icon);
  }
}

function selectGuild(guildId, opts = {}) {
  AppState.activeGuildId = guildId;
  const g = AppState.guilds.find(x => x.id === guildId);
  UI.sidebarHeader().textContent = g ? g.name.toUpperCase() : "SERVER";
  renderChannelList();
  updateSidebarManageUi();
  if (!opts.skipChannel) {
    const ch = g?.channels.find(c => c.type === "text");
    if (ch) selectGuildChannel(guildId, ch.id);
  }
}

function updateSidebarManageUi() {
  const footer = UI.sidebarFooter();
  if (isFirebaseBackend()) {
    footer.classList.add("hidden");
    return;
  }
  const can = myPerm(PERM.MANAGE_CHANNELS);
  footer.classList.toggle("hidden", !can);
}

function renderChannelList() {
  const g = activeGuild();
  const root = UI.guildChannelsRoot();
  root.innerHTML = "";
  if (!g) return;

  const byCat = {};
  for (const c of g.channels) {
    const cat = c.category || "Channels";
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(c);
  }

  for (const cat of Object.keys(byCat)) {
    const sec = document.createElement("div");
    sec.className = "sidebar-section-title";
    sec.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10"><polyline points="6 9 12 3 18 9"></polyline></svg> ${escHtml(cat)}`;
    root.appendChild(sec);
    for (const c of byCat[cat]) {
      const row = document.createElement("div");
      row.className = "channel-link" + (c.id === AppState.activeChannelId && AppState.view === "guild" ? " active" : "");
      const prefix = c.type === "voice" ? "🔊" : "#";
      row.innerHTML = `<span class="ch-prefix">${prefix}</span><span class="channel-name">${escHtml(c.name)}</span>`;
      row.onclick = () => {
        if (c.type === "voice") {
          showToast("Voice channels: connect UI not implemented.");
          return;
        }
        selectGuildChannel(g.id, c.id);
      };
      root.appendChild(row);
    }
  }
}

function selectGuildChannel(guildId, channelId) {
  saveConvoScratch();
  AppState.view = "guild";
  AppState.activeGuildId = guildId;
  AppState.activeChannelId = channelId;
  AppState.activeDmPeer = null;
  AppState.activeDmKey = null;
  const g = AppState.guilds.find(x => x.id === guildId);
  const ch = g?.channels.find(c => c.id === channelId);
  AppState.activeChannelType = ch?.type || "text";
  AppState.lastChannelByGuild[guildId] = channelId;
  document.querySelectorAll("#guild-channels-root .channel-link").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".dm-item").forEach(el => el.classList.remove("active"));
  UI.chatHeader().querySelector(".ch-prefix").textContent = "#";
  UI.chatTitle().textContent = ch?.name || "channel";
  UI.chatTopic().textContent = channelTopic(ch?.name || "") || `Guild text channel`;
  cancelReply();
  loadConvoScratch();
  updateInputPlaceholder();
  renderGuildNav();
  renderChannelList();

  if (isFirebaseBackend()) {
    AppState.currentChatPath = `channels/${channelId}`;
    subscribeFirebaseRoom(AppState.currentChatPath);
    attachFirebaseTypingListener();
    updateSidebarManageUi();
    return;
  }

  AppState.socket.emit("channel:subscribe", { guildId, channelId }, res => {
    if (!res?.ok) {
      showToast("Could not open channel.");
      return;
    }
    if (res.guild) {
      const idx = AppState.guilds.findIndex(x => x.id === res.guild.id);
      if (idx >= 0) AppState.guilds[idx] = res.guild;
    }
    AppState.roomMessages = res.messages || [];
    rerenderAllMessages();
    updateSidebarManageUi();
    // clear unread badge when user opens a channel
    updateUnreadBadge(0);
  });
}

function openDm(peer) {
  saveConvoScratch();
  AppState.view = "dm";
  AppState.activeDmPeer = peer;
  AppState.activeGuildId = null;
  AppState.activeChannelId = null;
  cancelReply();
  loadConvoScratch();
  UI.chatHeader().querySelector(".ch-prefix").textContent = "@";
  UI.chatTitle().textContent = `@${peer}`;
  UI.chatTopic().textContent = `Direct message with ${peer}`;
  updateInputPlaceholder();
  document.querySelectorAll("#guild-channels-root .channel-link").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".dm-item").forEach(el => el.classList.remove("active"));
  const dmEl = $(`dm-item-${peer}`);
  if (dmEl) dmEl.classList.add("active");
  renderGuildNav();

  if (isFirebaseBackend()) {
    const sorted = [firebaseSafeKey(AppState.currentUser), firebaseSafeKey(peer)].sort().join("_");
    AppState.activeDmKey = sorted;
    AppState.currentChatPath = `dms/${sorted}`;
    subscribeFirebaseRoom(AppState.currentChatPath);
    attachFirebaseTypingListener();
    return;
  }

  AppState.socket.emit("dm:subscribe", { peer }, res => {
    if (!res?.ok) return showToast("Could not open DM.");
    AppState.activeDmKey = res.dmKey;
    AppState.roomMessages = res.messages || [];
    rerenderAllMessages();
    // clear unread badge when opening DM
    updateUnreadBadge(0);
  });
}

function rerenderAllMessages() {
  UI.msgContainer().innerHTML = "";
  renderWelcomeBanner();
  let prevSender = null;
  let prevDate = null;
  let messageIndex = 0;
  for (const m of AppState.roomMessages) {
    const msgDate = new Date(m.timestamp).toDateString();
    const isGroup = prevSender === m.sender && prevDate === msgDate;
    if (prevDate !== msgDate) {
      renderDayDivider(m.timestamp);
      messageIndex++;
    }
    renderMessage(m.id, m, !isGroup, messageIndex);
    messageIndex++;
    prevSender = m.sender;
    prevDate = msgDate;
  }
  scrollToBottom();
  initVirtualization();
  setTimeout(() => updateVisibleMessages(), 50);
}

function renderWelcomeBanner() {
  const banner = document.createElement("div");
  banner.className = "welcome-banner";
  if (AppState.view === "dm") {
    banner.innerHTML = `
      <div class="wb-icon">${(AppState.activeDmPeer || "?")[0].toUpperCase()}</div>
      <h2>DM with ${escHtml(AppState.activeDmPeer || "")}</h2>
      <p>This is the beginning of your direct message history.</p>`;
  } else {
    const ch = activeGuild()?.channels?.find(c => c.id === AppState.activeChannelId);
    const name = ch?.name || "channel";
    banner.innerHTML = `
      <div class="wb-icon">#</div>
      <h2>Welcome to #${escHtml(name)}!</h2>
      <p>${escHtml(channelTopic(name) || "Start the conversation.")}</p>`;
  }
  UI.msgContainer().appendChild(banner);
}

function renderDayDivider(ts) {
  const div = document.createElement("div");
  div.className = "day-divider";
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  let label;
  if (d.toDateString() === today.toDateString()) label = "Today";
  else if (d.toDateString() === yest.toDateString()) label = "Yesterday";
  else label = d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  div.innerHTML = `<span>${label}</span>`;
  UI.msgContainer().appendChild(div);
}

function normalizeReactions(data) {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.map(r => ({
      emoji: r.emoji,
      count: r.count || r.users?.length || 0,
      users: r.users || [],
    })).filter(r => r.emoji && r.count > 0);
  }
  const out = [];
  for (const [emoji, users] of Object.entries(data)) {
    const ulist = typeof users === "object" && users ? Object.keys(users) : [];
    if (ulist.length) out.push({ emoji, count: ulist.length, users: ulist });
  }
  return out;
}

function renderMessage(msgId, data, isGroupStart, msgIndex = 0) {
  const wrap = document.createElement("div");
  wrap.className = `msg-wrap${isGroupStart ? " group-start" : ""}`;
  wrap.setAttribute("data-id", msgId);
  wrap.setAttribute("data-sender", data.sender || "");
  wrap.setAttribute("data-content", data.content || "");
  wrap.setAttribute("data-msg-index", msgIndex);

  const isAdmin = data.sender === ADMIN;
  const isOwn = data.sender === AppState.currentUser;
  const canDelete = isOwn || (AppState.view === "guild" && activeGuild() && (
    activeGuild().ownerId === AppState.currentUser || myPerm(PERM.ADMINISTRATOR)
  ));
  const canEdit = isOwn && !AppState.editingMessageId;

  const ts = new Date(data.timestamp);
  const timeStr = ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const fullTs = ts.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

  const reactions = normalizeReactions(data.reactions);
  let reactionsHTML = "";
  if (reactions.length) {
    reactionsHTML = `<div class="reactions-row">`;
    for (const r of reactions) {
      const isMine = r.users.includes(AppState.currentUser);
      reactionsHTML += `<div class="reaction-bubble${isMine ? " mine" : ""}"
        onclick="toggleReaction('${escAttr(msgId)}','${escAttr(r.emoji)}')"
        title="${escAttr(r.users.join(", "))}">${r.emoji}<span class="r-count">${r.count}</span></div>`;
    }
    reactionsHTML += `</div>`;
  }

  let replyHTML = "";
  if (data.replyingTo && data.replyingTo.id) {
    const rSndr = escHtml(data.replyingTo.sender || "");
    const rText = escHtml((data.replyingTo.content || "").substring(0, 80));
    const rId = escAttr(data.replyingTo.id);
    replyHTML = `
      <div class="reply-ref-bar" onclick="scrollToMsg('${rId}')">
        <span class="reply-ref-accent"></span>
        <span class="reply-ref-label">↪ ${rSndr}</span>
        <span class="reply-text">${rText}${(data.replyingTo.content || "").length > 80 ? "…" : ""}</span>
      </div>`;
  }

  let bodyContent = linkify(escHtml(data.content || ""));
  if (data.editedAt) bodyContent += ` <span class="msg-edited">(edited)</span>`;

  let attachHTML = "";
  const atts = data.attachments || [];
  if (atts.length) {
    attachHTML = `<div class="msg-attachments">`;
    for (const a of atts) {
      if (a.type === "gif" && a.url) {
        attachHTML += `<div class="msg-embed-gif"><img src="${escAttr(a.url)}" alt="gif"></div>`;
      } else if (a.url && a.url.startsWith("data:image")) {
        attachHTML += `<div class="msg-embed-gif"><img src="${escAttr(a.url)}" alt="${escAttr(a.name || "")}"></div>`;
      } else if (a.url) {
        attachHTML += `<a href="${escAttr(a.url)}" download="${escAttr(a.name || "file")}" target="_blank" rel="noopener">${escHtml(a.name || "Download attachment")}</a>`;
      }
    }
    attachHTML += `</div>`;
  }

  const deleteBtn = canDelete
    ? `<div class="action-btn delete" title="Delete" onclick="deleteMessage('${escAttr(msgId)}')">🗑</div>`
    : "";

  wrap.innerHTML = `
    ${replyHTML}
    <div class="msg-avatar-col">
      ${isGroupStart
      ? `<div class="msg-avatar${isAdmin ? " admin-color" : ""}" title="${escAttr(data.sender)}">${(data.sender || "?")[0].toUpperCase()}</div>`
      : `<span class="msg-compact-ts">${timeStr}</span>`}
    </div>
    <div class="msg-body">
      ${isGroupStart
      ? `<div class="msg-meta">
            <span class="msg-sender${isAdmin ? " admin-name" : ""}" title="${escAttr(data.sender)}">${escHtml(data.sender || "")}${isAdmin ? ' <span class="role-badge admin">ADMIN</span>' : ""}</span>
            <span class="msg-time" title="${escAttr(fullTs)}">${timeStr}</span>
          </div>`
      : ""}
      <div class="msg-content">${bodyContent}</div>
      ${attachHTML}
      ${reactionsHTML}
    </div>
    <div class="msg-actions">
      <div class="action-btn" title="React" onclick="openReactionPopover(event,'${escAttr(msgId)}')">😊</div>
      <div class="action-btn" title="Reply" onclick="setReply('${escAttr(msgId)}','${escAttr(data.sender || "")}','${escAttr(data.content || "")}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
      </div>
      ${deleteBtn}
    </div>`;
  UI.msgContainer().appendChild(wrap);
}

function appendOrRerenderMessage(id) {
  const data = AppState.roomMessages.find(m => m.id === id);
  if (!data) return;
  rerenderAllMessages();
}

function replaceMessageNode(message) {
  const el = document.querySelector(`.msg-wrap[data-id="${message.id}"]`);
  if (!el) return rerenderAllMessages();
  const isGroupStart = el.classList.contains("group-start");
  const newEl = document.createElement("div");
  renderMessageInto(newEl, message, isGroupStart);
  el.replaceWith(newEl);
}

function renderMessageInto(wrap, data, isGroupStart) {
  const msgId = data.id;
  wrap.className = `msg-wrap${isGroupStart ? " group-start" : ""}`;
  wrap.setAttribute("data-id", msgId);
  wrap.setAttribute("data-sender", data.sender || "");
  wrap.setAttribute("data-content", data.content || "");
  const isAdmin = data.sender === ADMIN;
  const isOwn = data.sender === AppState.currentUser;
  const canDelete = isOwn || (AppState.view === "guild" && activeGuild() && (
    activeGuild().ownerId === AppState.currentUser || myPerm(PERM.ADMINISTRATOR)
  ));
  const ts = new Date(data.timestamp);
  const timeStr = ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const fullTs = ts.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  const reactions = normalizeReactions(data.reactions);
  let reactionsHTML = "";
  if (reactions.length) {
    reactionsHTML = `<div class="reactions-row">`;
    for (const r of reactions) {
      const isMine = r.users.includes(AppState.currentUser);
      reactionsHTML += `<div class="reaction-bubble${isMine ? " mine" : ""}"
        onclick="toggleReaction('${escAttr(msgId)}','${escAttr(r.emoji)}')"
        title="${escAttr(r.users.join(", "))}">${r.emoji}<span class="r-count">${r.count}</span></div>`;
    }
    reactionsHTML += `</div>`;
  }
  let replyHTML = "";
  if (data.replyingTo && data.replyingTo.id) {
    const rSndr = escHtml(data.replyingTo.sender || "");
    const rText = escHtml((data.replyingTo.content || "").substring(0, 80));
    const rId = escAttr(data.replyingTo.id);
    replyHTML = `
      <div class="reply-ref-bar" onclick="scrollToMsg('${rId}')">
        <span class="reply-ref-accent"></span>
        <span class="reply-ref-label">↪ ${rSndr}</span>
        <span class="reply-text">${rText}${(data.replyingTo.content || "").length > 80 ? "…" : ""}</span>
      </div>`;
  }
  let bodyContent = linkify(escHtml(data.content || ""));
  if (data.editedAt) bodyContent += ` <span class="msg-edited">(edited)</span>`;
  let attachHTML = "";
  const atts = data.attachments || [];
  if (atts.length) {
    attachHTML = `<div class="msg-attachments">`;
    for (const a of atts) {
      if (a.type === "gif" && a.url) attachHTML += `<div class="msg-embed-gif"><img src="${escAttr(a.url)}" alt="gif"></div>`;
      else if (a.url && a.url.startsWith("data:image")) attachHTML += `<div class="msg-embed-gif"><img src="${escAttr(a.url)}" alt=""></div>`;
      else if (a.url) attachHTML += `<a href="${escAttr(a.url)}" download="${escAttr(a.name || "file")}" target="_blank" rel="noopener">${escHtml(a.name || "Download")}</a>`;
    }
    attachHTML += `</div>`;
  }
  const deleteBtn = canDelete
    ? `<div class="action-btn delete" title="Delete" onclick="deleteMessage('${escAttr(msgId)}')">🗑</div>`
    : "";
  wrap.innerHTML = `
    ${replyHTML}
    <div class="msg-avatar-col">
      ${isGroupStart
      ? `<div class="msg-avatar${isAdmin ? " admin-color" : ""}" title="${escAttr(data.sender)}">${(data.sender || "?")[0].toUpperCase()}</div>`
      : `<span class="msg-compact-ts">${timeStr}</span>`}
    </div>
    <div class="msg-body">
      ${isGroupStart
      ? `<div class="msg-meta">
            <span class="msg-sender${isAdmin ? " admin-name" : ""}">${escHtml(data.sender || "")}</span>
            <span class="msg-time" title="${escAttr(fullTs)}">${timeStr}</span>
          </div>`
      : ""}
      <div class="msg-content">${bodyContent}</div>
      ${attachHTML}
      ${reactionsHTML}
    </div>
    <div class="msg-actions">
      <div class="action-btn" title="React" onclick="openReactionPopover(event,'${escAttr(msgId)}')">😊</div>
      <div class="action-btn" title="Reply" onclick="setReply('${escAttr(msgId)}','${escAttr(data.sender || "")}','${escAttr(data.content || "")}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
      </div>
      ${deleteBtn}
    </div>`;
}

function scrollToBottom() {
  const mc = UI.msgContainer();
  mc.scrollTop = mc.scrollHeight;
}

function scrollToMsg(msgId) {
  if (!msgId) return;
  const el = document.querySelector(`.msg-wrap[data-id="${msgId}"]`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.background = "#3d4269";
    setTimeout(() => { el.style.background = ""; }, 1500);
  }
}

// --- Send / edit ---
document.addEventListener("DOMContentLoaded", () => {
  const input = $("console-input");
  if (input) {
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendOrCommitEdit();
      }
    });
    input.addEventListener("input", handleTypingInput);
  }
  $("menu-reply")?.addEventListener("click", () => {
    if (!activeMsgId || !activeMsgData) return;
    setReply(activeMsgId, activeMsgData.sender, activeMsgData.content);
  });
  $("menu-delete")?.addEventListener("click", () => {
    if (activeMsgId) deleteMessage(activeMsgId);
  });
  $("menu-edit")?.addEventListener("click", () => {
    if (!activeMsgId || !activeMsgData || activeMsgData.sender !== AppState.currentUser) return;
    startEditMessage(activeMsgId, activeMsgData.content);
    hideMenu();
  });
  $("btn-attach-file")?.addEventListener("click", () => UI.fileInput().click());
  UI.fileInput()?.addEventListener("change", onFilesSelected);
  $("btn-giphy")?.addEventListener("click", openGiphyModal);
  $("btn-create-guild")?.addEventListener("click", promptCreateGuild);
  $("btn-join-guild")?.addEventListener("click", promptJoinGuild);
  UI.btnCreateChannel()?.addEventListener("click", promptCreateChannel);
  UI.genericModalClose()?.addEventListener("click", closeGenericModal);
  UI.genericModal()?.addEventListener("click", e => {
    if (e.target === UI.genericModal()) closeGenericModal();
  });
});

function sendOrCommitEdit() {
  if (AppState.editingMessageId) return commitEdit();
  sendMessage();
}

function sendMessage() {
  const input = UI.consoleInput();
  const val = input.value.trim();
  if (!val && !AppState.pendingAttachments.length) return;

  const attachments = AppState.pendingAttachments.slice();
  const payloadBase = {
    content: val,
    replyingTo: AppState.replyTarget,
    attachments,
  };

  if (isFirebaseBackend()) {
    const content = val || (attachments.length ? " " : "");
    const payload = {
      sender: AppState.currentUser,
      content,
      timestamp: firebase.database.ServerValue.TIMESTAMP,
    };
    if (attachments.length) payload.attachments = attachments;
    if (AppState.replyTarget) payload.replyingTo = AppState.replyTarget;
    db.ref(AppState.currentChatPath).push(payload);
    input.value = "";
    AppState.pendingAttachments = [];
    renderAttachmentStrip();
    cancelReply();
    clearTyping();
    return;
  }

  if (AppState.view === "dm") {
    AppState.socket.emit("dm:send", { peer: AppState.activeDmPeer, ...payloadBase }, res => {
      if (!res?.ok) showToast("Failed to send.");
    });
  } else {
    AppState.socket.emit("message:send", {
      guildId: AppState.activeGuildId,
      channelId: AppState.activeChannelId,
      ...payloadBase,
    }, res => {
      if (!res?.ok) showToast("Failed to send.");
    });
  }
  input.value = "";
  AppState.pendingAttachments = [];
  renderAttachmentStrip();
  cancelReply();
  clearTyping();
}

function startEditMessage(id, content) {
  AppState.editingMessageId = id;
  UI.consoleInput().value = content;
  UI.consoleInput().focus();
  showToast("Editing message — Enter to save, Escape to cancel.");
}

function commitEdit() {
  const id = AppState.editingMessageId;
  const content = UI.consoleInput().value.trim();
  if (!id) return;
  if (isFirebaseBackend()) {
    db.ref(`${AppState.currentChatPath}/${id}`).update({
      content,
      editedAt: Date.now(),
    });
    AppState.editingMessageId = null;
    UI.consoleInput().value = "";
    return;
  }
  if (AppState.view === "dm") {
    AppState.socket.emit("dm:edit", { dmKey: AppState.activeDmKey, messageId: id, content }, res => {
      if (!res?.ok) showToast("Edit failed.");
    });
  } else {
    AppState.socket.emit("message:edit", {
      guildId: AppState.activeGuildId,
      channelId: AppState.activeChannelId,
      messageId: id,
      content,
    }, res => {
      if (!res?.ok) showToast("Edit failed.");
    });
  }
  AppState.editingMessageId = null;
  UI.consoleInput().value = "";
}

function deleteMessage(msgId) {
  showConfirmModal("Delete Message?", "Are you sure you want to delete this message? This action cannot be undone.").then(confirmed => {
    if (!confirmed) return;
    if (isFirebaseBackend()) {
      db.ref(`${AppState.currentChatPath}/${msgId}`).remove();
      hideMenu();
      return;
    }
    if (AppState.view === "dm") {
      AppState.socket.emit("dm:delete", { dmKey: AppState.activeDmKey, messageId: msgId });
    } else {
      AppState.socket.emit("message:delete", {
        guildId: AppState.activeGuildId,
        channelId: AppState.activeChannelId,
        messageId: msgId,
      });
    }
    hideMenu();
  });
}

function toggleReaction(msgId, emoji) {
  if (isFirebaseBackend()) {
    toggleReactionFirebase(msgId, emoji);
    return;
  }
  if (AppState.view === "dm") {
    AppState.socket.emit("dm:reaction", { dmKey: AppState.activeDmKey, messageId: msgId, emoji });
  } else {
    AppState.socket.emit("reaction:toggle", {
      guildId: AppState.activeGuildId,
      channelId: AppState.activeChannelId,
      messageId: msgId,
      emoji,
    });
  }
}

function openReactionPopover(ev, msgId) {
  ev.stopPropagation();
  hideReactionPopover();
  const pop = UI.reactionPopover();
  pop.innerHTML = "";
  const emojis = [...QUICK_EMOJIS];
  for (const em of emojis) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = em;
    b.onclick = () => {
      toggleReaction(msgId, em);
      hideReactionPopover();
    };
    pop.appendChild(b);
  }
  pop.classList.remove("hidden");
  const r = ev.currentTarget.getBoundingClientRect();
  pop.style.left = `${Math.min(r.left, window.innerWidth - 240)}px`;
  pop.style.top = `${Math.max(8, r.top - pop.offsetHeight - 6)}px`;
  setTimeout(() => {
    window.addEventListener("click", hideReactionPopover, { once: true });
  }, 0);
}

function hideReactionPopover() {
  UI.reactionPopover().classList.add("hidden");
}

function addReactionFromMenu(emoji) {
  if (activeMsgId) toggleReaction(activeMsgId, emoji);
  hideMenu();
}

function openCustomEmoji() {
  const mId = activeMsgId;
  hideMenu();
  setTimeout(() => {
    const custom = prompt("Enter an emoji:");
    if (custom && custom.trim()) toggleReaction(mId, custom.trim().slice(0, 8));
  }, 120);
}

// --- Attachments ---
function onFilesSelected(ev) {
  const files = [...(ev.target.files || [])];
  ev.target.value = "";
  for (const f of files.slice(0, 5)) {
    const reader = new FileReader();
    reader.onload = () => {
      AppState.pendingAttachments.push({
        type: f.type.startsWith("image/") ? "image" : "file",
        name: f.name,
        url: reader.result,
        mime: f.type,
      });
      renderAttachmentStrip();
    };
    reader.readAsDataURL(f);
  }
}

function renderAttachmentStrip() {
  const strip = UI.attachmentStrip();
  strip.innerHTML = "";
  if (!AppState.pendingAttachments.length) {
    strip.classList.add("hidden");
    return;
  }
  strip.classList.remove("hidden");
  AppState.pendingAttachments.forEach((a, idx) => {
    const chip = document.createElement("div");
    chip.className = "attach-chip";
    if (a.type === "image" || a.mime?.startsWith("image/")) {
      chip.innerHTML = `<img alt="" src="${escAttr(a.url)}"><button type="button" class="attach-remove" data-i="${idx}">×</button>`;
    } else {
      chip.innerHTML = `<div class="attach-meta">${escHtml(a.name)}</div><button type="button" class="attach-remove" data-i="${idx}">×</button>`;
    }
    chip.querySelector(".attach-remove").onclick = () => {
      AppState.pendingAttachments.splice(idx, 1);
      renderAttachmentStrip();
    };
    strip.appendChild(chip);
  });
}

// --- Giphy ---
function closeGenericModal() {
  UI.genericModal().classList.add("hidden");
  UI.genericModalBody().innerHTML = "";
}

function openGiphyModal() {
  const modal = UI.genericModal();
  UI.genericModalTitle().textContent = "Pick a GIF";
  const body = UI.genericModalBody();
  body.innerHTML = `
    <p style="color:var(--text-muted);font-size:13px;margin-bottom:10px;">With <strong>npm start</strong>, search uses the server. On GitHub Pages, set <code>giphyApiKey</code> in <code>config.js</code> (Giphy developer dashboard).</p>
    <div class="giphy-search">
      <input type="text" id="giphy-q" placeholder="Search Giphy…" />
      <button type="button" id="giphy-go">Search</button>
    </div>
    <div class="giphy-grid" id="giphy-grid"></div>`;
  modal.classList.remove("hidden");
  const run = () => loadGiphy(body.querySelector("#giphy-q").value);
  body.querySelector("#giphy-go").onclick = run;
  body.querySelector("#giphy-q").addEventListener("keydown", e => {
    if (e.key === "Enter") run();
  });
  loadGiphy("trending");
}

async function loadGiphy(q) {
  const grid = $("giphy-grid");
  if (!grid) return;
  grid.innerHTML = "Loading…";
  const clientKey = (window.APP_CONFIG && window.APP_CONFIG.giphyApiKey) || "";
  try {
    let data;
    if (clientKey) {
      const url = !q || q === "trending"
        ? `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(clientKey)}&limit=24`
        : `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(clientKey)}&q=${encodeURIComponent(q)}&limit=24`;
      const r = await fetch(url);
      data = await r.json();
      if (!r.ok) {
        grid.innerHTML = `<span style="color:var(--red)">${escHtml(data.message || "Giphy error")}</span>`;
        return;
      }
    } else {
      const r = await fetch(`/api/giphy/search?q=${encodeURIComponent(q || "trending")}`);
      data = await r.json();
      if (!r.ok) {
        grid.innerHTML = `<span style="color:var(--red)">${escHtml(data.error || "Error")}</span><p style="margin-top:8px;color:var(--text-muted);font-size:12px;">On GitHub Pages, add <code>giphyApiKey</code> to config.js.</p>`;
        return;
      }
    }
    const items = data.data || [];
    grid.innerHTML = "";
    for (const it of items) {
      const url = it.images?.fixed_height_small?.url || it.images?.downsized?.url;
      if (!url) continue;
      const img = document.createElement("img");
      img.src = url;
      img.alt = it.title || "gif";
      img.onclick = () => {
        AppState.pendingAttachments.push({ type: "gif", name: it.title || "gif.gif", url: it.images?.original?.url || url, mime: "image/gif" });
        renderAttachmentStrip();
        closeGenericModal();
      };
      grid.appendChild(img);
    }
    if (!grid.children.length) grid.textContent = "No GIFs returned.";
  } catch (e) {
    grid.innerHTML = `<span style="color:var(--red)">Network error</span>`;
  }
}

// --- Guild / channel prompts ---
function promptCreateGuild() {
  if (isFirebaseBackend()) {
    showToast("Create server: use npm start (Socket.io) or deploy server.js.");
    return;
  }
  const name = prompt("Server name?");
  if (!name?.trim()) return;
  AppState.socket.emit("guild:create", { name: name.trim() }, res => {
    if (!res?.ok) return showToast("Could not create server.");
    showToast(`Server created. Invite: ${res.inviteCode}`);
    AppState.guilds.push(res.guild);
    renderGuildNav();
  });
}

function promptJoinGuild() {
  if (isFirebaseBackend()) {
    showToast("Join via invite: use npm start (Socket.io) or deploy server.js.");
    return;
  }
  const code = prompt("Invite code?");
  if (!code?.trim()) return;
  AppState.socket.emit("guild:join", { code: code.trim().toUpperCase() }, res => {
    if (!res?.ok) return showToast(res.error || "Invalid invite.");
    const idx = AppState.guilds.findIndex(g => g.id === res.guild.id);
    if (idx >= 0) AppState.guilds[idx] = res.guild;
    else AppState.guilds.push(res.guild);
    renderGuildNav();
    showToast("Joined server.");
  });
}

function promptCreateChannel() {
  if (isFirebaseBackend()) {
    showToast("Channel management: use npm start (Socket.io) or deploy server.js.");
    return;
  }
  if (!myPerm(PERM.MANAGE_CHANNELS)) return showToast("No permission.");

  const modal = document.getElementById("channel-modal");
  const nameInput = document.getElementById("channel-name-input");
  const createBtn = document.getElementById("channel-create");
  const cancelBtn = document.getElementById("channel-cancel");
  const closeBtn = document.getElementById("channel-modal-close");

  nameInput.value = "";
  document.querySelector('input[name="channel-type"][value="text"]').checked = true;

  const handleCreate = () => {
    const name = nameInput.value.trim();
    if (!name) {
      showToast("Please enter a channel name.");
      return;
    }
    const type = document.querySelector('input[name="channel-type"]:checked').value;
    cleanup();
    AppState.socket.emit("channel:create", {
      guildId: AppState.activeGuildId,
      name: name,
      type: type,
      category: type === "voice" ? "Voice Channels" : "Text Channels",
    }, res => {
      if (!res?.ok) return showToast(res.error || "Could not create channel.");
      showToast("Channel created.");
    });
  };

  const handleCancel = () => cleanup();

  const cleanup = () => {
    createBtn.removeEventListener("click", handleCreate);
    cancelBtn.removeEventListener("click", handleCancel);
    closeBtn.removeEventListener("click", handleCancel);
    modal.classList.add("hidden");
  };

  createBtn.addEventListener("click", handleCreate);
  cancelBtn.addEventListener("click", handleCancel);
  closeBtn.addEventListener("click", handleCancel);
  nameInput.addEventListener("keydown", e => {
    if (e.key === "Enter") handleCreate();
    if (e.key === "Escape") handleCancel();
  });
  modal.classList.remove("hidden");
  nameInput.focus();
}

// --- Members + DMs ---
function renderMembersAndDms(onlineList, firebaseAllNames) {
  const onlineSet = new Set(onlineList);
  UI.dmList().innerHTML = "";
  UI.membersList().innerHTML = "";
  let onlineCount = 0;
  const allUsers = new Set(onlineList);
  if (firebaseAllNames && firebaseAllNames.length) {
    firebaseAllNames.forEach(n => allUsers.add(n));
  } else {
    for (const g of AppState.guilds) {
      const mids = g.memberIds || [];
      for (const uid of mids) allUsers.add(uid);
    }
  }
  allUsers.add(AppState.currentUser);
  const names = [...allUsers].sort();
  for (const name of names) {
    const online = onlineSet.has(name);
    if (online) onlineCount++;
    if (name !== AppState.currentUser) {
      const item = document.createElement("div");
      item.className = "dm-item";
      item.id = `dm-item-${name}`;
      if (!online) item.style.opacity = ".5";
      item.innerHTML = `
        <div class="dm-avatar" style="${name === ADMIN ? "background:#e91e63;" : ""}">${name[0].toUpperCase()}</div>
        <span>${escHtml(name)}</span>`;
      item.onclick = () => openDm(name);
      UI.dmList().appendChild(item);
    }
    const mItem = document.createElement("div");
    mItem.className = "member-item";
    if (!online) mItem.style.opacity = ".45";
    mItem.innerHTML = `
      <div class="member-av${name === ADMIN ? " admin-color" : ""}">${name[0].toUpperCase()}</div>
      <span class="member-name${name === ADMIN ? " admin-name" : ""}">${escHtml(name)}${name === ADMIN ? ' <span class="role-badge admin">ADMIN</span>' : ""}</span>`;
    UI.membersList().appendChild(mItem);
  }
  UI.onlineCount().textContent = onlineCount;
}

// --- Typing ---
function handleTypingInput() {
  if (isFirebaseBackend()) {
    const key = AppState.currentChatPath.replace(/\//g, "_");
    if (!key) return;
    if (!isTyping) {
      isTyping = true;
      db.ref(`typing/${key}/${firebaseSafeKey(AppState.currentUser)}`).set(true);
    }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      isTyping = false;
      db.ref(`typing/${key}/${firebaseSafeKey(AppState.currentUser)}`).remove();
    }, TYPING_TIMEOUT_MS);
    return;
  }
  const ctx = typingPayload();
  if (!ctx) return;
  if (!isTyping) {
    isTyping = true;
    AppState.socket.emit("typing", ctx);
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    isTyping = false;
    AppState.socket.emit("typing:stop", ctx);
  }, TYPING_TIMEOUT_MS);
}

function typingPayload() {
  if (AppState.view === "dm" && AppState.activeDmKey) return { dmKey: AppState.activeDmKey };
  if (AppState.view === "guild" && AppState.activeGuildId && AppState.activeChannelId) {
    return { guildId: AppState.activeGuildId, channelId: AppState.activeChannelId };
  }
  return null;
}

function clearTyping() {
  if (!isTyping) return;
  isTyping = false;
  clearTimeout(typingTimer);
  if (isFirebaseBackend()) {
    const key = AppState.currentChatPath.replace(/\//g, "_");
    if (key) db.ref(`typing/${key}/${firebaseSafeKey(AppState.currentUser)}`).remove();
    return;
  }
  const ctx = typingPayload();
  if (ctx) AppState.socket.emit("typing:stop", ctx);
}

// --- Context menu ---
window.addEventListener("contextmenu", e => {
  const appUI = document.getElementById("app-ui");
  if (appUI && appUI.contains(e.target)) {
    e.preventDefault();
  }

  const msgEl = e.target.closest(".msg-wrap");
  if (!msgEl) {
    hideMenu();
    return;
  }
  activeMsgId = msgEl.getAttribute("data-id");
  activeMsgData = {
    sender: msgEl.getAttribute("data-sender"),
    content: msgEl.getAttribute("data-content"),
  };
  const canDelete = activeMsgData.sender === AppState.currentUser
    || (AppState.view === "guild" && activeGuild() && (
      activeGuild().ownerId === AppState.currentUser || myPerm(PERM.ADMINISTRATOR)
    ));
  UI.menuDelete().style.display = canDelete ? "flex" : "none";
  const canEdit = activeMsgData.sender === AppState.currentUser;
  UI.menuEdit().style.display = canEdit ? "flex" : "none";
  showContextMenu(e.clientX, e.clientY);
});

window.addEventListener("click", e => {
  if (!e.target.closest("#context-menu")) hideMenu();
});

function showContextMenu(x, y) {
  const menu = UI.contextMenu();
  menu.classList.add("visible");
  const mw = 196;
  const mh = 300;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  menu.style.left = `${Math.min(x, vw - mw - 8)}px`;
  menu.style.top = `${Math.min(y, vh - mh - 8)}px`;
}

function hideMenu() {
  UI.contextMenu().classList.remove("visible");
}

function copyMessageText() {
  if (!activeMsgData?.content) return;
  navigator.clipboard.writeText(activeMsgData.content).then(() => showToast("Message copied.")).catch(() => showToast("Copy failed."));
  hideMenu();
}

function copyMsgId() {
  if (!activeMsgId) return;
  navigator.clipboard.writeText(activeMsgId).then(() => showToast("Message ID copied.")).catch(() => showToast("Copy failed."));
  hideMenu();
}

// --- Misc UI ---
function toggleMembers() {
  membersOpen = !membersOpen;
  UI.membersPanel().classList.toggle("open", membersOpen);
}

window.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (UI.contextMenu().classList.contains("visible")) {
    hideMenu();
    return;
  }
  if (!UI.genericModal().classList.contains("hidden")) {
    closeGenericModal();
    return;
  }
  hideReactionPopover();
  if (AppState.editingMessageId) {
    AppState.editingMessageId = null;
    UI.consoleInput().value = "";
    return;
  }
  if (AppState.replyTarget) {
    cancelReply();
    return;
  }
  stealth();
});

function stealth() {
  clearTyping();
  UI.appUI().classList.remove("visible");
  UI.mathCover().style.display = "block";
}

function openEmojiPicker() {
  const existingPicker = $("emoji-picker-popup");
  if (existingPicker) {
    existingPicker.remove();
    return;
  }
  const popup = document.createElement("div");
  popup.id = "emoji-picker-popup";
  Object.assign(popup.style, {
    position: "fixed",
    bottom: "76px",
    right: "80px",
    background: "var(--bg-darkest)",
    border: "1px solid var(--bg-mid)",
    borderRadius: "8px",
    padding: "10px",
    display: "flex",
    flexWrap: "wrap",
    gap: "4px",
    width: "192px",
    boxShadow: "var(--shadow-lg)",
    zIndex: "15000",
  });
  for (const em of QUICK_EMOJIS) {
    const btn = document.createElement("span");
    btn.textContent = em;
    btn.style.cssText = "font-size:22px;cursor:pointer;padding:4px;border-radius:4px;";
    btn.onmouseenter = () => { btn.style.background = "var(--bg-hover)"; };
    btn.onmouseleave = () => { btn.style.background = "transparent"; };
    btn.onclick = () => {
      UI.consoleInput().value += em;
      UI.consoleInput().focus();
      popup.remove();
    };
    popup.appendChild(btn);
  }
  document.body.appendChild(popup);
  setTimeout(() => {
    window.addEventListener("click", function closePicker(ev) {
      if (!popup.contains(ev.target)) {
        popup.remove();
        window.removeEventListener("click", closePicker);
      }
    });
  }, 50);
}

function showToast(msg, duration = 2800) {
  const toast = UI.toast();
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), duration);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escAttr(str) {
  return String(str)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, " ")
    .replace(/\r/g, "");
}

function updateVisibleMessages() {
  const container = UI.msgContainer();
  if (!container) return;

  const containerHeight = container.clientHeight;
  const scrollTop = container.scrollTop;
  const msgElements = container.querySelectorAll('.msg-wrap[data-msg-index]');

  let firstVisible = 0;
  let lastVisible = msgElements.length - 1;

  for (let i = 0; i < msgElements.length; i++) {
    const el = msgElements[i];
    const rect = el.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const elTopInContainer = el.offsetTop;
    const elBottomInContainer = elTopInContainer + el.offsetHeight;

    if (elBottomInContainer >= scrollTop && elTopInContainer <= scrollTop + containerHeight) {
      if (firstVisible === 0) firstVisible = i;
      lastVisible = i;
    }
  }

  const buffer = AppState.virtualizationBuffer;
  AppState.visibleMessageStart = Math.max(0, firstVisible - buffer);
  AppState.visibleMessageEnd = Math.min(msgElements.length - 1, lastVisible + buffer);

  for (let i = 0; i < msgElements.length; i++) {
    const el = msgElements[i];
    if (i >= AppState.visibleMessageStart && i <= AppState.visibleMessageEnd) {
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  }
}

function initVirtualization() {
  const container = UI.msgContainer();
  if (container) {
    container.addEventListener('scroll', updateVisibleMessages, { passive: true });
  }
}

function showConfirmModal(title, message) {
  return new Promise(resolve => {
    const modal = document.getElementById("confirm-modal");
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-message").textContent = message;

    const handleOk = () => {
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      document.getElementById("confirm-ok").removeEventListener("click", handleOk);
      document.getElementById("confirm-cancel").removeEventListener("click", handleCancel);
      modal.classList.add("hidden");
    };

    document.getElementById("confirm-ok").addEventListener("click", handleOk);
    document.getElementById("confirm-cancel").addEventListener("click", handleCancel);
    modal.classList.remove("hidden");
  });
}

function linkify(text) {
  return text.replace(
    /(https?:\/\/[^\s<>"']+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
}

// Expose for inline handlers
window.handleLogin = handleLogin;
window.cancelReply = cancelReply;
window.toggleMembers = toggleMembers;
window.addReactionFromMenu = addReactionFromMenu;
window.openCustomEmoji = openCustomEmoji;
window.copyMessageText = copyMessageText;
window.copyMsgId = copyMsgId;
window.openEmojiPicker = openEmojiPicker;
window.scrollToMsg = scrollToMsg;
window.deleteMessage = deleteMessage;
window.toggleReaction = toggleReaction;
window.openReactionPopover = openReactionPopover;
window.setReply = setReply;

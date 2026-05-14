/**
 * SCHOOL — app.js
 * Full engine: Auth, Messaging, DMs, Reactions, Typing, Members, Stealth
 * Fixes: reply ghost, GIF picker (Tenor), file/image upload (Firebase Storage)
 */

// ================================================================
// 1. FIREBASE INIT
// ================================================================
const firebaseConfig = {
    apiKey:            "AIzaSyAaPbKLUV7S1gtKDyr-keBjS38nViPRMkw",
    authDomain:        "schoolmathpart.firebaseapp.com",
    databaseURL:       "https://schoolmathpart-default-rtdb.europe-west1.firebasedatabase.app",
    projectId:         "schoolmathpart",
    storageBucket:     "schoolmathpart.firebasestorage.app",
    messagingSenderId: "525859836367",
    appId:             "1:525859836367:web:843e220ad112d5327e02ba"
};

firebase.initializeApp(firebaseConfig);
const db      = firebase.database();
const auth    = firebase.auth();
const storage = firebase.storage();   // requires firebase-storage-compat SDK

// ================================================================
// 2. CONSTANTS & STATE
// ================================================================
const ADMIN           = "aadomy21";
const MAX_REACTIONS   = 12;
const TYPING_TIMEOUT  = 3000;
const MSG_LIMIT       = 60;
// Get a free key at https://tenor.com/developer/dashboard
const TENOR_KEY       = "YOUR_TENOR_API_KEY_HERE";
const GIF_LIMIT       = 20;

let myUsername        = "";
let currentChatPath   = "channels/general";
let currentChatName   = "general";
let currentChatType   = "channel";
let currentListener   = null;
let replyTo           = null;   // { id, sender, content } — only set/cleared by setReply/cancelReply
let activeMsgId       = null;
let activeMsgData     = null;
let typingTimer       = null;
let isTyping          = false;
let membersOpen       = false;
let typingListenerKey = null;
let gifSearchTimer    = null;

const lastSeen = {};

// ================================================================
// 3. DOM SHORTCUTS
// ================================================================
const $ = id => document.getElementById(id);

const UI = {
    mathCover:       () => $("math-cover"),
    loginOverlay:    () => $("login-overlay"),
    appUI:           () => $("app-ui"),
    loginEmail:      () => $("li-email"),
    loginPass:       () => $("li-pass"),
    loginBtn:        () => $("li-btn"),
    loginErr:        () => $("login-err"),
    msgContainer:    () => $("message-container"),
    consoleInput:    () => $("console-input"),
    chatTitle:       () => $("chat-title"),
    chatTopic:       () => $("chat-topic"),
    myName:          () => $("my-name-display"),
    statusText:      () => $("status-text"),
    userAvatar:      () => $("user-avatar"),
    dmList:          () => $("dm-list"),
    membersList:     () => $("members-list"),
    onlineCount:     () => $("online-count"),
    membersPanel:    () => $("members-panel"),
    replyBanner:     () => $("reply-banner"),
    replyNameLabel:  () => $("reply-name-label"),
    typingIndicator: () => $("typing-indicator"),
    contextMenu:     () => $("context-menu"),
    menuDelete:      () => $("menu-delete"),
    menuReply:       () => $("menu-reply"),
    toast:           () => $("toast"),
    chatHeader:      () => $("chat-header"),
};

// ================================================================
// 4. LOGIN & AUTH
// ================================================================
window.onload = () => {
    UI.loginOverlay().classList.add("active");
    UI.loginPass().addEventListener("keydown", e => { if (e.key === "Enter") handleLogin(); });
    UI.loginEmail().addEventListener("keydown", e => { if (e.key === "Enter") UI.loginPass().focus(); });
};

function handleLogin() {
    const email = UI.loginEmail().value.trim();
    const pass  = UI.loginPass().value;
    if (!email || !pass) { showLoginError("Please fill in both fields."); return; }

    const btn = UI.loginBtn();
    btn.disabled    = true;
    btn.textContent = "Logging in…";
    UI.loginErr().textContent = "";

    auth.signInWithEmailAndPassword(email, pass)
        .then(() => {
            myUsername = email.split("@")[0].toLowerCase();
            UI.loginOverlay().classList.remove("active");
            revealApp();
        })
        .catch(err => {
            let msg = "Incorrect ID or access key.";
            if (err.code === "auth/too-many-requests") msg = "Too many attempts. Try again later.";
            if (err.code === "auth/invalid-email")     msg = "Invalid email format.";
            showLoginError(msg);
            btn.disabled    = false;
            btn.textContent = "Log In";
        });
}

function showLoginError(msg) { UI.loginErr().textContent = msg; }

// ================================================================
// 5. APP REVEAL
// ================================================================
function revealApp() {
    UI.mathCover().style.display = "none";
    UI.appUI().classList.add("visible");

    UI.myName().textContent     = myUsername;
    UI.statusText().textContent = "Online";
    UI.statusText().style.color = "var(--green)";

    const av = UI.userAvatar();
    av.textContent = myUsername[0].toUpperCase();
    if (myUsername === ADMIN) av.style.background = "#e91e63";

    registerPresence();
    syncUserList();
    wireInputBar();
    switchChat("general", "channel");
}

// ================================================================
// 6. PRESENCE
// ================================================================
function registerPresence() {
    const ref = db.ref(`system/users/${myUsername}`);
    ref.set({ online: true, ts: firebase.database.ServerValue.TIMESTAMP });
    ref.onDisconnect().update({ online: false, ts: firebase.database.ServerValue.TIMESTAMP });
    setInterval(() => ref.update({ online: true, ts: firebase.database.ServerValue.TIMESTAMP }), 30000);
}

// ================================================================
// 7. USER LIST
// ================================================================
function syncUserList() {
    db.ref("system/users").on("value", snap => {
        UI.dmList().innerHTML      = "";
        UI.membersList().innerHTML = "";
        let onlineCount = 0;

        snap.forEach(userSnap => {
            const name   = userSnap.key;
            const data   = userSnap.val() || {};
            const online = data.online === true;
            if (online) onlineCount++;

            if (name !== myUsername) {
                const item = document.createElement("div");
                item.className = "dm-item";
                item.id        = `dm-item-${name}`;
                if (!online) item.style.opacity = ".5";
                item.innerHTML = `
                    <div class="dm-avatar" style="${name === ADMIN ? "background:#e91e63;" : ""}">
                        ${name[0].toUpperCase()}
                    </div>
                    <span>${escHtml(name)}</span>`;
                item.onclick = () => switchChat(name, "dm");
                UI.dmList().appendChild(item);
            }

            const mItem = document.createElement("div");
            mItem.className = `member-item${online ? "" : " offline"}`;
            if (!online) mItem.style.opacity = ".45";
            mItem.innerHTML = `
                <div class="member-av${name === ADMIN ? " admin-color" : ""}">
                    ${name[0].toUpperCase()}
                </div>
                <span class="member-name${name === ADMIN ? " admin-name" : ""}">
                    ${escHtml(name)}${name === ADMIN ? ' <span class="role-badge admin">ADMIN</span>' : ""}
                </span>`;
            UI.membersList().appendChild(mItem);
        });

        UI.onlineCount().textContent = onlineCount;
    });
}

// ================================================================
// 8. CHAT NAVIGATION
// ================================================================
const CHANNEL_TOPICS = {
    general:  "General chat — keep it cool",
    random:   "Anything goes",
    homework: "Homework help — share resources",
};
function channelTopic(ch) { return CHANNEL_TOPICS[ch] || ""; }

function switchChat(target, type) {
    currentChatType = type;
    currentChatName = target;

    document.querySelectorAll(".channel-link").forEach(el => el.classList.remove("active"));
    document.querySelectorAll(".dm-item").forEach(el => el.classList.remove("active"));

    const pfx = UI.chatHeader().querySelector(".ch-prefix");

    if (type === "channel") {
        currentChatPath = `channels/${target}`;
        UI.chatTitle().textContent    = target;
        UI.chatTopic().textContent    = channelTopic(target);
        UI.consoleInput().placeholder = `Message #${target}`;
        if (pfx) pfx.textContent = "#";
        const chEl = $(`ch-${target}`);
        if (chEl) chEl.classList.add("active");
    } else {
        const sorted    = [myUsername, target].sort().join("_");
        currentChatPath = `dms/${sorted}`;
        UI.chatTitle().textContent    = `@${target}`;
        UI.chatTopic().textContent    = `Direct Message with ${target}`;
        UI.consoleInput().placeholder = `Message @${target}`;
        if (pfx) pfx.textContent = "@";
        const dmEl = $(`dm-item-${target}`);
        if (dmEl) dmEl.classList.add("active");
    }

    cancelReply();
    listenForMessages(currentChatPath);
    listenTyping(currentChatPath);
    lastSeen[currentChatPath] = Date.now();
    hideBadge(target);
}

// ================================================================
// 9. MESSAGE LISTENER & RENDERER
// ================================================================
function listenForMessages(path) {
    if (currentListener) db.ref(currentListener).off("value");
    currentListener = path;

    UI.msgContainer().innerHTML = "";
    renderWelcomeBanner();

    db.ref(path).limitToLast(MSG_LIMIT).on("value", snap => {
        const mc       = UI.msgContainer();
        const atBottom = mc.scrollHeight - mc.scrollTop - mc.clientHeight < 80;

        mc.innerHTML = "";
        renderWelcomeBanner();

        let prevSender = null;
        let prevDate   = null;

        snap.forEach(child => {
            const data    = child.val();
            const msgDate = new Date(data.timestamp).toDateString();
            const isGroup = prevSender === data.sender && prevDate === msgDate;
            if (prevDate !== msgDate) renderDayDivider(data.timestamp);
            renderMessage(child.key, data, !isGroup);
            prevSender = data.sender;
            prevDate   = msgDate;
        });

        if (atBottom) mc.scrollTop = mc.scrollHeight;
    });
}

function renderWelcomeBanner() {
    const banner     = document.createElement("div");
    banner.className = "welcome-banner";
    const isChannel  = currentChatType === "channel";
    const icon       = isChannel ? "#" : (currentChatName[0] || "?").toUpperCase();
    const title      = isChannel ? `Welcome to #${currentChatName}!` : `Your DM with ${currentChatName}`;
    const sub        = isChannel
        ? `This is the beginning of #${currentChatName}. ${channelTopic(currentChatName)}`
        : `This is the beginning of your direct message history with ${escHtml(currentChatName)}.`;
    banner.innerHTML = `<div class="wb-icon">${icon}</div><h2>${escHtml(title)}</h2><p>${sub}</p>`;
    UI.msgContainer().appendChild(banner);
}

function renderDayDivider(ts) {
    const div     = document.createElement("div");
    div.className = "day-divider";
    const d       = new Date(ts);
    const today   = new Date();
    const yest    = new Date(); yest.setDate(today.getDate() - 1);
    let label;
    if      (d.toDateString() === today.toDateString()) label = "Today";
    else if (d.toDateString() === yest.toDateString())  label = "Yesterday";
    else label = d.toLocaleDateString([], { weekday:"long", month:"long", day:"numeric", year:"numeric" });
    div.innerHTML = `<span>${label}</span>`;
    UI.msgContainer().appendChild(div);
}

function renderMessage(msgId, data, isGroupStart) {
    const wrap     = document.createElement("div");
    wrap.className = `msg-wrap${isGroupStart ? " group-start" : ""}`;

    // Use dataset — NO inline onclick. All events delegated via #message-container listener.
    wrap.dataset.id      = msgId;
    wrap.dataset.sender  = data.sender  || "";
    wrap.dataset.content = data.content || "";

    const isAdmin   = data.sender === ADMIN;
    const canDelete = data.sender === myUsername || myUsername === ADMIN;

    const ts      = new Date(data.timestamp);
    const timeStr = ts.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
    const fullTs  = ts.toLocaleString([], { dateStyle:"medium", timeStyle:"short" });

    // --- Reactions ---
    let reactionsHTML = "";
    if (data.reactions) {
        const pairs = Object.entries(data.reactions).filter(([, u]) => Object.keys(u).length > 0);
        if (pairs.length) {
            reactionsHTML = `<div class="reactions-row">` +
                pairs.map(([emoji, users]) => {
                    const count  = Object.keys(users).length;
                    const isMine = !!users[myUsername];
                    // data-action="reaction" picked up by delegated listener
                    return `<div class="reaction-bubble${isMine ? " mine" : ""}"
                                 data-action="reaction"
                                 data-msg="${escAttr(msgId)}"
                                 data-emoji="${escAttr(emoji)}"
                                 title="${escAttr(Object.keys(users).join(", "))}">
                                ${emoji} <span class="r-count">${count}</span>
                            </div>`;
                }).join("") + `</div>`;
        }
    }

    // --- Reply preview ---
    let replyHTML = "";
    if (data.replyingTo) {
        const rSndr  = escHtml(data.replyingTo.sender  || "");
        const rText  = escHtml((data.replyingTo.content || "").substring(0, 60));
        const rExtra = (data.replyingTo.content || "").length > 60 ? "…" : "";
        replyHTML = `
            <div class="reply-preview" data-action="scroll-reply" data-scroll="${escAttr(data.replyingTo.id || "")}">
                <div class="reply-preview-line"></div>
                <div class="reply-avatar">${(data.replyingTo.sender || "?")[0].toUpperCase()}</div>
                <span class="reply-name">${rSndr}</span>
                <span class="reply-text">${rText}${rExtra}</span>
            </div>`;
    }

    // --- Image/GIF attachment ---
    let imageHTML = "";
    if (data.imageUrl) {
        imageHTML = `<div class="msg-image-wrap">
            <img src="${escAttr(data.imageUrl)}" class="msg-image" alt="image"
                 data-action="open-image" data-url="${escAttr(data.imageUrl)}">
        </div>`;
    }

    // --- File attachment ---
    let fileHTML = "";
    if (data.fileUrl) {
        const fname = escHtml(data.content || "File");
        fileHTML = `<a class="msg-file" href="${escAttr(data.fileUrl)}" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
            </svg>
            ${fname}
        </a>`;
    }

    // --- Text content ---
    const contentHTML = (data.content && !data.fileUrl)
        ? `<div class="msg-content">${linkify(escHtml(data.content))}</div>`
        : "";

    // --- Delete button ---
    const deleteBtn = canDelete
        ? `<div class="action-btn delete" title="Delete"
                data-action="delete" data-id="${escAttr(msgId)}">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                   <polyline points="3 6 5 6 21 6"/>
                   <path d="M19 6l-1 14H6L5 6"/>
                   <path d="M10 11v6"/><path d="M14 11v6"/>
                   <path d="M9 6V4h6v2"/>
               </svg>
           </div>`
        : "";

    wrap.innerHTML = `
        ${replyHTML}
        <div class="msg-avatar-col">
            ${isGroupStart
                ? `<div class="msg-avatar${isAdmin ? " admin-color" : ""}">${(data.sender || "?")[0].toUpperCase()}</div>`
                : `<span class="msg-compact-ts">${timeStr}</span>`}
        </div>
        <div class="msg-body">
            ${isGroupStart ? `
                <div class="msg-meta">
                    <span class="msg-sender${isAdmin ? " admin-name" : ""}">
                        ${escHtml(data.sender || "")}
                        ${isAdmin ? '<span class="role-badge admin">ADMIN</span>' : ""}
                    </span>
                    <span class="msg-time" title="${escAttr(fullTs)}">${timeStr}</span>
                </div>` : ""}
            ${contentHTML}
            ${imageHTML}
            ${fileHTML}
            ${reactionsHTML}
        </div>
        <div class="msg-actions">
            <div class="action-btn" title="React"
                 data-action="react" data-id="${escAttr(msgId)}">😊</div>
            <div class="action-btn" title="Reply"
                 data-action="reply"
                 data-id="${escAttr(msgId)}"
                 data-sender="${escAttr(data.sender || "")}"
                 data-content="${escAttr(data.content || "")}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 17 4 12 9 7"/>
                    <path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
                </svg>
            </div>
            ${deleteBtn}
        </div>`;

    UI.msgContainer().appendChild(wrap);
}

// ================================================================
// 10. DELEGATED EVENT LISTENER — message container
// No inline onclick anywhere in rendered messages.
// ================================================================
document.addEventListener("DOMContentLoaded", () => {
    $("message-container").addEventListener("click", e => {
        const el     = e.target.closest("[data-action]");
        if (!el) return;
        const action = el.dataset.action;

        if (action === "react")        { openQuickReact(el.dataset.id);                               return; }
        if (action === "reply")        { setReply(el.dataset.id, el.dataset.sender, el.dataset.content); return; }
        if (action === "delete")       { deleteMessage(el.dataset.id);                                return; }
        if (action === "reaction")     { addReaction(el.dataset.msg, el.dataset.emoji);               return; }
        if (action === "scroll-reply") { scrollToMsg(el.dataset.scroll);                              return; }
        if (action === "open-image")   { window.open(el.dataset.url, "_blank");                       return; }
    });
});

// ================================================================
// 11. INPUT BAR WIRING (called once from revealApp)
// ================================================================
function wireInputBar() {
    const input = UI.consoleInput();
    input.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    input.addEventListener("input", handleTypingInput);

    // Context menu static buttons
    UI.menuReply().addEventListener("click", () => {
        if (activeMsgId && activeMsgData) setReply(activeMsgId, activeMsgData.sender, activeMsgData.content);
    });
    UI.menuDelete().addEventListener("click", () => {
        if (activeMsgId) deleteMessage(activeMsgId);
    });

    // File input (hidden)
    const fi = $("file-input");
    if (fi) fi.addEventListener("change", handleFileSelected);
}

// ================================================================
// 12. SEND MESSAGE
// ================================================================
function sendMessage() {
    const input = UI.consoleInput();
    const val   = input.value.trim();
    if (!val) return;

    const payload = {
        sender:    myUsername,
        content:   val,
        timestamp: firebase.database.ServerValue.TIMESTAMP,
    };
    if (replyTo) payload.replyingTo = { ...replyTo };

    db.ref(currentChatPath).push(payload);
    input.value = "";
    cancelReply();
    clearTyping();
}

// ================================================================
// 13. REPLY SYSTEM
// ================================================================
function setReply(msgId, sender, content) {
    replyTo = { id: msgId, sender, content };
    UI.replyBanner().classList.add("active");
    UI.replyNameLabel().textContent = sender;
    UI.consoleInput().placeholder   = `Reply to ${sender}…`;
    UI.consoleInput().focus();
    hideMenu();
}

function cancelReply() {
    replyTo = null;
    UI.replyBanner().classList.remove("active");
    UI.replyNameLabel().textContent = "";
    UI.consoleInput().placeholder   = currentChatType === "channel"
        ? `Message #${currentChatName}`
        : `Message @${currentChatName}`;
}

function scrollToMsg(msgId) {
    if (!msgId) return;
    const el = document.querySelector(`[data-id="${msgId}"]`);
    if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.background = "#3d4269";
        setTimeout(() => (el.style.background = ""), 1500);
    }
}

// ================================================================
// 14. DELETE
// ================================================================
function deleteMessage(msgId) {
    if (!confirm("Delete this message?")) return;
    db.ref(`${currentChatPath}/${msgId}`).remove();
    hideMenu();
}

// ================================================================
// 15. REACTION ENGINE
// ================================================================
function addReaction(msgId, emoji) {
    const msgRef  = db.ref(`${currentChatPath}/${msgId}/reactions`);
    const userRef = db.ref(`${currentChatPath}/${msgId}/reactions/${emoji}/${myUsername}`);
    msgRef.once("value", snap => {
        const all      = snap.val() || {};
        const hasEmoji = !!all[emoji];
        const hasMine  = hasEmoji && !!all[emoji][myUsername];
        if (hasMine) {
            userRef.remove();
        } else {
            if (!hasEmoji && Object.keys(all).length >= MAX_REACTIONS) {
                showToast(`Max ${MAX_REACTIONS} unique reactions per message.`);
                return;
            }
            userRef.set(true);
        }
    });
}

function addReactionFromMenu(emoji) {
    if (activeMsgId) addReaction(activeMsgId, emoji);
    hideMenu();
}

function openCustomEmoji() {
    const mId = activeMsgId;
    hideMenu();
    setTimeout(() => {
        const custom = prompt("Enter an emoji:");
        if (custom && custom.trim()) addReaction(mId, custom.trim().substring(0, 8));
    }, 120);
}

function openQuickReact(msgId) {
    activeMsgId   = msgId;
    activeMsgData = null;
    const el = document.querySelector(`[data-id="${msgId}"] .msg-actions`);
    if (el) {
        const r = el.getBoundingClientRect();
        showContextMenu(r.left, r.bottom + 4);
    }
}

// ================================================================
// 16. CONTEXT MENU
// ================================================================
window.addEventListener("contextmenu", e => {
    const msgEl = e.target.closest(".msg-wrap");
    if (!msgEl) { hideMenu(); return; }
    e.preventDefault();
    activeMsgId   = msgEl.dataset.id;
    activeMsgData = { sender: msgEl.dataset.sender, content: msgEl.dataset.content };
    UI.menuDelete().style.display =
        (activeMsgData.sender === myUsername || myUsername === ADMIN) ? "flex" : "none";
    showContextMenu(e.clientX, e.clientY);
});

window.addEventListener("click", e => {
    if (!e.target.closest("#context-menu")) hideMenu();
});

function showContextMenu(x, y) {
    const menu = UI.contextMenu();
    menu.classList.add("visible");
    const mw = 196, mh = 260;
    menu.style.left = `${Math.min(x, window.innerWidth  - mw - 8)}px`;
    menu.style.top  = `${Math.min(y, window.innerHeight - mh - 8)}px`;
}

function hideMenu() { UI.contextMenu().classList.remove("visible"); }

function copyMessageText() {
    if (!activeMsgData?.content) return;
    navigator.clipboard.writeText(activeMsgData.content)
        .then(()  => showToast("Message copied."))
        .catch(() => showToast("Copy failed."));
    hideMenu();
}

function copyMsgId() {
    if (!activeMsgId) return;
    navigator.clipboard.writeText(activeMsgId)
        .then(()  => showToast("Message ID copied."))
        .catch(() => showToast("Copy failed."));
    hideMenu();
}

// ================================================================
// 17. GIF PICKER  (Tenor v2 API)
// Get a free key: https://tenor.com/developer/dashboard
// ================================================================
function openGifPicker() {
    const existing = $("gif-picker-popup");
    if (existing) { existing.remove(); return; }

    const popup   = document.createElement("div");
    popup.id      = "gif-picker-popup";
    Object.assign(popup.style, {
        position:      "fixed",
        bottom:        "76px",
        right:         "56px",
        width:         "320px",
        maxHeight:     "380px",
        background:    "var(--bg-darkest)",
        border:        "1px solid var(--bg-mid)",
        borderRadius:  "8px",
        display:       "flex",
        flexDirection: "column",
        overflow:      "hidden",
        boxShadow:     "var(--shadow-lg)",
        zIndex:        "15000",
        animation:     "slideUp .15s ease",
    });

    popup.innerHTML = `
        <div style="padding:8px;flex-shrink:0;">
            <input id="gif-search-input" type="text" placeholder="Search GIFs…"
                   style="width:100%;background:var(--bg-mid);border:1px solid var(--bg-hover);
                          border-radius:6px;padding:7px 10px;color:var(--text-norm);
                          font-size:14px;outline:none;font-family:inherit;caret-color:#fff;">
        </div>
        <div id="gif-results" style="flex-grow:1;overflow-y:auto;padding:4px 8px 8px;
             display:grid;grid-template-columns:1fr 1fr;gap:4px;"></div>
        <div style="padding:4px 8px 6px;flex-shrink:0;text-align:right;">
            <span style="font-size:10px;color:var(--text-muted);">Powered by Tenor</span>
        </div>`;

    document.body.appendChild(popup);
    const searchInput = $("gif-search-input");
    searchInput.focus();

    // Load trending GIFs immediately
    fetchGifs("trending");

    searchInput.addEventListener("input", () => {
        clearTimeout(gifSearchTimer);
        const q = searchInput.value.trim();
        gifSearchTimer = setTimeout(() => fetchGifs(q || "trending"), 400);
    });

    setTimeout(() => {
        window.addEventListener("click", function closeGif(e) {
            if (!popup.contains(e.target) && e.target.id !== "gif-btn") {
                popup.remove();
                window.removeEventListener("click", closeGif);
            }
        });
    }, 50);
}

async function fetchGifs(query) {
    const results = $("gif-results");
    if (!results) return;
    results.innerHTML = `<div style="grid-column:1/-1;color:var(--text-muted);font-size:13px;
        text-align:center;padding:24px 0;">Loading…</div>`;

    try {
        const isTrending = query === "trending";
        const url = isTrending
            ? `https://tenor.googleapis.com/v2/featured?key=${TENOR_KEY}&limit=${GIF_LIMIT}&media_filter=gif`
            : `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${TENOR_KEY}&limit=${GIF_LIMIT}&media_filter=gif`;

        const res  = await fetch(url);
        const data = await res.json();

        if (!data.results?.length) {
            results.innerHTML = `<div style="grid-column:1/-1;color:var(--text-muted);font-size:13px;
                text-align:center;padding:24px 0;">No GIFs found.</div>`;
            return;
        }

        results.innerHTML = "";
        data.results.forEach(item => {
            const gifUrl = item.media_formats?.tinygif?.url || item.media_formats?.gif?.url;
            if (!gifUrl) return;
            const img = document.createElement("img");
            img.src   = gifUrl;
            img.title = item.content_description || "";
            Object.assign(img.style, {
                width: "100%", borderRadius: "4px", cursor: "pointer",
                objectFit: "cover", maxHeight: "110px", transition: "opacity .1s",
            });
            img.onmouseenter = () => img.style.opacity = ".8";
            img.onmouseleave = () => img.style.opacity = "1";
            img.onclick = () => {
                // Send the full GIF url (not tiny)
                const fullUrl = item.media_formats?.gif?.url || gifUrl;
                sendGif(fullUrl);
            };
            results.appendChild(img);
        });
    } catch (err) {
        results.innerHTML = `<div style="grid-column:1/-1;color:var(--red);font-size:13px;
            text-align:center;padding:24px 0;">
            Failed to load GIFs.<br>
            <span style="font-size:11px;color:var(--text-muted);">Check your Tenor API key.</span>
        </div>`;
    }
}

function sendGif(url) {
    $("gif-picker-popup")?.remove();
    const payload = {
        sender:    myUsername,
        content:   "",
        imageUrl:  url,
        timestamp: firebase.database.ServerValue.TIMESTAMP,
    };
    if (replyTo) payload.replyingTo = { ...replyTo };
    db.ref(currentChatPath).push(payload);
    cancelReply();
}

// ================================================================
// 18. FILE / IMAGE UPLOAD  (Firebase Storage)
// Add firebase-storage-compat.js to index.html scripts, then
// set Storage rules to allow authenticated users to write uploads/
// ================================================================
function triggerFileUpload() {
    $("file-input")?.click();
}

async function handleFileSelected(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;

    const MAX_MB = 8;
    if (file.size > MAX_MB * 1024 * 1024) {
        showToast(`File too large. Max ${MAX_MB} MB.`);
        return;
    }

    const ext  = file.name.split(".").pop().toLowerCase();
    const path = `uploads/${myUsername}_${Date.now()}.${ext}`;

    showToast("Uploading…");

    try {
        const snap = await storage.ref(path).put(file);
        const url  = await snap.ref.getDownloadURL();
        const isImage = file.type.startsWith("image/");

        const payload = {
            sender:    myUsername,
            timestamp: firebase.database.ServerValue.TIMESTAMP,
        };
        if (isImage) {
            payload.content  = "";
            payload.imageUrl = url;
        } else {
            payload.content = file.name;
            payload.fileUrl = url;
        }
        if (replyTo) payload.replyingTo = { ...replyTo };

        db.ref(currentChatPath).push(payload);
        cancelReply();
        showToast("Uploaded!");
    } catch (err) {
        console.error("Upload error:", err);
        showToast("Upload failed. Check Firebase Storage rules.");
    }
}

// ================================================================
// 19. TYPING INDICATOR
// ================================================================
function handleTypingInput() {
    if (!isTyping) {
        isTyping = true;
        db.ref(`typing/${currentChatPath.replace(/\//g, "_")}/${myUsername}`).set(true);
    }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(clearTyping, TYPING_TIMEOUT);
}

function clearTyping() {
    if (!isTyping) return;
    isTyping = false;
    clearTimeout(typingTimer);
    db.ref(`typing/${currentChatPath.replace(/\//g, "_")}/${myUsername}`).remove();
}

function listenTyping(path) {
    const key = path.replace(/\//g, "_");
    if (typingListenerKey) db.ref(`typing/${typingListenerKey}`).off("value");
    typingListenerKey = key;

    db.ref(`typing/${key}`).on("value", snap => {
        const typers = [];
        snap.forEach(c => { if (c.key !== myUsername) typers.push(c.key); });
        const ind = UI.typingIndicator();
        if (!typers.length) { ind.innerHTML = ""; return; }
        const names = typers.length === 1
            ? `${escHtml(typers[0])} is typing…`
            : typers.length === 2
                ? `${escHtml(typers[0])} and ${escHtml(typers[1])} are typing…`
                : "Several people are typing…";
        ind.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div><span>${names}</span>`;
    });
}

// ================================================================
// 20. MEMBERS PANEL
// ================================================================
function toggleMembers() {
    membersOpen = !membersOpen;
    UI.membersPanel().classList.toggle("open", membersOpen);
}

// ================================================================
// 21. STEALTH — ESCAPE
// ================================================================
window.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (UI.contextMenu().classList.contains("visible")) { hideMenu(); return; }
    if ($("gif-picker-popup"))   { $("gif-picker-popup").remove();   return; }
    if ($("emoji-picker-popup")) { $("emoji-picker-popup").remove(); return; }
    if (replyTo)                 { cancelReply(); return; }
    stealth();
});

function stealth() {
    clearTyping();
    UI.appUI().classList.remove("visible");
    UI.mathCover().style.display = "block";
}

// ================================================================
// 22. UNREAD BADGES
// ================================================================
function showBadge(ch) { $(`badge-${ch}`)?.classList.add("show"); }
function hideBadge(ch) { $(`badge-${ch}`)?.classList.remove("show"); }

// ================================================================
// 23. EMOJI PICKER
// ================================================================
const QUICK_EMOJIS = ["😂","🔥","👍","❤️","😭","💀","✅","🙏","😊","🤔","👀","🎉"];

function openEmojiPicker() {
    const existing = $("emoji-picker-popup");
    if (existing) { existing.remove(); return; }

    const popup = document.createElement("div");
    popup.id    = "emoji-picker-popup";
    Object.assign(popup.style, {
        position:     "fixed",
        bottom:       "76px",
        right:        "116px",
        background:   "var(--bg-darkest)",
        border:       "1px solid var(--bg-mid)",
        borderRadius: "8px",
        padding:      "10px",
        display:      "flex",
        flexWrap:     "wrap",
        gap:          "4px",
        width:        "192px",
        boxShadow:    "var(--shadow-lg)",
        zIndex:       "15000",
        animation:    "slideUp .15s ease",
    });

    QUICK_EMOJIS.forEach(em => {
        const btn = document.createElement("span");
        btn.textContent  = em;
        Object.assign(btn.style, { fontSize:"22px", cursor:"pointer", padding:"4px", borderRadius:"4px", transition:"background .1s" });
        btn.onmouseenter = () => btn.style.background = "var(--bg-hover)";
        btn.onmouseleave = () => btn.style.background = "transparent";
        btn.onclick      = () => { UI.consoleInput().value += em; UI.consoleInput().focus(); popup.remove(); };
        popup.appendChild(btn);
    });

    document.body.appendChild(popup);
    setTimeout(() => {
        window.addEventListener("click", function close(e) {
            if (!popup.contains(e.target)) { popup.remove(); window.removeEventListener("click", close); }
        });
    }, 50);
}

// ================================================================
// 24. TOAST
// ================================================================
let toastTimer = null;
function showToast(msg, duration = 2800) {
    const t = UI.toast();
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), duration);
}

// ================================================================
// 25. UTILITIES
// ================================================================
function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function escAttr(str) {
    // Safe for data-* attributes (double-quote delimited)
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/\n/g, " ")
        .replace(/\r/g, "");
}

function linkify(text) {
    return text.replace(
        /(https?:\/\/[^\s<>"']+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
}

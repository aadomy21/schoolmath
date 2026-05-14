/**
 * SCHOOL — app.js
 * Full engine: Auth, Messaging, DMs, Reactions, Typing, Members, Stealth
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
const db   = firebase.database();
const auth = firebase.auth();

// ================================================================
// 2. CONSTANTS & STATE
// ================================================================
const ADMIN          = "aadomy21";
const MAX_REACTIONS  = 12;
const TYPING_TIMEOUT = 3000;   // ms before typing indicator clears
const MSG_LIMIT      = 60;     // messages loaded per channel

let myUsername      = "";
let currentChatPath = "channels/general";
let currentChatName = "general";
let currentChatType = "channel";   // "channel" | "dm"
let currentListener = null;        // path string of the active .on() listener
let replyTo         = null;        // { id, sender, content }
let activeMsgId     = null;
let activeMsgData   = null;        // { sender, content } of right-clicked message
let typingTimer     = null;
let isTyping        = false;
let membersOpen     = false;
let typingListenerKey = null;      // key for the active typing listener

// Per-path last-seen timestamps (for unread logic)
const lastSeen = {};

// ================================================================
// 3. DOM SHORTCUTS
// ================================================================
const $  = id => document.getElementById(id);

const UI = {
    mathCover:      () => $("math-cover"),
    loginOverlay:   () => $("login-overlay"),
    appUI:          () => $("app-ui"),
    loginEmail:     () => $("li-email"),
    loginPass:      () => $("li-pass"),
    loginBtn:       () => $("li-btn"),
    loginErr:       () => $("login-err"),
    msgContainer:   () => $("message-container"),
    consoleInput:   () => $("console-input"),
    chatTitle:      () => $("chat-title"),
    chatTopic:      () => $("chat-topic"),
    myName:         () => $("my-name-display"),
    statusText:     () => $("status-text"),
    userAvatar:     () => $("user-avatar"),
    dmList:         () => $("dm-list"),
    membersList:    () => $("members-list"),
    onlineCount:    () => $("online-count"),
    membersPanel:   () => $("members-panel"),
    replyBanner:    () => $("reply-banner"),
    replyNameLabel: () => $("reply-name-label"),
    typingIndicator:() => $("typing-indicator"),
    contextMenu:    () => $("context-menu"),
    menuDelete:     () => $("menu-delete"),
    menuReply:      () => $("menu-reply"),
    toast:          () => $("toast"),
    chatHeader:     () => $("chat-header"),
    chatHeaderPrefix: () => $("chat-header").querySelector(".ch-prefix"),
};

// ================================================================
// 4. LOGIN & AUTH
// ================================================================
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
    const pass  = UI.loginPass().value;

    if (!email || !pass) {
        showLoginError("Please fill in both fields.");
        return;
    }

    const btn = UI.loginBtn();
    btn.disabled   = true;
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
            if (err.code === "auth/too-many-requests")
                msg = "Too many attempts. Try again later.";
            if (err.code === "auth/invalid-email")
                msg = "Invalid email format.";
            showLoginError(msg);
            btn.disabled    = false;
            btn.textContent = "Log In";
        });
}

function showLoginError(msg) {
    UI.loginErr().textContent = msg;
}

// ================================================================
// 5. APP REVEAL
// ================================================================
function revealApp() {
    UI.mathCover().style.display = "none";
    UI.appUI().classList.add("visible");

    // User panel
    UI.myName().textContent     = myUsername;
    UI.statusText().textContent = "Online";
    UI.statusText().style.color = "var(--green)";

    const av = UI.userAvatar();
    av.textContent = myUsername[0].toUpperCase();
    if (myUsername === ADMIN) av.style.background = "#e91e63";

    registerPresence();
    syncUserList();
    switchChat("general", "channel");
}

// ================================================================
// 6. PRESENCE / USER LIST
// ================================================================
function registerPresence() {
    const ref = db.ref(`system/users/${myUsername}`);
    ref.set({ online: true, ts: firebase.database.ServerValue.TIMESTAMP });
    ref.onDisconnect().update({ online: false, ts: firebase.database.ServerValue.TIMESTAMP });
    setInterval(() => ref.update({ online: true, ts: firebase.database.ServerValue.TIMESTAMP }), 30000);
}

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

            // ---- DM sidebar entry (skip self) ----
            if (name !== myUsername) {
                const item = document.createElement("div");
                item.className = "dm-item";
                item.id        = `dm-item-${name}`;
                if (!online) item.style.opacity = ".5";
                item.innerHTML = `
                    <div class="dm-avatar" style="${name === ADMIN ? "background:#e91e63;" : ""}">
                        ${name[0].toUpperCase()}
                    </div>
                    <span>${escHtml(name)}</span>
                `;
                item.onclick = () => switchChat(name, "dm");
                UI.dmList().appendChild(item);
            }

            // ---- Members panel entry ----
            const mItem = document.createElement("div");
            mItem.className = `member-item${online ? "" : " offline"}`;
            if (!online) mItem.style.opacity = ".45";
            mItem.innerHTML = `
                <div class="member-av${name === ADMIN ? " admin-color" : ""}">
                    ${name[0].toUpperCase()}
                </div>
                <span class="member-name${name === ADMIN ? " admin-name" : ""}">
                    ${escHtml(name)}${name === ADMIN ? ' <span class="role-badge admin">ADMIN</span>' : ""}
                </span>
            `;
            UI.membersList().appendChild(mItem);
        });

        UI.onlineCount().textContent = onlineCount;
    });
}

// ================================================================
// 7. CHAT NAVIGATION
// ================================================================
function channelTopic(ch) {
    const topics = {
        general:  "General chat — keep it cool",
        random:   "Anything goes",
        homework: "Homework help — share resources",
    };
    return topics[ch] || "";
}

function switchChat(target, type) {
    currentChatType = type;
    currentChatName = target;

    // Sidebar highlights
    document.querySelectorAll(".channel-link").forEach(el => el.classList.remove("active"));
    document.querySelectorAll(".dm-item").forEach(el => el.classList.remove("active"));

    if (type === "channel") {
        currentChatPath = `channels/${target}`;
        UI.chatTitle().textContent   = target;
        UI.chatTopic().textContent   = channelTopic(target);
        UI.consoleInput().placeholder = `Message #${target}`;
        const chEl = $(`ch-${target}`);
        if (chEl) chEl.classList.add("active");

        // Update header hash/@ prefix
        const pfx = UI.chatHeader().querySelector(".ch-prefix");
        if (pfx) pfx.textContent = "#";
    } else {
        const sorted    = [myUsername, target].sort().join("_");
        currentChatPath = `dms/${sorted}`;
        UI.chatTitle().textContent    = `@${target}`;
        UI.chatTopic().textContent    = `Direct Message with ${target}`;
        UI.consoleInput().placeholder = `Message @${target}`;
        const dmEl = $(`dm-item-${target}`);
        if (dmEl) dmEl.classList.add("active");

        const pfx = UI.chatHeader().querySelector(".ch-prefix");
        if (pfx) pfx.textContent = "@";
    }

    cancelReply();
    listenForMessages(currentChatPath);
    listenTyping(currentChatPath);

    lastSeen[currentChatPath] = Date.now();
    hideBadge(target);
}

// ================================================================
// 8. MESSAGE LISTENER & RENDERER
// ================================================================
function listenForMessages(path) {
    // Detach previous listener
    if (currentListener) {
        db.ref(currentListener).off("value");
    }
    currentListener = path;

    UI.msgContainer().innerHTML = "";
    renderWelcomeBanner();

    db.ref(path).limitToLast(MSG_LIMIT).on("value", snap => {
        UI.msgContainer().innerHTML = "";
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

        UI.msgContainer().scrollTop = UI.msgContainer().scrollHeight;
    });
}

function renderWelcomeBanner() {
    const banner = document.createElement("div");
    banner.className = "welcome-banner";

    const isChannel = currentChatType === "channel";
    const icon  = isChannel ? "#" : (currentChatName[0] || "?").toUpperCase();
    const title = isChannel
        ? `Welcome to #${currentChatName}!`
        : `Your DM with ${currentChatName}`;
    const sub   = isChannel
        ? `This is the beginning of #${currentChatName}. ${channelTopic(currentChatName)}`
        : `This is the beginning of your direct message history with ${escHtml(currentChatName)}.`;

    banner.innerHTML = `
        <div class="wb-icon">${icon}</div>
        <h2>${escHtml(title)}</h2>
        <p>${sub}</p>
    `;
    UI.msgContainer().appendChild(banner);
}

function renderDayDivider(ts) {
    const div   = document.createElement("div");
    div.className = "day-divider";
    const d     = new Date(ts);
    const today = new Date();
    const yest  = new Date(); yest.setDate(today.getDate() - 1);

    let label;
    if (d.toDateString() === today.toDateString())     label = "Today";
    else if (d.toDateString() === yest.toDateString()) label = "Yesterday";
    else label = d.toLocaleDateString([], { weekday:"long", month:"long", day:"numeric", year:"numeric" });

    div.innerHTML = `<span>${label}</span>`;
    UI.msgContainer().appendChild(div);
}

function renderMessage(msgId, data, isGroupStart) {
    const wrap = document.createElement("div");
    wrap.className = `msg-wrap${isGroupStart ? " group-start" : ""}`;
    wrap.setAttribute("data-id",      msgId);
    wrap.setAttribute("data-sender",  data.sender || "");
    wrap.setAttribute("data-content", data.content || "");

    const isAdmin   = data.sender === ADMIN;
    const isOwn     = data.sender === myUsername;
    const canDelete = isOwn || myUsername === ADMIN;

    // Timestamp
    const ts      = new Date(data.timestamp);
    const timeStr = ts.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
    const fullTs  = ts.toLocaleString([], { dateStyle:"medium", timeStyle:"short" });

    // Reactions HTML
    let reactionsHTML = "";
    if (data.reactions) {
        const pairs = Object.entries(data.reactions).filter(([, users]) => Object.keys(users).length > 0);
        if (pairs.length) {
            reactionsHTML = `<div class="reactions-row">`;
            pairs.forEach(([emoji, users]) => {
                const count  = Object.keys(users).length;
                const isMine = !!users[myUsername];
                reactionsHTML += `
                    <div class="reaction-bubble${isMine ? " mine" : ""}"
                         onclick="addReaction('${escAttr(msgId)}','${escAttr(emoji)}')"
                         title="${escAttr(Object.keys(users).join(", "))}">
                        ${emoji} <span class="r-count">${count}</span>
                    </div>`;
            });
            reactionsHTML += `</div>`;
        }
    }

    // Reply preview HTML
    let replyHTML = "";
    if (data.replyingTo) {
        const rSndr = escHtml(data.replyingTo.sender || "");
        const rText = escHtml((data.replyingTo.content || "").substring(0, 60));
        const rId   = escAttr(data.replyingTo.id || "");
        replyHTML = `
            <div class="reply-preview" onclick="scrollToMsg('${rId}')">
                <div class="reply-avatar">${(data.replyingTo.sender || "?")[0].toUpperCase()}</div>
                <span class="reply-name">${rSndr}</span>
                <span class="reply-text">${rText}${(data.replyingTo.content || "").length > 60 ? "…" : ""}</span>
            </div>`;
    }

    // Content — auto-linkify
    const contentHTML = linkify(escHtml(data.content || ""));

    // Delete button
    const deleteBtn = canDelete
        ? `<div class="action-btn delete" title="Delete" onclick="deleteMessage('${escAttr(msgId)}')">
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
                ? `<div class="msg-avatar${isAdmin ? " admin-color" : ""}" title="${escAttr(data.sender)}">
                       ${(data.sender || "?")[0].toUpperCase()}
                   </div>`
                : `<span class="msg-compact-ts">${timeStr}</span>`
            }
        </div>
        <div class="msg-body">
            ${isGroupStart
                ? `<div class="msg-meta">
                       <span class="msg-sender${isAdmin ? " admin-name" : ""}"
                             title="${escAttr(data.sender)}">
                           ${escHtml(data.sender || "")}${isAdmin ? ' <span class="role-badge admin">ADMIN</span>' : ""}
                       </span>
                       <span class="msg-time" title="${escAttr(fullTs)}">${timeStr}</span>
                   </div>`
                : ""
            }
            <div class="msg-content">${contentHTML}</div>
            ${reactionsHTML}
        </div>
        <div class="msg-actions">
            <div class="action-btn" title="React" onclick="openQuickReact('${escAttr(msgId)}')">😊</div>
            <div class="action-btn" title="Reply"
                 onclick="setReply('${escAttr(msgId)}','${escAttr(data.sender || "")}','${escAttr(data.content || "")}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 17 4 12 9 7"/>
                    <path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
                </svg>
            </div>
            ${deleteBtn}
        </div>
    `;

    UI.msgContainer().appendChild(wrap);
}

// ================================================================
// 9. SEND MESSAGE
// ================================================================
document.addEventListener("DOMContentLoaded", () => {
    const input = $("console-input");
    if (!input) return;

    input.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    input.addEventListener("input", handleTypingInput);
});

function sendMessage() {
    const input = UI.consoleInput();
    const val   = input.value.trim();
    if (!val) return;

    const payload = {
        sender:    myUsername,
        content:   val,
        timestamp: firebase.database.ServerValue.TIMESTAMP,
    };
    if (replyTo) payload.replyingTo = replyTo;

    db.ref(currentChatPath).push(payload);

    input.value = "";
    cancelReply();
    clearTyping();
}

// ================================================================
// 10. REPLY SYSTEM
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
    UI.consoleInput().placeholder = currentChatType === "channel"
        ? `Message #${currentChatName}`
        : `Message @${currentChatName}`;
}

function scrollToMsg(msgId) {
    if (!msgId) return;
    const el = document.querySelector(`[data-id="${msgId}"]`);
    if (el) {
        el.scrollIntoView({ behavior:"smooth", block:"center" });
        el.style.background = "#3d4269";
        setTimeout(() => (el.style.background = ""), 1500);
    }
}

// ================================================================
// 11. DELETE MESSAGE
// ================================================================
function deleteMessage(msgId) {
    if (!confirm("Delete this message?")) return;
    db.ref(`${currentChatPath}/${msgId}`).remove();
    hideMenu();
}

// ================================================================
// 12. REACTION ENGINE
// ================================================================
function addReaction(msgId, emoji) {
    const msgRef  = db.ref(`${currentChatPath}/${msgId}/reactions`);
    const userRef = db.ref(`${currentChatPath}/${msgId}/reactions/${emoji}/${myUsername}`);

    msgRef.once("value", snap => {
        const all      = snap.val() || {};
        const hasEmoji = !!all[emoji];
        const hasMine  = hasEmoji && !!all[emoji][myUsername];

        if (hasMine) {
            // Toggle off
            userRef.remove();
        } else {
            const uniqueCount = Object.keys(all).length;
            if (!hasEmoji && uniqueCount >= MAX_REACTIONS) {
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
    // Small delay so the menu finishes hiding before the prompt appears
    setTimeout(() => {
        const custom = prompt("Enter an emoji:");
        if (custom && custom.trim()) {
            addReaction(mId, custom.trim().substring(0, 8));
        }
    }, 120);
}

function openQuickReact(msgId) {
    activeMsgId  = msgId;
    activeMsgData = null;

    // Position menu near the action button of that message
    const el = document.querySelector(`[data-id="${msgId}"] .msg-actions`);
    if (el) {
        const r = el.getBoundingClientRect();
        showContextMenu(r.left, r.bottom + 4);
    }
}

// ================================================================
// 13. CONTEXT MENU
// ================================================================
window.addEventListener("contextmenu", e => {
    const msgEl = e.target.closest(".msg-wrap");
    if (!msgEl) { hideMenu(); return; }
    e.preventDefault();

    activeMsgId   = msgEl.getAttribute("data-id");
    activeMsgData = {
        sender:  msgEl.getAttribute("data-sender"),
        content: msgEl.getAttribute("data-content"),
    };

    const canDelete = activeMsgData.sender === myUsername || myUsername === ADMIN;
    UI.menuDelete().style.display = canDelete ? "flex" : "none";

    showContextMenu(e.clientX, e.clientY);
});

window.addEventListener("click", e => {
    if (!e.target.closest("#context-menu")) hideMenu();
});

function showContextMenu(x, y) {
    const menu = UI.contextMenu();
    menu.classList.add("visible");

    // Clamp to viewport so it never bleeds off-screen
    const mw = 196, mh = 260;
    const vw = window.innerWidth, vh = window.innerHeight;
    menu.style.left = `${Math.min(x, vw - mw - 8)}px`;
    menu.style.top  = `${Math.min(y, vh - mh - 8)}px`;
}

function hideMenu() {
    UI.contextMenu().classList.remove("visible");
}

// Wire static context-menu buttons
document.addEventListener("DOMContentLoaded", () => {
    $("menu-reply")?.addEventListener("click", () => {
        if (!activeMsgId || !activeMsgData) return;
        setReply(activeMsgId, activeMsgData.sender, activeMsgData.content);
    });

    $("menu-delete")?.addEventListener("click", () => {
        if (activeMsgId) deleteMessage(activeMsgId);
    });
});

function copyMessageText() {
    if (!activeMsgData?.content) return;
    navigator.clipboard.writeText(activeMsgData.content)
        .then(()  => showToast("Message copied."))
        .catch(()  => showToast("Copy failed."));
    hideMenu();
}

function copyMsgId() {
    if (!activeMsgId) return;
    navigator.clipboard.writeText(activeMsgId)
        .then(()  => showToast("Message ID copied."))
        .catch(()  => showToast("Copy failed."));
    hideMenu();
}

// ================================================================
// 14. TYPING INDICATOR
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

    // Detach previous typing listener
    if (typingListenerKey) {
        db.ref(`typing/${typingListenerKey}`).off("value");
    }
    typingListenerKey = key;

    db.ref(`typing/${key}`).on("value", snap => {
        const typers = [];
        snap.forEach(c => { if (c.key !== myUsername) typers.push(c.key); });

        const indicator = UI.typingIndicator();
        if (!typers.length) {
            indicator.innerHTML = "";
            return;
        }

        let names;
        if (typers.length === 1)      names = `${escHtml(typers[0])} is typing…`;
        else if (typers.length === 2) names = `${escHtml(typers[0])} and ${escHtml(typers[1])} are typing…`;
        else                           names = "Several people are typing…";

        indicator.innerHTML = `
            <div class="typing-dots">
                <span></span><span></span><span></span>
            </div>
            <span>${names}</span>`;
    });
}

// ================================================================
// 15. MEMBERS PANEL TOGGLE
// ================================================================
function toggleMembers() {
    membersOpen = !membersOpen;
    UI.membersPanel().classList.toggle("open", membersOpen);
}

// ================================================================
// 16. STEALTH — ESCAPE KEY
// ================================================================
window.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;

    // Priority 1: close context menu
    if (UI.contextMenu().classList.contains("visible")) {
        hideMenu();
        return;
    }
    // Priority 2: cancel reply
    if (replyTo) {
        cancelReply();
        return;
    }
    // Priority 3: full stealth
    stealth();
});

function stealth() {
    clearTyping();
    UI.appUI().classList.remove("visible");
    UI.mathCover().style.display = "block";
}

// ================================================================
// 17. UNREAD BADGES
// ================================================================
function showBadge(channelName) {
    const badge = $(`badge-${channelName}`);
    if (badge) badge.classList.add("show");
}
function hideBadge(channelName) {
    const badge = $(`badge-${channelName}`);
    if (badge) badge.classList.remove("show");
}

// ================================================================
// 18. EMOJI PICKER (inline popup)
// ================================================================
const QUICK_EMOJIS = ["😂","🔥","👍","❤️","😭","💀","✅","🙏","😊","🤔","👀","🎉"];

function openEmojiPicker() {
    const existingPicker = $("emoji-picker-popup");
    if (existingPicker) { existingPicker.remove(); return; }

    const popup = document.createElement("div");
    popup.id = "emoji-picker-popup";
    Object.assign(popup.style, {
        position:     "fixed",
        bottom:       "76px",
        right:        "80px",
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
        btn.textContent = em;
        Object.assign(btn.style, {
            fontSize:     "22px",
            cursor:       "pointer",
            padding:      "4px",
            borderRadius: "4px",
            transition:   "background .1s",
        });
        btn.onmouseenter = () => btn.style.background = "var(--bg-hover)";
        btn.onmouseleave = () => btn.style.background = "transparent";
        btn.onclick = () => {
            UI.consoleInput().value += em;
            UI.consoleInput().focus();
            popup.remove();
        };
        popup.appendChild(btn);
    });

    document.body.appendChild(popup);

    // Close on any outside click
    setTimeout(() => {
        window.addEventListener("click", function closePicker(e) {
            if (!popup.contains(e.target)) {
                popup.remove();
                window.removeEventListener("click", closePicker);
            }
        });
    }, 50);
}

// ================================================================
// 19. TOAST
// ================================================================
let toastTimer = null;
function showToast(msg, duration = 2800) {
    const toast = UI.toast();
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), duration);
}

// ================================================================
// 20. UTILITIES
// ================================================================
function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function escAttr(str) {
    // Safe for inline onclick="..." attributes
    return String(str)
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/"/g, "&quot;")
        .replace(/\n/g, " ")
        .replace(/\r/g, "");
}

function linkify(text) {
    return text.replace(
        /(https?:\/\/[^\s<>"']+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
}

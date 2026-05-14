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
const ADMIN        = "aadomy21";
const MAX_REACTIONS = 12;
const TYPING_TIMEOUT = 3000;   // ms before typing indicator clears
const MSG_LIMIT      = 60;     // messages loaded per channel

let myUsername       = "";
let currentChatPath  = "channels/general";
let currentChatName  = "general";
let currentChatType  = "channel";  // "channel" | "dm"
let currentListener  = null;
let replyTo          = null;
let activeMsgId      = null;
let activeMsgData    = null;   // full data of right-clicked message
let typingTimer      = null;
let isTyping         = false;
let membersOpen      = false;

// Cache of last-seen message timestamps per path (for unread badges)
const lastSeen = {};

// ================================================================
// 3. DOM SHORTCUTS
// ================================================================
const $ = id => document.getElementById(id);

const UI = {
    mathCover:     $("math-cover"),
    loginOverlay:  $("login-overlay"),
    appUI:         $("app-ui"),
    loginEmail:    $("li-email"),
    loginPass:     $("li-pass"),
    loginBtn:      $("li-btn"),
    loginErr:      $("login-err"),
    msgContainer:  $("message-container"),
    consoleInput:  $("console-input"),
    chatTitle:     $("chat-title"),
    chatTopic:     $("chat-topic"),
    myName:        $("my-name-display"),
    statusText:    $("status-text"),
    userAvatar:    $("user-avatar"),
    dmList:        $("dm-list"),
    membersList:   $("members-list"),
    onlineCount:   $("online-count"),
    membersPanel:  $("members-panel"),
    replyBanner:   $("reply-banner"),
    replyNameLabel:$("reply-name-label"),
    typingIndicator:$("typing-indicator"),
    contextMenu:   $("context-menu"),
    menuDelete:    $("menu-delete"),
    menuReply:     $("menu-reply"),
    toast:         $("toast"),
};

// ================================================================
// 4. LOGIN & AUTH
// ================================================================
window.onload = () => {
    // Show login overlay on top of the math mask
    UI.loginOverlay.classList.add("active");

    // Allow pressing Enter in the password field to submit
    UI.loginPass.addEventListener("keydown", e => {
        if (e.key === "Enter") handleLogin();
    });
    UI.loginEmail.addEventListener("keydown", e => {
        if (e.key === "Enter") UI.loginPass.focus();
    });
};

function handleLogin() {
    const email = UI.loginEmail.value.trim();
    const pass  = UI.loginPass.value;

    if (!email || !pass) {
        showLoginError("Please fill in both fields.");
        return;
    }

    UI.loginBtn.disabled   = true;
    UI.loginBtn.textContent = "Logging in…";
    UI.loginErr.textContent = "";

    auth.signInWithEmailAndPassword(email, pass)
        .then(cred => {
            myUsername = email.split("@")[0].toLowerCase();
            UI.loginOverlay.classList.remove("active");
            revealApp();
        })
        .catch(err => {
            let msg = "Incorrect ID or access key.";
            if (err.code === "auth/too-many-requests")
                msg = "Too many attempts. Try again later.";
            showLoginError(msg);
            UI.loginBtn.disabled    = false;
            UI.loginBtn.textContent = "Log In";
        });
}

function showLoginError(msg) {
    UI.loginErr.textContent = msg;
}

// ================================================================
// 5. APP REVEAL
// ================================================================
function revealApp() {
    UI.mathCover.style.display = "none";
    UI.appUI.classList.add("visible");

    // User panel
    UI.myName.textContent      = myUsername;
    UI.statusText.textContent  = "Online";
    UI.statusText.style.color  = "var(--green)";
    UI.userAvatar.textContent  = myUsername[0].toUpperCase();
    if (myUsername === ADMIN) {
        UI.userAvatar.style.background = "#e91e63";
    }

    // Register presence
    registerPresence();

    // Load user list for DMs
    syncUserList();

    // Start in #general
    switchChat("general", "channel");
}

// ================================================================
// 6. PRESENCE / USER LIST
// ================================================================
function registerPresence() {
    const ref = db.ref(`system/users/${myUsername}`);
    ref.set({ online: true, ts: Date.now() });

    // Mark offline on disconnect
    ref.onDisconnect().update({ online: false, ts: Date.now() });

    // Keep alive ping every 30s
    setInterval(() => ref.update({ online: true, ts: Date.now() }), 30000);
}

function syncUserList() {
    db.ref("system/users").on("value", snap => {
        UI.dmList.innerHTML  = "";
        UI.membersList.innerHTML = "";
        let onlineCount = 0;

        snap.forEach(userSnap => {
            const name = userSnap.key;
            const data = userSnap.val() || {};
            const online = data.online === true;
            if (online) onlineCount++;

            // DM sidebar item
            if (name !== myUsername) {
                const item = document.createElement("div");
                item.className = "dm-item";
                item.id        = `dm-item-${name}`;
                item.innerHTML = `
                    <div class="dm-avatar" style="${name === ADMIN ? "background:#e91e63;" : ""}">
                        ${name[0].toUpperCase()}
                    </div>
                    <span style="${!online ? "opacity:.5;" : ""}">${name}</span>
                `;
                item.onclick = () => switchChat(name, "dm");
                UI.dmList.appendChild(item);
            }

            // Members panel item
            const mItem = document.createElement("div");
            mItem.className = "member-item";
            mItem.innerHTML = `
                <div class="member-av ${name === ADMIN ? "admin-color" : ""}">
                    ${name[0].toUpperCase()}
                </div>
                <span class="member-name ${name === ADMIN ? "admin-name" : ""}">
                    ${name}${name === ADMIN ? ' <span class="role-badge admin">ADMIN</span>' : ""}
                </span>
            `;
            if (!online) mItem.style.opacity = ".45";
            UI.membersList.appendChild(mItem);
        });

        UI.onlineCount.textContent = onlineCount;
    });
}

// ================================================================
// 7. CHAT NAVIGATION
// ================================================================
function switchChat(target, type) {
    currentChatType = type;
    currentChatName = target;

    // Sidebar active state
    document.querySelectorAll(".channel-link").forEach(el => el.classList.remove("active"));
    document.querySelectorAll(".dm-item").forEach(el => el.classList.remove("active"));

    if (type === "channel") {
        currentChatPath = `channels/${target}`;
        UI.chatTitle.textContent    = target;
        UI.chatTopic.textContent    = channelTopic(target);
        UI.consoleInput.placeholder = `Message #${target}`;
        const chEl = $(`ch-${target}`);
        if (chEl) chEl.classList.add("active");
    } else {
        const sorted    = [myUsername, target].sort().join("_");
        currentChatPath = `dms/${sorted}`;
        UI.chatTitle.textContent    = `@${target}`;
        UI.chatTopic.textContent    = `Direct Message with ${target}`;
        UI.consoleInput.placeholder = `Message @${target}`;
        const dmEl = $(`dm-item-${target}`);
        if (dmEl) dmEl.classList.add("active");
    }

    // Cancel reply when switching channels
    cancelReply();

    // Clear & reload messages
    listenForMessages(currentChatPath);

    // Track last-seen
    lastSeen[currentChatPath] = Date.now();
    hideBadge(target);
}

function channelTopic(ch) {
    const topics = {
        general:      "General chat — keep it cool",
        random:       "Anything goes",
        homework:     "Homework help — share resources",
    };
    return topics[ch] || "";
}

// ================================================================
// 8. MESSAGE LISTENER & RENDERER
// ================================================================
function listenForMessages(path) {
    // Detach previous listener
    if (currentListener) {
        db.ref(currentListener).off();
    }
    currentListener = path;

    UI.msgContainer.innerHTML = "";
    renderWelcomeBanner();

    let prevSender = null;
    let prevDate   = null;

    db.ref(path).limitToLast(MSG_LIMIT).on("value", snap => {
        UI.msgContainer.innerHTML = "";
        renderWelcomeBanner();

        prevSender = null;
        prevDate   = null;

        snap.forEach(child => {
            const data     = child.val();
            const msgDate  = new Date(data.timestamp).toDateString();
            const isGroup  = prevSender === data.sender && prevDate === msgDate;

            if (prevDate !== msgDate) {
                renderDayDivider(data.timestamp);
            }

            renderMessage(child.key, data, !isGroup);
            prevSender = data.sender;
            prevDate   = msgDate;
        });

        UI.msgContainer.scrollTop = UI.msgContainer.scrollHeight;
    });
}

function renderWelcomeBanner() {
    const banner = document.createElement("div");
    banner.className = "welcome-banner";

    const icon  = currentChatType === "channel" ? "#" : myUsername[0].toUpperCase();
    const title = currentChatType === "channel"
        ? `Welcome to #${currentChatName}!`
        : `Your DM with ${currentChatName}`;
    const sub   = currentChatType === "channel"
        ? `This is the beginning of #${currentChatName}. ${channelTopic(currentChatName)}`
        : `This is the beginning of your direct message history with ${currentChatName}.`;

    banner.innerHTML = `
        <div class="wb-icon">${icon}</div>
        <h2>${title}</h2>
        <p>${sub}</p>
    `;
    UI.msgContainer.appendChild(banner);
}

function renderDayDivider(ts) {
    const div  = document.createElement("div");
    div.className = "day-divider";
    const d    = new Date(ts);
    const today = new Date();
    const yest  = new Date(); yest.setDate(today.getDate() - 1);

    let label;
    if (d.toDateString() === today.toDateString())      label = "Today";
    else if (d.toDateString() === yest.toDateString())  label = "Yesterday";
    else label = d.toLocaleDateString([], { weekday:"long", month:"long", day:"numeric", year:"numeric" });

    div.innerHTML = `<span>${label}</span>`;
    UI.msgContainer.appendChild(div);
}

function renderMessage(msgId, data, isGroupStart) {
    const wrap = document.createElement("div");
    wrap.className = `msg-wrap${isGroupStart ? " group-start" : ""}`;
    wrap.setAttribute("data-id",     msgId);
    wrap.setAttribute("data-sender", data.sender);
    wrap.setAttribute("data-content", data.content || "");

    const isAdmin  = data.sender === ADMIN;
    const isOwn    = data.sender === myUsername;
    const canDelete = isOwn || myUsername === ADMIN;

    // --- Timestamp ---
    const ts  = new Date(data.timestamp);
    const timeStr = ts.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
    const fullTs  = ts.toLocaleString([], { dateStyle:"medium", timeStyle:"short" });

    // --- Reactions HTML ---
    let reactionsHTML = "";
    if (data.reactions) {
        reactionsHTML = `<div class="reactions-row">`;
        Object.entries(data.reactions).forEach(([emoji, users]) => {
            const count   = Object.keys(users).length;
            if (count < 1) return;
            const isMine  = !!users[myUsername];
            reactionsHTML += `
                <div class="reaction-bubble${isMine ? " mine" : ""}"
                     onclick="addReaction('${msgId}','${escAttr(emoji)}')"
                     title="${Object.keys(users).join(", ")}">
                    ${emoji} <span class="r-count">${count}</span>
                </div>`;
        });
        reactionsHTML += `</div>`;
    }

    // --- Reply preview HTML ---
    let replyHTML = "";
    if (data.replyingTo) {
        const rSndr  = escHtml(data.replyingTo.sender || "");
        const rText  = escHtml((data.replyingTo.content || "").substring(0, 60));
        replyHTML = `
            <div class="reply-preview" onclick="scrollToMsg('${data.replyingTo.id || ""}')">
                <div class="reply-preview-line"></div>
                <div class="reply-avatar">${rSndr[0]?.toUpperCase() || "?"}</div>
                <span class="reply-name">${rSndr}</span>
                <span class="reply-text">${rText}${(data.replyingTo.content || "").length > 60 ? "…" : ""}</span>
            </div>`;
    }

    // --- Content (auto-linkify) ---
    const contentHTML = linkify(escHtml(data.content || ""));

    // --- Hover action bar ---
    const deleteBtn = canDelete
        ? `<div class="action-btn delete" title="Delete" onclick="deleteMessage('${msgId}')">
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
                ? `<div class="msg-avatar${isAdmin ? " admin-color" : ""}"
                        title="${escAttr(data.sender)}">
                       ${data.sender[0].toUpperCase()}
                   </div>`
                : `<span class="msg-compact-ts">${timeStr}</span>`
            }
        </div>
        <div class="msg-body">
            ${isGroupStart
                ? `<div class="msg-meta">
                       <span class="msg-sender${isAdmin ? " admin-name" : ""}"
                             title="${escAttr(data.sender)}">
                           ${escHtml(data.sender)}${isAdmin ? ' <span class="role-badge admin">ADMIN</span>' : ""}
                       </span>
                       <span class="msg-time" title="${fullTs}">${timeStr}</span>
                   </div>`
                : ""
            }
            <div class="msg-content">${contentHTML}</div>
            ${reactionsHTML}
        </div>
        <div class="msg-actions">
            <div class="action-btn" title="React" onclick="openQuickReact('${msgId}')">😊</div>
            <div class="action-btn" title="Reply" onclick="setReply('${msgId}','${escAttr(data.sender)}','${escAttr(data.content || "")}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 17 4 12 9 7"/>
                    <path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
                </svg>
            </div>
            ${deleteBtn}
        </div>
    `;

    UI.msgContainer.appendChild(wrap);
}

// ================================================================
// 9. SEND MESSAGE
// ================================================================
UI.consoleInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

UI.consoleInput.addEventListener("input", handleTypingInput);

function sendMessage() {
    const val = UI.consoleInput.value.trim();
    if (!val) return;

    const payload = {
        sender:    myUsername,
        content:   val,
        timestamp: Date.now(),
    };
    if (replyTo) payload.replyingTo = replyTo;

    db.ref(currentChatPath).push(payload);

    UI.consoleInput.value = "";
    cancelReply();
    clearTyping();
}

// ================================================================
// 10. REPLY SYSTEM
// ================================================================
function setReply(msgId, sender, content) {
    replyTo = { id: msgId, sender, content };
    UI.replyBanner.classList.add("active");
    UI.replyNameLabel.textContent = sender;
    UI.consoleInput.placeholder   = `Reply to ${sender}…`;
    UI.consoleInput.focus();
    hideMenu();
}

function cancelReply() {
    replyTo = null;
    UI.replyBanner.classList.remove("active");
    UI.consoleInput.placeholder =
        currentChatType === "channel"
            ? `Message #${currentChatName}`
            : `Message @${currentChatName}`;
}

function scrollToMsg(msgId) {
    if (!msgId) return;
    const el = document.querySelector(`[data-id="${msgId}"]`);
    if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.background = "#3d4269";
        setTimeout(() => el.style.background = "", 1500);
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
    setTimeout(() => {
        const custom = prompt("Enter an emoji or short text:");
        if (custom && custom.trim()) {
            addReaction(mId, custom.trim().substring(0, 8));
        }
    }, 120);
}

function openQuickReact(msgId) {
    activeMsgId = msgId;
    // Show context menu anchored to the action button
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
    UI.menuDelete.style.display = canDelete ? "flex" : "none";

    showContextMenu(e.clientX, e.clientY);
});

window.addEventListener("click", e => {
    if (!e.target.closest("#context-menu")) hideMenu();
});

function showContextMenu(x, y) {
    const menu = UI.contextMenu;
    menu.classList.add("visible");

    // Clamp to viewport
    const mw = 196, mh = 260;
    const vw = window.innerWidth, vh = window.innerHeight;
    menu.style.left = `${Math.min(x, vw - mw - 8)}px`;
    menu.style.top  = `${Math.min(y, vh - mh - 8)}px`;
}

function hideMenu() {
    UI.contextMenu.classList.remove("visible");
}

// Wire up static menu buttons
UI.menuReply.addEventListener("click", () => {
    if (!activeMsgId || !activeMsgData) return;
    setReply(activeMsgId, activeMsgData.sender, activeMsgData.content);
});

UI.menuDelete.addEventListener("click", () => {
    if (activeMsgId) deleteMessage(activeMsgId);
});

function copyMessageText() {
    if (!activeMsgData?.content) return;
    navigator.clipboard.writeText(activeMsgData.content)
        .then(() => showToast("Message copied."))
        .catch(() => showToast("Copy failed."));
    hideMenu();
}

function copyMsgId() {
    if (!activeMsgId) return;
    navigator.clipboard.writeText(activeMsgId)
        .then(() => showToast("Message ID copied."))
        .catch(() => showToast("Copy failed."));
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
    isTyping = false;
    clearTimeout(typingTimer);
    db.ref(`typing/${currentChatPath.replace(/\//g, "_")}/${myUsername}`).remove();
}

// Listen for other people typing
let typingListener = null;
function listenTyping(path) {
    const key = path.replace(/\//g, "_");
    if (typingListener) db.ref(`typing/${typingListener}`).off();
    typingListener = key;

    db.ref(`typing/${key}`).on("value", snap => {
        const typers = [];
        snap.forEach(c => {
            if (c.key !== myUsername) typers.push(c.key);
        });

        if (typers.length === 0) {
            UI.typingIndicator.innerHTML = "";
        } else {
            const names = typers.length > 2
                ? "Several people are typing…"
                : typers.join(typers.length === 2 ? " and " : "") + (typers.length === 1 ? " is" : " are") + " typing…";

            UI.typingIndicator.innerHTML = `
                <div class="typing-dots">
                    <span></span><span></span><span></span>
                </div>
                <span>${escHtml(names)}</span>`;
        }
    });
}

// ================================================================
// 15. MEMBERS PANEL TOGGLE
// ================================================================
function toggleMembers() {
    membersOpen = !membersOpen;
    UI.membersPanel.classList.toggle("open", membersOpen);
}

// ================================================================
// 16. STEALTH — ESCAPE KEY
// ================================================================
window.addEventListener("keydown", e => {
    if (e.key === "Escape") {
        // If context menu open, just close it
        if (UI.contextMenu.classList.contains("visible")) {
            hideMenu();
            return;
        }
        // If reply active, cancel it
        if (replyTo) {
            cancelReply();
            return;
        }
        // Stealth: hide app, show worksheet
        stealth();
    }
});

function stealth() {
    clearTyping();
    UI.appUI.classList.remove("visible");
    UI.mathCover.style.display = "block";
}

// Double-click the math cover title to re-open (if user closed accidentally)
// They'd need to refresh instead — this is intentional for security.

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
// 18. EMOJI PICKER (Quick shortcut)
// ================================================================
const QUICK_EMOJIS = ["😂","🔥","👍","❤️","😭","💀","✅","🙏","😊","🤔","👀","🎉"];

function openEmojiPicker() {
    // Minimal inline picker — inserts emoji into input
    const existing = $("emoji-picker-popup");
    if (existing) { existing.remove(); return; }

    const popup = document.createElement("div");
    popup.id    = "emoji-picker-popup";
    Object.assign(popup.style, {
        position:   "fixed",
        bottom:     "76px",
        right:      "80px",
        background: "var(--bg-darkest)",
        border:     "1px solid var(--bg-mid)",
        borderRadius:"8px",
        padding:    "10px",
        display:    "flex",
        flexWrap:   "wrap",
        gap:        "4px",
        width:      "192px",
        boxShadow:  "var(--shadow-lg)",
        zIndex:     "15000",
        animation:  "slideUp .15s ease",
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
            UI.consoleInput.value += em;
            UI.consoleInput.focus();
            popup.remove();
        };
        popup.appendChild(btn);
    });

    document.body.appendChild(popup);

    // Close on outside click
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
    UI.toast.textContent = msg;
    UI.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => UI.toast.classList.remove("show"), duration);
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
    // Safe for use inside onclick="..." attribute strings
    return String(str)
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/"/g, "&quot;")
        .replace(/\n/g, " ");
}

function linkify(text) {
    // Turn raw URLs into clickable links
    return text.replace(
        /(https?:\/\/[^\s<>"']+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
}

// ================================================================
// 21. PATCH switchChat TO ALSO START TYPING LISTENER
// ================================================================
const _origSwitchChat = switchChat;
// We redefine switchChat to also bind the typing listener after path is set
function switchChat(target, type) {
    currentChatType = type;
    currentChatName = target;

    document.querySelectorAll(".channel-link").forEach(el => el.classList.remove("active"));
    document.querySelectorAll(".dm-item").forEach(el => el.classList.remove("active"));

    if (type === "channel") {
        currentChatPath = `channels/${target}`;
        UI.chatTitle.textContent    = target;
        UI.chatTopic.textContent    = channelTopic(target);
        UI.consoleInput.placeholder = `Message #${target}`;
        const chEl = $(`ch-${target}`);
        if (chEl) chEl.classList.add("active");
    } else {
        const sorted    = [myUsername, target].sort().join("_");
        currentChatPath = `dms/${sorted}`;
        UI.chatTitle.textContent    = `@${target}`;
        UI.chatTopic.textContent    = `Direct Message with ${target}`;
        UI.consoleInput.placeholder = `Message @${target}`;
        const dmEl = $(`dm-item-${target}`);
        if (dmEl) dmEl.classList.add("active");
    }

    cancelReply();
    listenForMessages(currentChatPath);
    listenTyping(currentChatPath);

    lastSeen[currentChatPath] = Date.now();
    hideBadge(target);
}

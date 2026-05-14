/**
 * SCHOOL HUB - FULL ENGINE
 * Features: Admin/Self Delete, Replies, Reactions, Real-time DM Routing
 */

// --- 1. FIREBASE CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyAaPbKLUV7S1gtKDyr-keBjS38nViPRMkw",
    authDomain: "schoolmathpart.firebaseapp.com",
    databaseURL: "https://schoolmathpart-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "schoolmathpart",
    storageBucket: "schoolmathpart.firebasestorage.app",
    messagingSenderId: "525859836367",
    appId: "1:525859836367:web:843e220ad112d5327e02ba"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

// --- 2. IDENTITY & STATE ---
const THE_ONLY_ADMIN = "aadomy21"; 
let myUsername = "";
let currentChatPath = "channels/general";
let currentListener = null;
let replyTo = null;

// --- 3. GATEKEEPER ---
function initiateLogin() {
    const id = prompt("Student Portal ID:");
    const key = prompt("Portal Access Key:");

    if (id && key) {
        auth.signInWithEmailAndPassword(id, key)
            .then(() => {
                myUsername = id.split('@')[0];
                revealApp();
            })
            .catch(() => { console.warn("Unauthorized."); });
    }
}

function revealApp() {
    const mask = document.getElementById('math-cover');
    const app = document.getElementById('app-ui');
    if (mask) mask.style.display = "none";
    if (app) app.style.setProperty('display', 'flex', 'important');

    document.getElementById('status-text').innerText = "ONLINE";
    document.getElementById('status-text').style.color = "#23a55a";

    syncUserList();
    listenForMessages("channels/general");
}

// --- 4. MESSAGE ACTIONS ---
function deleteMessage(msgId) {
    if (confirm("Delete this message?")) {
        db.ref(`${currentChatPath}/${msgId}`).remove();
    }
}

function setReply(sender, content, msgId) {
    replyTo = { sender, content, id: msgId };
    const input = document.getElementById('console-input');
    input.placeholder = `Replying to ${sender}...`;
    input.focus();
}

function addReaction(msgId, emoji) {
    const reactionRef = db.ref(`${currentChatPath}/${msgId}/reactions/${emoji}`);
    reactionRef.transaction((count) => (count || 0) + 1);
}

// --- 5. RENDERER & LISTENER ---
function listenForMessages(path) {
    const container = document.getElementById('message-container');
    if (currentListener) db.ref(currentChatPath).off();
    currentChatPath = path;

    // Listen for entire value to handle deletions/reactions instantly
    currentListener = db.ref(path).limitToLast(50).on('value', (snap) => {
        container.innerHTML = "";
        snap.forEach((child) => {
            renderMessage(child.key, child.val());
        });
        container.scrollTop = container.scrollHeight;
    });
}

function renderMessage(msgId, data) {
    const container = document.getElementById('message-container');
    const isMe = data.sender === myUsername;
    const isAdmin = myUsername === THE_ONLY_ADMIN;

    const div = document.createElement('div');
    div.className = "msg-wrap";

    // Build Reactions
    let reactionHTML = "";
    if (data.reactions) {
        Object.entries(data.reactions).forEach(([emoji, count]) => {
            reactionHTML += `<span style="background:#1E1F22; padding:2px 6px; border-radius:4px; font-size:11px; margin-right:4px; border: 1px solid #2B2D31;">${emoji} ${count}</span>`;
        });
    }

    // Build Reply Preview
    let replyHTML = data.replyingTo ? `<div class="reply-preview">⮑ ${data.replyingTo.sender}: ${data.replyingTo.content.substring(0, 40)}...</div>` : "";

    const time = new Date(data.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const isMedia = /(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))/i.test(data.content);
    
    let contentHTML = isMedia 
        ? `<img src="${data.content}" style="max-width: 100%; max-height: 350px; border-radius: 8px; margin-top: 5px; display: block;">`
        : `<div style="color: #dbdee1; font-size: 14px; white-space: pre-wrap;">${data.content}</div>`;

    div.innerHTML = `
        ${replyHTML}
        <div class="msg-actions">
            <span class="action-btn" onclick="setReply('${data.sender}', '${data.content.replace(/'/g, "\\'")}', '${msgId}')">Reply</span>
            <span class="action-btn" onclick="addReaction('${msgId}', '🔥')">🔥</span>
            <span class="action-btn" onclick="addReaction('${msgId}', '👍')">👍</span>
            ${(isMe || isAdmin) ? `<span class="action-btn" style="color:#f23f43;" onclick="deleteMessage('${msgId}')">Delete</span>` : ""}
        </div>
        <div style="display: flex; flex-direction: column; width: 100%;">
            <div style="display: flex; align-items: baseline; gap: 8px;">
                <span style="color: #5865F2; font-weight: bold; font-size: 14px;">${data.sender}</span>
                <span style="color: #949ba4; font-size: 10px;">${time}</span>
            </div>
            ${contentHTML}
            <div style="margin-top: 6px; display: flex; flex-wrap: wrap;">${reactionHTML}</div>
        </div>
    `;
    
    container.appendChild(div);
}

// --- 6. NAVIGATION & DMs ---
function switchChat(target, type) {
    let path = (type === 'channel') ? `channels/${target}` : `dms/${[myUsername, target].sort().join('_')}`;
    document.getElementById('chat-title').innerText = (type === 'channel' ? target : `@${target}`);
    listenForMessages(path);
}

function syncUserList() {
    db.ref('system/users').on('value', (snap) => {
        const list = document.getElementById('dm-list');
        list.innerHTML = "";
        snap.forEach(userSnap => {
            const name = userSnap.key;
            if (name !== myUsername) {
                const item = document.createElement('div');
                item.style.padding = "8px";
                item.style.cursor = "pointer";
                item.style.color = "#949ba4";
                item.innerText = `# ${name}`;
                item.onclick = () => switchChat(name, 'dm');
                list.appendChild(item);
            }
        });
    });
    db.ref(`system/users/${myUsername}`).set(true);
}

// --- 7. INPUT HANDLERS ---
const inputField = document.getElementById('console-input');
const charCounter = document.getElementById('char-count');

inputField.addEventListener('input', () => {
    const len = inputField.value.length;
    charCounter.innerText = `${len} / 2000`;
    charCounter.style.color = len >= 2000 ? "#f23f43" : "#949ba4";
});

inputField.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const val = inputField.value.trim();
        if (!val) return;

        db.ref(currentChatPath).push({
            sender: myUsername,
            content: val,
            timestamp: Date.now(),
            replyingTo: replyTo
        });
        
        inputField.value = "";
        replyTo = null;
        inputField.placeholder = `Message #${currentChatPath.split('/').pop()}`;
        charCounter.innerText = "0 / 2000";
    }
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.getElementById('app-ui').style.setProperty('display', 'none', 'important');
        document.getElementById('math-cover').style.display = "block";
    }
});

window.onload = initiateLogin;

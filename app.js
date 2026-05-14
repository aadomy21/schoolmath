/**
 * SCHOOL - INTEGRATED ENGINE
 * Features: Admin/Self Delete, Toggle Reactions (12-Limit), Custom Emojis, DMs, Stealth Escape
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
let activeMsgId = null; 

// --- 3. GATEKEEPER & REVEAL ---
function initiateLogin() {
    const id = prompt("Student Portal ID:");
    const key = prompt("Portal Access Key:");

    if (id && key) {
        auth.signInWithEmailAndPassword(id, key)
            .then(() => {
                myUsername = id.split('@')[0];
                revealApp();
            })
            .catch(() => { console.warn("Access Denied."); });
    }
}

function revealApp() {
    document.getElementById('math-cover').style.display = "none";
    document.getElementById('app-ui').style.setProperty('display', 'flex', 'important');
    document.getElementById('status-text').innerText = "ONLINE";
    document.getElementById('status-text').style.color = "#23a55a";

    syncUserList();
    listenForMessages("channels/general");
}

// --- 4. CONTEXT MENU LOGIC ---
window.addEventListener('contextmenu', (e) => {
    const msgElement = e.target.closest('.msg-wrap');
    if (msgElement) {
        e.preventDefault();
        activeMsgId = msgElement.getAttribute('data-id');
        const menu = document.getElementById('context-menu');
        menu.style.display = 'block';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;

        const isOwner = msgElement.getAttribute('data-sender') === myUsername;
        document.getElementById('menu-delete').style.display = (isOwner || myUsername === THE_ONLY_ADMIN) ? 'block' : 'none';
    } else {
        hideMenu();
    }
});

window.addEventListener('click', hideMenu);
function hideMenu() { document.getElementById('context-menu').style.display = 'none'; }

// --- 5. UPDATED REACTION ENGINE (Toggle + 12 Unique Limit) ---
function addReaction(msgId, emoji) {
    const msgRef = db.ref(`${currentChatPath}/${msgId}/reactions`);
    const userRef = db.ref(`${currentChatPath}/${msgId}/reactions/${emoji}/${myUsername}`);

    msgRef.once('value', (snap) => {
        const allReactions = snap.val() || {};
        const uniqueEmojis = Object.keys(allReactions);
        const hasReacted = allReactions[emoji] && allReactions[emoji][myUsername];

        if (hasReacted) {
            // UNREACT: Remove entry if user already clicked
            userRef.remove();
        } else {
            // REACT: Block if trying to add a 13th unique emoji
            if (!allReactions[emoji] && uniqueEmojis.length >= 12) {
                alert("Maximum 12 unique reactions reached for this message.");
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
    const mId = activeMsgId; // Keep reference after menu hides
    hideMenu();
    setTimeout(() => {
        const custom = prompt("Enter an emoji:");
        if (custom && custom.trim().length > 0) {
            addReaction(mId, custom.trim());
        }
    }, 100);
}

// --- 6. MESSAGE HANDLERS ---
function listenForMessages(path) {
    const container = document.getElementById('message-container');
    if (currentListener) db.ref(currentChatPath).off();
    currentChatPath = path;

    currentListener = db.ref(path).limitToLast(50).on('value', (snap) => {
        container.innerHTML = "";
        snap.forEach((child) => renderMessage(child.key, child.val()));
        container.scrollTop = container.scrollHeight;
    });
}

function renderMessage(msgId, data) {
    const container = document.getElementById('message-container');
    const div = document.createElement('div');
    div.className = "msg-wrap";
    div.setAttribute('data-id', msgId);
    div.setAttribute('data-sender', data.sender);

    let reactionHTML = "";
    if (data.reactions) {
        Object.entries(data.reactions).forEach(([emoji, users]) => {
            const count = Object.keys(users).length;
            if (count > 0) {
                const activeStyle = users[myUsername] ? "border-color: #5865F2; background: #37393e;" : "";
                reactionHTML += `
                    <div onclick="addReaction('${msgId}', '${emoji}')" 
                         style="background:#2B2D31; padding:2px 6px; border-radius:4px; font-size:11px; cursor:pointer; border:1px solid #4E5058; display:flex; align-items:center; gap:4px; margin-right:4px; margin-top:4px; ${activeStyle}">
                        ${emoji} <span style="color:#ffffff;">${count}</span>
                    </div>`;
            }
        });
    }

    let replyHTML = data.replyingTo ? `<div style="font-size: 11px; color: #b5bac1; margin-bottom: 2px;">⮑ ${data.replyingTo.sender}: ${data.replyingTo.content.substring(0, 30)}...</div>` : "";
    
    div.innerHTML = `
        ${replyHTML}
        <div style="display: flex; flex-direction: column; width: 100%;">
            <span style="color: #5865F2; font-weight: bold; font-size: 14px;">${data.sender}</span>
            <div style="color: #dbdee1; font-size: 14px; white-space: pre-wrap; word-break: break-word;">${data.content}</div>
            <div style="display:flex; flex-wrap:wrap;">${reactionHTML}</div>
        </div>
    `;
    container.appendChild(div);
}

// --- 7. NAVIGATION & DMs ---
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
                item.style.borderRadius = "4px";
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

// --- 8. SYSTEM ACTIONS ---
function deleteMessage(msgId) {
    if (confirm("Delete this message?")) {
        db.ref(`${currentChatPath}/${msgId}`).remove();
    }
}

// --- 9. INPUT & KEYBOARD ---
const inputField = document.getElementById('console-input');
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
    }
});

// ESCAPE HATCH (Closes chat immediately)
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.getElementById('app-ui').style.setProperty('display', 'none', 'important');
        document.getElementById('math-cover').style.display = "block";
    }
});

document.getElementById('menu-delete').onclick = () => { deleteMessage(activeMsgId); hideMenu(); };
document.getElementById('menu-reply').onclick = () => { 
    const msg = document.querySelector(`[data-id="${activeMsgId}"]`);
    replyTo = { 
        sender: msg.getAttribute('data-sender'), 
        content: msg.querySelector('div').innerText, 
        id: activeMsgId 
    };
    inputField.placeholder = `Replying to ${replyTo.sender}...`;
    inputField.focus();
    hideMenu();
};

window.onload = initiateLogin;

/**
 * SCHOOL - INTEGRATED ENGINE
 * Features: Toggle Reactions (12-Limit), Custom Emojis, DMs, Stealth Escape, Polished GUI
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
            .catch(() => { console.warn("Access Denied."); });
    }
}

function revealApp() {
    document.getElementById('math-cover').style.display = "none";
    document.getElementById('app-ui').style.setProperty('display', 'flex', 'important');
    document.getElementById('status-text').innerText = "Online";
    document.getElementById('status-text').style.color = "#23a55a";
    document.getElementById('my-name-display').innerText = myUsername;
    
    // Set first letter for avatar
    document.getElementById('user-avatar').innerText = myUsername[0].toUpperCase();
    document.getElementById('user-avatar').style.display = "flex";
    document.getElementById('user-avatar').style.alignItems = "center";
    document.getElementById('user-avatar').style.justifyContent = "center";
    document.getElementById('user-avatar').style.fontWeight = "bold";
    document.getElementById('user-avatar').style.color = "white";

    syncUserList();
    listenForMessages("channels/general");
}

// --- 4. CONTEXT MENU & REACTION ENGINE ---
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

function addReaction(msgId, emoji) {
    const msgRef = db.ref(`${currentChatPath}/${msgId}/reactions`);
    const userRef = db.ref(`${currentChatPath}/${msgId}/reactions/${emoji}/${myUsername}`);

    msgRef.once('value', (snap) => {
        const allReactions = snap.val() || {};
        const uniqueEmojis = Object.keys(allReactions);
        const hasReacted = allReactions[emoji] && allReactions[emoji][myUsername];

        if (hasReacted) {
            userRef.remove(); // Toggle Off
        } else {
            if (!allReactions[emoji] && uniqueEmojis.length >= 12) {
                alert("Maximum 12 unique reactions reached.");
                return;
            }
            userRef.set(true); // Toggle On
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
        if (custom && custom.trim()) {
            addReaction(mId, custom.trim());
        }
    }, 100);
}

// --- 5. MESSAGE RENDERING ---
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
                    <div class="reaction-bubble" onclick="addReaction('${msgId}', '${emoji}')" style="${activeStyle}">
                        ${emoji} <span style="color:#ffffff;">${count}</span>
                    </div>`;
            }
        });
    }

    let replyHTML = data.replyingTo ? `<div style="font-size: 11px; color: var(--text-muted); margin-left: 55px; margin-bottom: 4px;">⮑ ${data.replyingTo.sender}: ${data.replyingTo.content.substring(0, 40)}...</div>` : "";
    
    div.innerHTML = `
        <div style="width: 100%; display: flex; flex-direction: column;">
            ${replyHTML}
            <div style="display: flex;">
                <div style="width: 40px; height: 40px; background: #5865F2; border-radius: 50%; margin-right: 15px; display: flex; align-items: center; justify-content: center; font-weight: bold; flex-shrink: 0;">
                    ${data.sender[0].toUpperCase()}
                </div>
                <div style="flex-grow: 1;">
                    <div style="display: flex; align-items: baseline; gap: 8px;">
                        <span style="color: white; font-weight: 500;">${data.sender}</span>
                        <span style="color: var(--text-muted); font-size: 11px;">${new Date(data.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                    <div style="color: var(--text-normal); font-size: 14px; margin-top: 2px; white-space: pre-wrap; word-break: break-word;">${data.content}</div>
                    <div style="display:flex; flex-wrap:wrap; margin-top: 4px;">${reactionHTML}</div>
                </div>
            </div>
        </div>
    `;
    container.appendChild(div);
}

// --- 6. NAVIGATION & SYSTEM ---
function switchChat(target, type) {
    let path = (type === 'channel') ? `channels/${target}` : `dms/${[myUsername, target].sort().join('_')}`;
    document.getElementById('chat-title').innerText = target;
    document.getElementById('console-input').placeholder = `Message #${target}`;
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
                item.className = "channel-link";
                item.innerHTML = `<span style="color: #80848E; margin-right: 6px; font-size: 18px;">@</span> ${name}`;
                item.onclick = () => switchChat(name, 'dm');
                list.appendChild(item);
            }
        });
    });
    db.ref(`system/users/${myUsername}`).set(true);
}

// --- 7. INPUT HANDLER & STEALH ---
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
    }
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.getElementById('app-ui').style.setProperty('display', 'none', 'important');
        document.getElementById('math-cover').style.display = "block";
    }
});

document.getElementById('menu-delete').onclick = () => { 
    if(confirm("Delete?")) db.ref(`${currentChatPath}/${activeMsgId}`).remove(); 
    hideMenu(); 
};

document.getElementById('menu-reply').onclick = () => { 
    const msg = document.querySelector(`[data-id="${activeMsgId}"]`);
    const content = msg.querySelector('div div div[style*="color: var(--text-normal)"]').innerText;
    replyTo = { sender: msg.getAttribute('data-sender'), content: content, id: activeMsgId };
    inputField.placeholder = `Replying to ${replyTo.sender}...`;
    inputField.focus();
    hideMenu();
};

window.onload = initiateLogin;

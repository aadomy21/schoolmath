/**
 * SCHOOL HUB - SECURE MULTIPLAYER ENGINE
 * Version: Media-Ready + Solo Admin + Flood Protection
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

// --- 2. ADMIN IDENTITY ---
const THE_ONLY_ADMIN = "aadomy21"; 

let myUsername = "";
let currentChatPath = "channels/general";
let currentListener = null;

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
            .catch(() => {
                console.warn("Access Denied.");
            });
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

// --- 4. ADMIN COMMANDS ---
function handleCommands(text) {
    const args = text.split(" ");
    const cmd = args[0].toLowerCase();

    if (myUsername !== THE_ONLY_ADMIN) return false; 

    if (cmd === "/invite") {
        const target = args[1];
        const pass = args[2];
        if (!target || !pass) return true;
        
        db.ref('system/requests').push({ action: 'add', user: target, pass: pass, by: myUsername });
        db.ref(`system/users/${target}`).set(true); 
        return true;
    }

    if (cmd === "/ban") {
        const target = args[1];
        if (!target) return true;
        db.ref(`system/users/${target}`).remove();
        return true;
    }

    return false;
}

// --- 5. CHAT & MEDIA RENDERER ---
function listenForMessages(path) {
    const container = document.getElementById('message-container');
    container.innerHTML = ""; 

    if (currentListener) db.ref(currentChatPath).off();
    currentChatPath = path;

    currentListener = db.ref(path).limitToLast(50).on('child_added', (snap) => {
        renderMessage(snap.val());
    });
}

function renderMessage(data) {
    const container = document.getElementById('message-container');
    const div = document.createElement('div');
    div.style.marginBottom = "15px";
    div.style.wordBreak = "break-word"; 
    div.style.overflowWrap = "anywhere"; 

    const time = new Date(data.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    // Media detection (Images/GIFs)
    const isMedia = /(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))/i.test(data.content);
    let contentHTML = isMedia 
        ? `<img src="${data.content}" style="max-width: 100%; max-height: 400px; border-radius: 8px; margin-top: 5px; display: block;" onerror="this.style.display='none'">`
        : `<div style="color: #dbdee1; font-size: 14px; margin-top: 2px; white-space: pre-wrap;">${data.content}</div>`;
    
    div.innerHTML = `
        <div style="display: flex; flex-direction: column; width: 100%;">
            <div style="display: flex; align-items: baseline; gap: 8px;">
                <span style="color: #5865F2; font-weight: bold; font-size: 14px;">${data.sender}</span>
                <span style="color: #949ba4; font-size: 10px;">${time}</span>
            </div>
            ${contentHTML}
        </div>
    `;
    
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function switchChat(target, type) {
    let path = (type === 'channel') ? `channels/${target}` : `dms/${[myUsername, target].sort().join('_')}`;
    document.getElementById('chat-title').innerText = (type === 'channel' ? target : `@${target}`);
    listenForMessages(path);
}

// --- 6. USER SYNC ---
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

// --- 7. INPUT & STEALTH HANDLERS ---
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

        if (val.startsWith("/")) {
            if (handleCommands(val)) {
                inputField.value = "";
                charCounter.innerText = "0 / 2000";
                return;
            }
        }

        db.ref(currentChatPath).push({
            sender: myUsername,
            content: val,
            timestamp: Date.now()
        });
        
        inputField.value = "";
        charCounter.innerText = "0 / 2000";
    }
});

// Emergency Stealth Switch (Escape)
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.getElementById('app-ui').style.setProperty('display', 'none', 'important');
        document.getElementById('math-cover').style.display = "block";
    }
});

window.onload = initiateLogin;

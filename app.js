/**
 * SCHOOL HUB - SECURE MULTIPLAYER ENGINE
 * Version: Solo Admin + Stealth Gatekeeper
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

// --- 2. THE MASTER KEY ---
// Replace this with your actual username (the prefix of your email)
const THE_ONLY_ADMIN = "aadomy21"; 

let myUsername = "";
let currentChatPath = "channels/general";
let currentListener = null;

// --- 3. GATEKEEPER LOGIC ---
function initiateLogin() {
    const id = prompt("Student Portal ID:");
    const key = prompt("Portal Access Key:");

    if (id && key) {
        auth.signInWithEmailAndPassword(id, key)
            .then(() => {
                myUsername = id.split('@')[0];
                revealApp();
            })
            .catch((err) => {
                console.warn("Unauthorized access attempt.");
                // Keeps math mask visible
            });
    }
}

function revealApp() {
    // Remove the math mask and show the app
    const mask = document.getElementById('math-cover');
    const app = document.getElementById('app-ui');
    
    if (mask) mask.style.display = "none";
    if (app) app.style.setProperty('display', 'flex', 'important');

    document.getElementById('status-text').innerText = "ONLINE";
    document.getElementById('status-text').style.color = "#23a55a";

    syncUserList();
    listenForMessages("channels/general");
}

// --- 4. ADMIN POWER ENGINE ---
function handleCommands(text) {
    const args = text.split(" ");
    const cmd = args[0].toLowerCase();

    // Security Check: Block non-admins from system commands
    if (myUsername !== THE_ONLY_ADMIN) {
        return false; 
    }

    if (cmd === "/invite") {
        const target = args[1];
        const pass = args[2];
        if (!target || !pass) {
            alert("Usage: /invite [user] [pass]");
            return true;
        }
        
        // Push to database for your records and add to global user list
        db.ref('system/requests').push({ action: 'add', user: target, pass: pass, by: myUsername });
        db.ref(`system/users/${target}`).set(true); 
        alert(`Access granted for ${target}. Create their email/pass in Firebase Auth to finish.`);
        return true;
    }

    if (cmd === "/ban") {
        const target = args[1];
        if (!target) return true;

        db.ref('system/requests').push({ action: 'remove', user: target, by: myUsername });
        db.ref(`system/users/${target}`).remove();
        alert(`User ${target} access revoked.`);
        return true;
    }

    return false;
}

// --- 5. CHAT ENGINE ---
function listenForMessages(path) {
    const container = document.getElementById('message-container');
    container.innerHTML = ""; // Clear view for new channel

    // Clean up old listener
    if (currentListener) {
        db.ref(currentChatPath).off();
    }

    currentChatPath = path;

    // "Multiplayer" listener - triggers for every user when a message is added
    currentListener = db.ref(path).limitToLast(50).on('child_added', (snap) => {
        const d = snap.val();
        renderMessage(d);
    });
}

function renderMessage(data) {
    const container = document.getElementById('message-container');
    const div = document.createElement('div');
    div.style.marginBottom = "15px";
    
    const time = new Date(data.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

    // Detection logic for Images/GIFs
    const isMedia = /(https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp))/i.test(data.content);
    
    let contentHTML = "";
    if (isMedia) {
        // If it's a link to a GIF or Image, render it as an actual image
        contentHTML = `<img src="${data.content}" style="max-width: 300px; border-radius: 8px; margin-top: 5px; display: block;" onerror="this.src='https://via.placeholder.com/150?text=Invalid+Image+Link'">`;
    } else {
        // Otherwise, render as normal text
        contentHTML = `<div style="color: #dbdee1; font-size: 14px; margin-top: 2px;">${data.content}</div>`;
    }
    
    div.innerHTML = `
        <div style="display: flex; flex-direction: column;">
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
    let path = "";
    const title = document.getElementById('chat-title');

    if (type === 'channel') {
        path = `channels/${target}`;
        title.innerText = target;
    } else {
        // DM Logic: Sorts names to ensure both users enter the same private path
        const pair = [myUsername, target].sort();
        path = `dms/${pair[0]}_${pair[1]}`;
        title.innerText = `@${target}`;
    }

    listenForMessages(path);
}

// --- 6. USER SYNCING ---
function syncUserList() {
    // Automatically updates the DM sidebar for everyone when you invite/ban someone
    db.ref('system/users').on('value', (snap) => {
        const list = document.getElementById('dm-list');
        list.innerHTML = "";
        
        snap.forEach(userSnap => {
            const name = userSnap.key;
            if (name !== myUsername) {
                const item = document.createElement('div');
                item.style.padding = "8px";
                item.style.margin = "2px 0";
                item.style.borderRadius = "4px";
                item.style.cursor = "pointer";
                item.style.color = "#949ba4";
                item.innerText = `# ${name}`;
                
                item.onclick = () => switchChat(name, 'dm');
                item.onmouseover = () => item.style.backgroundColor = "#35373c";
                item.onmouseout = () => item.style.backgroundColor = "transparent";
                
                list.appendChild(item);
            }
        });
    });

    // Ensure your own name is in the registry
    db.ref(`system/users/${myUsername}`).set(true);
}

// --- 7. EVENT LISTENERS ---
document.getElementById('console-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const val = e.target.value.trim();
        if (!val) return;

        // Process admin commands
        if (val.startsWith("/")) {
            if (handleCommands(val)) {
                e.target.value = "";
                return;
            }
        }

        // Send normal message
        db.ref(currentChatPath).push({
            sender: myUsername,
            content: val,
            timestamp: Date.now()
        });
        
        e.target.value = "";
    }
});

// Emergency Stealth Switch (Escape Key)
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const app = document.getElementById('app-ui');
        const mask = document.getElementById('math-cover');
        if (app && mask) {
            app.style.setProperty('display', 'none', 'important');
            mask.style.display = "block";
        }
    }
});

// Initialize on Load
window.onload = initiateLogin;

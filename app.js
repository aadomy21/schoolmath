/**
 * COSMIC HUB - MULTIPLAYER SCHOOL MESSAGING
 * Database: schoolmathpart
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

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

// --- 2. GLOBAL STATE ---
let currentChatPath = "channels/general";
let currentListener = null;
let myUsername = "";

/**
 * RECIPIENTS: Add the usernames (the prefix before @ in Firebase Auth)
 * of people you want to show up in your DM list.
 */
const friends = ["mr_chaos", "BJodfuo", "teammate_1"]; 

// --- 3. THE GATEKEEPER ---

function unlockDashboard() {
    const email = prompt("Enter Student Email:");
    const password = prompt("Enter Access Key:");

    if (!email || !password) {
        showMathCover();
        return;
    }

    auth.signInWithEmailAndPassword(email, password)
        .then((userCredential) => {
            myUsername = email.split('@')[0];
            
            // UI Reveal
            document.getElementById('app-ui').style.display = "flex";
            document.getElementById('math-cover').style.display = "none";
            document.getElementById('status-text').innerText = "ONLINE";
            document.getElementById('status-text').style.color = "#23a55a";
            
            // Initialization
            loadDMs();
            switchChat('general', 'channel');
        })
        .catch((error) => {
            console.error("Login Failed:", error.message);
            showMathCover();
        });
}

function showMathCover() {
    document.getElementById('app-ui').style.display = "none";
    document.getElementById('math-cover').style.display = "block";
}

// --- 4. CHAT & MESSAGE LOGIC ---

/**
 * Switches between global school channels and private DMs
 */
function switchChat(target, type) {
    let path = "";
    const titleElement = document.getElementById('chat-title');
    const inputElement = document.getElementById('console-input');

    if (type === 'channel') {
        path = `channels/${target}`;
        titleElement.innerText = target;
        inputElement.placeholder = `Message #${target}...`;
    } else {
        // DM Logic: Create a unique room ID by sorting names alphabetically
        const pair = [myUsername, target].sort();
        path = `dms/${pair[0]}_${pair[1]}`;
        titleElement.innerText = `@${target}`;
        inputElement.placeholder = `Message @${target}...`;
    }

    listenForMessages(path);
}

/**
 * Real-time listener: The core "multiplayer" engine
 */
function listenForMessages(path) {
    const container = document.getElementById('message-container');
    container.innerHTML = ""; // Clear for new chat

    // Remove existing listener to save performance/avoid duplicates
    if (currentListener) {
        db.ref(currentChatPath).off();
    }

    currentChatPath = path;

    // Listen for new children (messages) in the specific database path
    currentListener = db.ref(path).limitToLast(50).on('child_added', (snapshot) => {
        const data = snapshot.val();
        renderMessage(data);
    });
}

function renderMessage(data) {
    const container = document.getElementById('message-container');
    const msgDiv = document.createElement('div');
    msgDiv.className = "message-entry";
    
    const time = new Date(data.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    // Discord-style formatting
    msgDiv.innerHTML = `
        <div style="margin-bottom: 8px;">
            <b style="color: #5865F2; margin-right: 5px;">${data.sender}</b>
            <small style="color: #949ba4; font-size: 11px;">${time}</small>
            <div style="color: #dbdee1; margin-top: 2px;">${data.content}</div>
        </div>
    `;
    
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight; // Keep chat at the bottom
}

function sendMessage(text) {
    if (!text.trim()) return;

    const messageData = {
        sender: myUsername,
        content: text,
        timestamp: Date.now()
    };

    // Push message to current Firebase path
    db.ref(currentChatPath).push(messageData);
}

// --- 5. UI POPULATION ---

function loadDMs() {
    const dmList = document.getElementById('dm-list');
    dmList.innerHTML = "";

    friends.forEach(friend => {
        if (friend !== myUsername) { // Don't DM yourself
            const div = document.createElement('div');
            div.className = "file-item";
            div.style.cssText = "padding: 8px; cursor: pointer; color: #949ba4;";
            div.innerHTML = `<span style="margin-right: 5px;">@</span> ${friend}`;
            div.onclick = () => switchChat(friend, 'dm');
            
            // Hover effect
            div.onmouseover = () => div.style.backgroundColor = "#35373c";
            div.onmouseout = () => div.style.backgroundColor = "transparent";
            
            dmList.appendChild(div);
        }
    });
}

// --- 6. GLOBAL EVENT LISTENERS ---

// Handle Enter key for sending messages
document.getElementById('console-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage(e.target.value);
        e.target.value = "";
    }
});

// Panic Escape Key (Instantly hide app)
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        showMathCover();
        document.title = "Math Assignment - Term 3";
    }
});

// Run Gatekeeper on load
window.onload = unlockDashboard;

/**
 * COSMIC HUB - FULL SYSTEM (MESSAGING + DASHBOARD)
 * Project: schoolmathpart
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
let currentChannel = "Botc";
let msgListener = null;

const projectData = {
  "Botc": {
    name: "Battle of the Cosmics",
    files: ["main.luau", "abilities.luau", "render_handler.js"],
    desc: "FPS Engine"
  },
  "HexWreck": {
    name: "Hex Wreck",
    files: ["spleef_core.luau", "lobby.luau", "map_config.json"],
    desc: "Spleef Mini-game"
  },
  "GlorySMP": {
    name: "Glory SMP",
    files: ["sonic_crossbow.js", "player_stats.db", "config.yml"],
    desc: "MC Server Management"
  }
};

// --- 3. AUTHENTICATION ---
function unlockDashboard() {
  const email = prompt("Enter Admin ID:");
  const password = prompt("Enter Access Key:");

  auth.signInWithEmailAndPassword(email, password)
    .then(() => {
      document.getElementById('status-text').innerText = "ONLINE";
      document.getElementById('status-text').style.color = "#23a55a";
      // Set initial project
      switchProject('Botc');
    })
    .catch(err => {
      alert("Unauthorized Access.");
      console.error(err.message);
    });
}

// --- 4. MESSAGING LOGIC ---

function sendMessage(content) {
  if (!content.trim()) return;

  // Push creates a unique ID for the message (Discord-style)
  const msgRef = db.ref(`messages/${currentChannel}`).push();
  msgRef.set({
    user: auth.currentUser.email.split('@')[0],
    text: content,
    timestamp: Date.now()
  });
}

function listenForMessages(channel) {
  const container = document.getElementById('message-container');
  container.innerHTML = `<div class="system-message">Joined #${channel}</div>`;

  // Remove old listeners to prevent double-posting
  if (msgListener) {
    db.ref(`messages/${currentChannel}`).off();
  }

  // "on child_added" fires for every message in the database + new ones
  msgListener = db.ref(`messages/${channel}`).limitToLast(50).on('child_added', (snapshot) => {
    const data = snapshot.val();
    renderMessage(data);
  });
}

function renderMessage(data) {
  const container = document.getElementById('message-container');
  const msgDiv = document.createElement('div');
  msgDiv.className = "message-entry";

  const time = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  msgDiv.innerHTML = `
        <div class="msg-header">
            <span class="msg-user">${data.user}</span>
            <span class="msg-time">${time}</span>
        </div>
        <div class="msg-content">${data.text}</div>
    `;

  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight; // Auto-scroll
}

// --- 5. UI & PROJECT SWITCHING ---

function switchProject(name) {
  currentChannel = name;
  document.getElementById('current-project-name').innerText = name;

  // Update File List (Original Logic)
  const list = document.getElementById('file-list');
  list.innerHTML = "";
  projectData[name].files.forEach(file => {
    const item = document.createElement('div');
    item.className = "file-item";
    item.innerHTML = `<span class="file-hash">#</span> ${file}`;
    item.onclick = () => {
      document.getElementById('active-file-name').innerText = file;
      // Log access to Firebase
      db.ref("session/active").set({ project: name, file: file, time: Date.now() });
    };
    list.appendChild(item);
  });

  // Update Visual Icons
  document.querySelectorAll('.project-icon').forEach(icon => {
    icon.classList.remove('active');
    if (icon.innerText === name[0]) icon.classList.add('active');
  });

  // Update Chat Channel
  listenForMessages(name);
}

// --- 6. EVENT LISTENERS ---

// Input listener for Enter key
document.getElementById('console-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendMessage(e.target.value);
    e.target.value = "";
  }
});

// Panic Switch (Escape)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.body.style.filter = "invert(100%) grayscale(100%)";
    document.title = "Mathematics Assignment - Term 3";
  }
});

// Initialize on Load
window.onload = unlockDashboard;
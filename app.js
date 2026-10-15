// --- 1. CONFIG & IDENTITIES ---
const ADMIN_PIN = "2007";
let isAdmin = sessionStorage.getItem('ghost_is_admin') === 'true';

// Admin Device Selection (PC vs Laptop)
let adminDevice = localStorage.getItem('ghost_admin_device') || 'PC';
const deviceSelect = document.getElementById('select-device-type');
if (deviceSelect) {
  deviceSelect.value = adminDevice;
  deviceSelect.onchange = (e) => {
    localStorage.setItem('ghost_admin_device', e.target.value);
    location.reload(); // Reconnect with new device tag
  };
}

// Generate or Fetch Fixed ID
let myId = localStorage.getItem('ghost_my_id');
if (!myId) {
  // If first time, generate a persistent clean ID
  myId = isAdmin 
    ? (adminDevice === 'PC' ? 'admin_pc' : 'admin_laptop')
    : 'user_' + Math.floor(1000 + Math.random() * 9000);
  localStorage.setItem('ghost_my_id', myId);
}

// If admin, ensure ID matches device
if (isAdmin) {
  myId = adminDevice === 'PC' ? 'admin_pc' : 'admin_laptop';
  localStorage.setItem('ghost_my_id', myId);
}

document.getElementById('my-peer-id').textContent = myId;

if ("Notification" in window && Notification.permission !== "granted") {
  Notification.requestPermission();
}

document.getElementById('btn-copy-id').onclick = () => {
  navigator.clipboard.writeText(myId);
  alert("Your ID Copied: " + myId);
};

// PeerJS Initialization
const peer = new Peer(myId);
let activeConn = null;
let currentContactPeerId = null;
let activeMediaCall = null;
let contacts = JSON.parse(localStorage.getItem('ghost_admin_contacts') || '[]');

// --- 2. ADMIN LOCK UI ---
const adminBtn = document.getElementById('btn-admin-toggle');
const adminControls = document.getElementById('admin-controls');
const guestMessage = document.getElementById('guest-message');
const deviceBox = document.getElementById('device-selector-box');

function updateAdminUI() {
  if (isAdmin) {
    adminControls.classList.remove('hidden');
    guestMessage.classList.add('hidden');
    deviceBox.classList.remove('hidden');
    adminBtn.textContent = "🔓 Admin Active";
    renderContacts();
  } else {
    adminControls.classList.add('hidden');
    guestMessage.classList.remove('hidden');
    deviceBox.classList.add('hidden');
    adminBtn.textContent = "🔒 Admin";
  }
}
updateAdminUI();

adminBtn.onclick = () => {
  if (isAdmin) {
    if (confirm("Lock Admin Mode?")) {
      isAdmin = false;
      sessionStorage.removeItem('ghost_is_admin');
      localStorage.removeItem('ghost_my_id');
      location.reload();
    }
  } else {
    const pin = prompt("Enter Secret Admin PIN:");
    if (pin === ADMIN_PIN) {
      isAdmin = true;
      sessionStorage.setItem('ghost_is_admin', 'true');
      location.reload();
    } else {
      alert("Incorrect PIN! Access Denied.");
    }
  }
};

// --- 3. INDEXEDDB SETUP (VERSION 4) ---
let db;
const dbReq = indexedDB.open('GhostChatDB', 4);
dbReq.onupgradeneeded = (e) => {
  db = e.target.result;
  if (db.objectStoreNames.contains('messages')) {
    db.deleteObjectStore('messages');
  }
  const store = db.createObjectStore('messages', { keyPath: 'msgId' });
  store.createIndex('contactId', 'contactId', { unique: false });
};
dbReq.onsuccess = (e) => {
  db = e.target.result;
  if (isAdmin) renderContacts();
};

function saveMessageLocally(msgId, contactId, sender, text, fileData = null, fileType = null) {
  if (!db) return;
  const tx = db.transaction('messages', 'readwrite');
  const store = tx.objectStore('messages');
  store.put({ msgId, contactId, sender, text, fileData, fileType, timestamp: Date.now() });
}

function deleteMessageLocally(msgId) {
  if (!db) return;
  const tx = db.transaction('messages', 'readwrite');
  const store = tx.objectStore('messages');
  store.delete(msgId);
}

function loadContactMessages(contactId) {
  const container = document.getElementById('messages-container');
  container.innerHTML = '';
  if (!db) return;
  const tx = db.transaction('messages', 'readonly');
  const store = tx.objectStore('messages');
  const index = store.index('contactId');
  const req = index.getAll(contactId);

  req.onsuccess = () => {
    req.result.forEach(msg => appendMessageUI(msg.msgId, msg.sender === myId ? 'sent' : 'received', msg.text, msg.fileData, msg.fileType, msg.timestamp));
  };
}

// --- 4. SOUNDS & NOTIFICATIONS ---
function playLoudChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, ctx.currentTime);
    gain1.gain.setValueAtTime(0.5, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start();
    osc1.stop(ctx.currentTime + 0.35);

    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(880, ctx.currentTime);
      gain2.gain.setValueAtTime(0.6, ctx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start();
      osc2.stop(ctx.currentTime + 0.5);
    }, 120);
  } catch (e) {}
}

function sendDesktopNotification(title, body) {
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
    new Notification(title, { body, icon: 'https://cdn-icons-png.flaticon.com/512/9446/9446864.png' });
  }
}

// --- 5. SMART AUTO-CONNECT ENGINE ---
peer.on('open', (id) => {
  console.log('Peer Node Ready:', id);
  startAutoConnectEngine();
});

peer.on('connection', (conn) => setupConnection(conn));

// Yeh function lagataar background mein check karta rahega
function startAutoConnectEngine() {
  setInterval(() => {
    if (activeConn && activeConn.open) return; // Pehle se connected hai to do nothing

    if (isAdmin) {
      // Admin: Har saved contact se auto-connect try karega
      contacts.forEach(contact => {
        if (!activeConn || !activeConn.open) {
          silentConnect(contact.id, contact.name);
        }
      });
    } else {
      // Guest/Dost: Admin PC aur Admin Laptop dono ko scan karega
      const adminTargets = ['admin_pc', 'admin_laptop'];
      adminTargets.forEach(adminId => {
        if (!activeConn || !activeConn.open) {
          silentConnect(adminId, "Admin");
        }
      });
    }
  }, 2500); // Har 2.5 seconds baad instant auto-scan
}

function silentConnect(targetId, targetName) {
  try {
    const conn = peer.connect(targetId, { reliable: true });
    setupConnection(conn, targetName);
  } catch(e) {}
}

function setupConnection(conn, customName = null) {
  conn.on('open', () => {
    activeConn = conn;
    currentContactPeerId = conn.peer;

    // Handshake: Send identity device info
    const myDeviceLabel = isAdmin ? `Admin (${adminDevice})` : (localStorage.getItem('ghost_guest_name') || 'Friend');
    conn.send({ type: 'handshake', deviceLabel: myDeviceLabel });

    const displayName = customName || getContactName(conn.peer) || conn.peer;
    updateOnlineUI(displayName);
    toggleInputs(true);
    loadContactMessages(conn.peer);
    if (isAdmin) renderContacts();
  });

  conn.on('data', (data) => handleIncomingData(data));

  conn.on('close', () => {
    document.getElementById('connection-status').textContent = '● Auto-Searching...';
    document.getElementById('connection-status').className = 'status-offline';
    toggleInputs(false);
    activeConn = null;
  });
}

function updateOnlineUI(name) {
  const statusEl = document.getElementById('connection-status');
  statusEl.textContent = `● Online: ${name}`;
  statusEl.className = 'status-online';
  document.getElementById('current-contact-name').textContent = name;
  const guestStatus = document.getElementById('guest-status-text');
  if (guestStatus) guestStatus.textContent = `Connected with ${name}!`;
}

function getContactName(peerId) {
  const c = contacts.find(item => item.id === peerId);
  return c ? c.name : null;
}

// --- 6. DATA HANDLING ---
function handleIncomingData(data) {
  if (data.type === 'handshake') {
    updateOnlineUI(data.deviceLabel);
  } else if (data.type === 'chat') {
    playLoudChime();
    sendDesktopNotification("Message from " + (getContactName(activeConn.peer) || activeConn.peer), data.text);
    appendMessageUI(data.msgId, 'received', data.text, null, null, data.timestamp);
    saveMessageLocally(data.msgId, activeConn.peer, activeConn.peer, data.text);
  } else if (data.type === 'file') {
    playLoudChime();
    sendDesktopNotification("Media Received", "Friend sent a photo/video");
    appendMessageUI(data.msgId, 'received', '', data.fileData, data.fileType, data.timestamp);
    saveMessageLocally(data.msgId, activeConn.peer, activeConn.peer, '', data.fileData, data.fileType);
  } else if (data.type === 'delete_msg_everyone') {
    const el = document.getElementById(`msg-${data.msgId}`);
    if (el) el.remove();
    deleteMessageLocally(data.msgId);
  } else if (data.type === 'call_ring') {
    showIncomingCallUI();
  } else if (data.type === 'call_accepted') {
    document.getElementById('call-status-title').textContent = "In Call (Live)";
    document.getElementById('btn-accept-call').classList.add('hidden');
  } else if (data.type === 'call_ended') {
    closeCallModal();
  } else if (data.type === 'live_typing') {
    document.getElementById('remote-live-text').textContent = data.text || '...';
  }
}

// --- 7. CHAT & PERMANENT DELETE ---
document.getElementById('chat-form').onsubmit = (e) => {
  e.preventDefault();
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text || !activeConn) return;

  const msgId = 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
  const timestamp = Date.now();
  activeConn.send({ type: 'chat', text, msgId, timestamp });
  appendMessageUI(msgId, 'sent', text, null, null, timestamp);
  saveMessageLocally(msgId, activeConn.peer, myId, text);
  input.value = '';
};

document.getElementById('file-input').onchange = (e) => {
  const file = e.target.files[0];
  if (!file || !activeConn) return;

  const reader = new FileReader();
  reader.onload = () => {
    const fileData = reader.result;
    const msgId = 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    const timestamp = Date.now();
    activeConn.send({ type: 'file', fileData, fileType: file.type, msgId, timestamp });
    appendMessageUI(msgId, 'sent', '', fileData, file.type, timestamp);
    saveMessageLocally(msgId, activeConn.peer, myId, '', fileData, file.type);
  };
  reader.readAsDataURL(file);
};

function appendMessageUI(msgId, type, text, fileData = null, fileType = null, timestamp = Date.now()) {
  const container = document.getElementById('messages-container');
  const msgDiv = document.createElement('div');
  msgDiv.className = `msg ${type}`;
  msgDiv.id = `msg-${msgId}`;

  if (text) {
    const span = document.createElement('span');
    span.textContent = text;
    msgDiv.appendChild(span);
  }
  if (fileData) {
    if (fileType.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = fileData;
      msgDiv.appendChild(img);
    } else if (fileType.startsWith('video/')) {
      const vid = document.createElement('video');
      vid.src = fileData;
      vid.controls = true;
      msgDiv.appendChild(vid);
    }
  }

  const footer = document.createElement('div');
  footer.className = 'msg-footer';

  const timeSpan = document.createElement('span');
  timeSpan.className = 'msg-time';
  const d = new Date(timestamp);
  timeSpan.textContent = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  footer.appendChild(timeSpan);

  const delBtn = document.createElement('button');
  delBtn.className = 'btn-del-msg';
  delBtn.innerHTML = '🗑️ Delete';
  delBtn.onclick = () => showDeleteChoiceModal(msgId, msgDiv);
  footer.appendChild(delBtn);

  msgDiv.appendChild(footer);
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

function showDeleteChoiceModal(msgId, msgDiv) {
  const choiceModal = document.createElement('div');
  choiceModal.className = 'modal';
  choiceModal.innerHTML = `
    <div class="delete-dialog">
      <h4>Delete Message?</h4>
      <p>Do you want to delete this message only for yourself or for everyone?</p>
      <div class="delete-actions">
        <button id="opt-del-everyone" class="btn-del-opt btn-del-for-all">🗑️ Delete for Everyone</button>
        <button id="opt-del-me" class="btn-del-opt btn-del-for-me">Delete for Me</button>
        <button id="opt-del-cancel" class="btn-del-opt btn-del-cancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(choiceModal);

  document.getElementById('opt-del-me').onclick = () => {
    msgDiv.remove();
    deleteMessageLocally(msgId);
    choiceModal.remove();
  };

  document.getElementById('opt-del-everyone').onclick = () => {
    msgDiv.remove();
    deleteMessageLocally(msgId);
    if (activeConn) {
      activeConn.send({ type: 'delete_msg_everyone', msgId });
    }
    choiceModal.remove();
  };

  document.getElementById('opt-del-cancel').onclick = () => choiceModal.remove();
}

// --- 8. CALL & RINGTONE ---
const ringtone = document.getElementById('ringtone');
function playRingtone() {
  ringtone.play().catch(() => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.connect(ctx.destination);
    osc.start();
    setTimeout(() => osc.stop(), 2500);
  });
}
function stopRingtone() { ringtone.pause(); ringtone.currentTime = 0; }

document.getElementById('btn-start-call').onclick = () => {
  if (!activeConn) return;
  activeConn.send({ type: 'call_ring' });
  document.getElementById('call-modal').classList.remove('hidden');
  document.getElementById('call-status-title').textContent = "Calling Friend...";
  document.getElementById('btn-accept-call').classList.add('hidden');
};

function showIncomingCallUI() {
  playRingtone();
  const name = getContactName(activeConn.peer) || activeConn.peer;
  sendDesktopNotification("Incoming Call!", `${name} is calling you now!`);
  document.getElementById('call-modal').classList.remove('hidden');
  document.getElementById('call-status-title').textContent = "Incoming Call from " + name;
  document.getElementById('btn-accept-call').classList.remove('hidden');
}

document.getElementById('btn-accept-call').onclick = () => {
  stopRingtone();
  activeConn.send({ type: 'call_accepted' });
  document.getElementById('call-status-title').textContent = "In Call (Live)";
  document.getElementById('btn-accept-call').classList.add('hidden');
};

document.getElementById('btn-end-call').onclick = () => {
  stopRingtone();
  if (activeConn) activeConn.send({ type: 'call_ended' });
  closeCallModal();
};

function closeCallModal() {
  stopRingtone();
  document.getElementById('call-modal').classList.add('hidden');
  const videoWrapper = document.getElementById('screen-wrapper');
  if (videoWrapper) videoWrapper.classList.add('hidden');
  const video = document.getElementById('remote-screen-video');
  video.srcObject = null;
  if (activeMediaCall) activeMediaCall.close();
}

document.getElementById('my-live-input').oninput = (e) => {
  if (activeConn) activeConn.send({ type: 'live_typing', text: e.target.value });
};

// --- 9. BIG SCREEN SHARE & FULLSCREEN ---
document.getElementById('btn-screen-share').onclick = async () => {
  if (!activeConn) return;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    activeMediaCall = peer.call(activeConn.peer, stream);
    document.getElementById('call-modal').classList.remove('hidden');
    document.getElementById('call-status-title').textContent = "Sharing Screen...";
  } catch (err) {}
};

peer.on('call', (call) => {
  activeMediaCall = call;
  playLoudChime();
  sendDesktopNotification("Screen Share", "Friend started sharing screen");
  call.answer();
  call.on('stream', (remoteStream) => {
    const video = document.getElementById('remote-screen-video');
    video.srcObject = remoteStream;
    const videoWrapper = document.getElementById('screen-wrapper');
    if (videoWrapper) videoWrapper.classList.remove('hidden');
    document.getElementById('call-modal').classList.remove('hidden');
    document.getElementById('call-status-title').textContent = "Viewing Remote Screen";
  });
});

function toggleVideoFullscreen() {
  const video = document.getElementById('remote-screen-video');
  if (!document.fullscreenElement) {
    video.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
}

// --- 10. ADMIN CONTACTS MANAGEMENT ---
document.getElementById('btn-add-contact').onclick = () => {
  if (!isAdmin) return;
  const nameInput = document.getElementById('target-contact-name');
  const idInput = document.getElementById('target-peer-id');
  const name = nameInput.value.trim();
  const id = idInput.value.trim();

  if (!name || !id) return alert("Please enter both Name and Peer ID!");

  const existing = contacts.find(c => c.id === id);
  if (existing) {
    existing.name = name;
  } else {
    contacts.push({ name, id });
  }
  localStorage.setItem('ghost_admin_contacts', JSON.stringify(contacts));
  renderContacts();
  silentConnect(id, name);

  nameInput.value = '';
  idInput.value = '';
};

function renderContacts() {
  if (!isAdmin) return;
  const list = document.getElementById('contacts-list');
  list.innerHTML = '';
  contacts.forEach(contact => {
    const li = document.createElement('li');
    li.className = `contact-item ${contact.id === currentContactPeerId ? 'active' : ''}`;
    li.innerHTML = `
      <span class="c-name">${contact.name}</span>
      <span class="c-id">${contact.id}</span>
    `;
    li.onclick = () => silentConnect(contact.id, contact.name);
    list.appendChild(li);
  });
}

function toggleInputs(enabled) {
  document.getElementById('message-input').disabled = !enabled;
  document.getElementById('btn-send').disabled = !enabled;
  document.getElementById('btn-start-call').disabled = !enabled;
  document.getElementById('btn-screen-share').disabled = !enabled;
}

// --- 11. PRIVACY BLUR ---
window.addEventListener('blur', () => document.getElementById('privacy-shield').classList.remove('hidden'));
window.addEventListener('focus', () => document.getElementById('privacy-shield').classList.add('hidden'));
document.addEventListener('contextmenu', e => e.preventDefault());
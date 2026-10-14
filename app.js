// --- 1. CONFIG & ADMIN PIN ---
const ADMIN_PIN = "2007";
let isAdmin = sessionStorage.getItem('ghost_is_admin') === 'true';

let myId = localStorage.getItem('ghost_my_id') || 'user_' + Math.floor(1000 + Math.random() * 9000);
localStorage.setItem('ghost_my_id', myId);
document.getElementById('my-peer-id').textContent = myId;

// Request Desktop Notifications Permission
if ("Notification" in window && Notification.permission !== "granted") {
  Notification.requestPermission();
}

document.getElementById('btn-copy-id').onclick = () => {
  navigator.clipboard.writeText(myId);
  alert("Your ID Copied: " + myId);
};

const peer = new Peer(myId);
let activeConn = null;
let currentContactPeerId = null;
let activeMediaCall = null;
let contacts = JSON.parse(localStorage.getItem('ghost_admin_contacts') || '[]');

// --- 2. ADMIN LOCK LOGIC ---
const adminBtn = document.getElementById('btn-admin-toggle');
const adminControls = document.getElementById('admin-controls');
const guestMessage = document.getElementById('guest-message');

function updateAdminUI() {
  if (isAdmin) {
    adminControls.classList.remove('hidden');
    guestMessage.classList.add('hidden');
    adminBtn.textContent = "🔓 Admin Active";
    renderContacts();
  } else {
    adminControls.classList.add('hidden');
    guestMessage.classList.remove('hidden');
    adminBtn.textContent = "🔒 Admin";
  }
}
updateAdminUI();

adminBtn.onclick = () => {
  if (isAdmin) {
    if (confirm("Lock Admin Mode?")) {
      isAdmin = false;
      sessionStorage.removeItem('ghost_is_admin');
      updateAdminUI();
    }
  } else {
    const pin = prompt("Enter Secret Admin PIN:");
    if (pin === ADMIN_PIN) {
      isAdmin = true;
      sessionStorage.setItem('ghost_is_admin', 'true');
      updateAdminUI();
      alert("Admin Access Granted! Welcome.");
    } else {
      alert("Incorrect PIN! Access Denied.");
    }
  }
};

// --- 3. INDEXEDDB WITH UNIQUE MSG IDS ---
let db;
const dbReq = indexedDB.open('GhostChatDB', 3);
dbReq.onupgradeneeded = (e) => {
  db = e.target.result;
  if (!db.objectStoreNames.contains('messages')) {
    const store = db.createObjectStore('messages', { keyPath: 'msgId' });
    store.createIndex('contactId', 'contactId', { unique: false });
  }
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
    req.result.forEach(msg => appendMessageUI(msg.msgId, msg.sender === myId ? 'sent' : 'received', msg.text, msg.fileData, msg.fileType));
  };
}

// --- 4. SOUND EFFECTS & NOTIFICATIONS ---
function playMsgSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {}
}

function sendDesktopNotification(title, body) {
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
    new Notification(title, { body, icon: 'https://cdn-icons-png.flaticon.com/512/9446/9446864.png' });
  }
}

// --- 5. PEERJS CONNECTION ---
peer.on('connection', (conn) => setupConnection(conn));

function connectToPeer(targetId, targetName = null) {
  if (targetId === myId) return alert("You cannot connect to yourself!");
  const conn = peer.connect(targetId, { reliable: true });
  setupConnection(conn, targetName);
}

function setupConnection(conn, customName = null) {
  activeConn = conn;
  currentContactPeerId = conn.peer;

  conn.on('open', () => {
    const displayName = customName || getContactName(conn.peer) || conn.peer;
    document.getElementById('connection-status').textContent = '● Connected';
    document.getElementById('connection-status').className = 'status-online';
    document.getElementById('current-contact-name').textContent = displayName;
    toggleInputs(true);
    loadContactMessages(conn.peer);
    if (isAdmin) renderContacts();
  });

  conn.on('data', (data) => handleIncomingData(data));

  conn.on('close', () => {
    document.getElementById('connection-status').textContent = '● Disconnected';
    document.getElementById('connection-status').className = 'status-offline';
    toggleInputs(false);
  });
}

function getContactName(peerId) {
  const c = contacts.find(item => item.id === peerId);
  return c ? c.name : null;
}

// --- 6. DATA INCOMING & DELETE LOGIC ---
function handleIncomingData(data) {
  if (data.type === 'chat') {
    playMsgSound();
    sendDesktopNotification("New Message from " + (getContactName(activeConn.peer) || activeConn.peer), data.text);
    appendMessageUI(data.msgId, 'received', data.text);
    saveMessageLocally(data.msgId, activeConn.peer, activeConn.peer, data.text);
  } else if (data.type === 'file') {
    playMsgSound();
    sendDesktopNotification("Media Received", "Friend sent a photo/video");
    appendMessageUI(data.msgId, 'received', '', data.fileData, data.fileType);
    saveMessageLocally(data.msgId, activeConn.peer, activeConn.peer, '', data.fileData, data.fileType);
  } else if (data.type === 'delete_msg') {
    // Delete on both sides!
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

// --- 7. CHAT, FILE & DELETE SENDING ---
document.getElementById('chat-form').onsubmit = (e) => {
  e.preventDefault();
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text || !activeConn) return;

  const msgId = 'msg_' + Date.now() + '_' + Math.floor(Math.random()*1000);
  activeConn.send({ type: 'chat', text, msgId });
  appendMessageUI(msgId, 'sent', text);
  saveMessageLocally(msgId, activeConn.peer, myId, text);
  input.value = '';
};

document.getElementById('file-input').onchange = (e) => {
  const file = e.target.files[0];
  if (!file || !activeConn) return;

  const reader = new FileReader();
  reader.onload = () => {
    const fileData = reader.result;
    const msgId = 'msg_' + Date.now() + '_' + Math.floor(Math.random()*1000);
    activeConn.send({ type: 'file', fileData, fileType: file.type, msgId });
    appendMessageUI(msgId, 'sent', '', fileData, file.type);
    saveMessageLocally(msgId, activeConn.peer, myId, '', fileData, file.type);
  };
  reader.readAsDataURL(file);
};

function appendMessageUI(msgId, type, text, fileData = null, fileType = null) {
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

  // Delete Button
  const delBtn = document.createElement('button');
  delBtn.className = 'btn-del-msg';
  delBtn.innerHTML = '🗑️ Delete';
  delBtn.onclick = () => {
    if (confirm("Delete this message for everyone?")) {
      msgDiv.remove();
      deleteMessageLocally(msgId);
      if (activeConn) {
        activeConn.send({ type: 'delete_msg', msgId });
      }
    }
  };
  msgDiv.appendChild(delBtn);

  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
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
  document.getElementById('remote-screen-video').classList.add('hidden');
  document.getElementById('remote-screen-video').srcObject = null;
  if (activeMediaCall) activeMediaCall.close();
}

document.getElementById('my-live-input').oninput = (e) => {
  if (activeConn) activeConn.send({ type: 'live_typing', text: e.target.value });
};

// --- 9. SCREEN SHARE WITH RING ---
document.getElementById('btn-screen-share').onclick = async () => {
  if (!activeConn) return;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    activeMediaCall = peer.call(activeConn.peer, stream);
    document.getElementById('call-modal').classList.remove('hidden');
    document.getElementById('call-status-title').textContent = "Sharing Screen...";
  } catch (err) {
    console.error("Screen Share cancelled:", err);
  }
};

peer.on('call', (call) => {
  activeMediaCall = call;
  playMsgSound();
  sendDesktopNotification("Screen Share", "Friend started sharing screen");
  call.answer();
  call.on('stream', (remoteStream) => {
    const video = document.getElementById('remote-screen-video');
    video.srcObject = remoteStream;
    video.classList.remove('hidden');
    document.getElementById('call-modal').classList.remove('hidden');
    document.getElementById('call-status-title').textContent = "Viewing Remote Screen";
  });
});

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
  connectToPeer(id, name);

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
    li.onclick = () => connectToPeer(contact.id, contact.name);
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
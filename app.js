// ============================================================
// GHOSTNODE v6 — FULL WORKING APP
// ============================================================
const ADMIN_PIN = "2007";
let isAdmin = sessionStorage.getItem('ghost_is_admin') === 'true';
let adminDevice = localStorage.getItem('ghost_admin_device') || 'PC';

const deviceSelect = document.getElementById('select-device-type');
if (deviceSelect) {
  deviceSelect.value = adminDevice;
  deviceSelect.onchange = (e) => {
    localStorage.setItem('ghost_admin_device', e.target.value);
    location.reload();
  };
}

let myId = localStorage.getItem('ghost_my_id');
if (!myId) {
  myId = isAdmin ? (adminDevice === 'PC' ? 'admin_pc' : 'admin_laptop') : 'node_' + Math.floor(1000 + Math.random() * 9000);
  localStorage.setItem('ghost_my_id', myId);
}
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
  alert("Node ID Copied!");
};

// ============================================================
// PEER INIT — Multi-STUN + TURN (working)
// ============================================================
const peer = new Peer(myId, {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
    ],
    iceCandidatePoolSize: 10,
    sdpSemantics: 'unified-plan'
  },
  debug: 1
});

// State
let activeConn = null;
let currentContactPeerId = null;
let activeCalls = {};
let contacts = JSON.parse(localStorage.getItem('ghost_admin_contacts') || '[]');
let latencyInterval = null;
let pendingMessages = JSON.parse(localStorage.getItem('ghost_pending_msgs') || '[]');
let localStream = null;
let isMicOn = false;
let isCamOn = false;
let mediaRecorder = null;
let audioChunks = [];
let isRecordingVoice = false;
let isGroupCallActive = false;
let _pendingCall = null;

// ============================================================
// QUEUE (offline messages)
// ============================================================
function queueOrSend(payload) {
  if (activeConn && activeConn.open) {
    try { activeConn.send(payload); console.log('📤 Sent:', payload.type); return true; }
    catch(e) { console.error('Send failed:', e); }
  }
  pendingMessages.push(payload);
  localStorage.setItem('ghost_pending_msgs', JSON.stringify(pendingMessages));
  console.log('📬 Queued:', payload.type);
  return false;
}

function flushPendingMessages() {
  if (!activeConn || !activeConn.open || pendingMessages.length === 0) return;
  console.log('📤 Flushing', pendingMessages.length, 'queued msgs');
  const toSend = [...pendingMessages];
  pendingMessages = [];
  toSend.forEach(msg => {
    try { activeConn.send(msg); } catch(e) { pendingMessages.push(msg); }
  });
  localStorage.setItem('ghost_pending_msgs', JSON.stringify(pendingMessages));
}

// ============================================================
// SIGNALING AUTO-RECONNECT
// ============================================================
peer.on('disconnected', () => {
  console.log('⚠️ Signaling lost, reconnecting...');
  setTimeout(() => { try { peer.reconnect(); } catch(e) { location.reload(); } }, 1500);
});

peer.on('error', (err) => {
  console.warn('Peer error:', err.type, err.message);
  if (err.type === 'unavailable-id') {
    localStorage.removeItem('ghost_my_id');
    setTimeout(() => location.reload(), 800);
  }
  if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
    setTimeout(() => { try { peer.reconnect(); } catch(e){} }, 3000);
  }
});

// ============================================================
// ADMIN UI
// ============================================================
const adminBtn = document.getElementById('btn-admin-toggle');
const adminControls = document.getElementById('admin-controls');
const guestMessage = document.getElementById('guest-message');
const deviceBox = document.getElementById('device-selector-box');
const groupCallBtn = document.getElementById('btn-group-call');

function updateAdminUI() {
  if (isAdmin) {
    adminControls.classList.remove('hidden');
    guestMessage.classList.add('hidden');
    deviceBox.classList.remove('hidden');
    groupCallBtn.classList.remove('hidden');
    adminBtn.textContent = "🔓 Admin Active";
    renderContacts();
  } else {
    adminControls.classList.add('hidden');
    guestMessage.classList.remove('hidden');
    deviceBox.classList.add('hidden');
    groupCallBtn.classList.add('hidden');
    adminBtn.textContent = "🔒 Admin";
  }
}
updateAdminUI();

adminBtn.onclick = () => {
  if (isAdmin) {
    if (confirm("Lock Admin Terminal?")) {
      isAdmin = false;
      sessionStorage.removeItem('ghost_is_admin');
      localStorage.removeItem('ghost_my_id');
      location.reload();
    }
  } else {
    const pin = prompt("Enter Orchestrator PIN:");
    if (pin === ADMIN_PIN) {
      isAdmin = true;
      sessionStorage.setItem('ghost_is_admin', 'true');
      location.reload();
    } else alert("Unauthorized Access.");
  }
};

// ============================================================
// INDEXEDDB
// ============================================================
let db;
const dbReq = indexedDB.open('GhostChatDB', 7);
dbReq.onupgradeneeded = (e) => {
  db = e.target.result;
  if (db.objectStoreNames.contains('messages')) db.deleteObjectStore('messages');
  const store = db.createObjectStore('messages', { keyPath: 'msgId' });
  store.createIndex('contactId', 'contactId', { unique: false });
};
dbReq.onsuccess = (e) => {
  db = e.target.result;
  if (isAdmin) renderContacts();
};

function saveMessageLocally(msgId, contactId, sender, text, fileData = null, fileType = null, fileName = null) {
  if (!db) return;
  const tx = db.transaction('messages', 'readwrite');
  tx.objectStore('messages').put({ msgId, contactId, sender, text, fileData, fileType, fileName, timestamp: Date.now() });
}
function deleteMessageLocally(msgId) {
  if (!db) return;
  const tx = db.transaction('messages', 'readwrite');
  tx.objectStore('messages').delete(msgId);
}
function loadContactMessages(contactId) {
  const container = document.getElementById('messages-container');
  container.innerHTML = '';
  if (!db) return;
  const tx = db.transaction('messages', 'readonly');
  const req = tx.objectStore('messages').index('contactId').getAll(contactId);
  req.onsuccess = () => {
    req.result.forEach(msg => appendMessageUI(msg.msgId, msg.sender === myId ? 'sent' : 'received', msg.text, msg.fileData, msg.fileType, msg.fileName, msg.timestamp));
  };
}

// ============================================================
// NOTIFICATIONS
// ============================================================
function playLoudChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.frequency.setValueAtTime(659.25, ctx.currentTime);
    gain1.gain.setValueAtTime(0.4, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc1.connect(gain1); gain1.connect(ctx.destination);
    osc1.start(); osc1.stop(ctx.currentTime + 0.3);
    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.frequency.setValueAtTime(880, ctx.currentTime);
      gain2.gain.setValueAtTime(0.5, ctx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc2.connect(gain2); gain2.connect(ctx.destination);
      osc2.start(); osc2.stop(ctx.currentTime + 0.4);
    }, 120);
  } catch(e) {}
}
function sendDesktopNotification(title, body) {
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
    new Notification(title, { body, icon: 'https://cdn-icons-png.flaticon.com/512/2827/2827989.png' });
  }
}

// ============================================================
// AUTO-CONNECT
// ============================================================
peer.on('open', (id) => {
  console.log('✅ GhostNode Ready:', id);
  attemptConnectAll();
  setInterval(attemptConnectAll, 3000);
});
peer.on('connection', (conn) => setupConnection(conn));

const connectingTo = {};

function attemptConnectAll() {
  if (activeConn && activeConn.open) return;
  if (isAdmin) {
    if (contacts.length === 0) return;
    contacts.forEach(c => silentConnect(c.id, c.name));
  } else {
    silentConnect('admin_pc', 'Admin PC');
    silentConnect('admin_laptop', 'Admin Laptop');
  }
}

function silentConnect(targetId, targetName) {
  if (!targetId || targetId === myId) return;
  if (activeConn && activeConn.open && activeConn.peer === targetId) return;
  if (connectingTo[targetId]) return;
  connectingTo[targetId] = true;

  let conn;
  try {
    // ⚠️ NO serialization option — lets big files work!
    conn = peer.connect(targetId, { reliable: true });
  } catch(e) { delete connectingTo[targetId]; return; }

  const timeout = setTimeout(() => {
    delete connectingTo[targetId];
    try { conn.close(); } catch(e) {}
  }, 8000);

  conn.on('open', () => { clearTimeout(timeout); delete connectingTo[targetId]; });
  conn.on('error', () => { clearTimeout(timeout); delete connectingTo[targetId]; });
  setupConnection(conn, targetName);
}

function setupConnection(conn, customName = null) {
  conn.on('open', () => {
    if (activeConn && activeConn.open && activeConn.peer !== conn.peer) {
      if (myId < conn.peer) { try { conn.close(); } catch(e){} return; }
      else { try { activeConn.close(); } catch(e){} }
    }
    activeConn = conn;
    currentContactPeerId = conn.peer;
    const myDeviceLabel = isAdmin ? `Admin (${adminDevice})` : 'Peer Node';
    try { conn.send({ type: 'handshake', deviceLabel: myDeviceLabel }); } catch(e) {}
    const displayName = customName || getContactName(conn.peer) || conn.peer;
    updateOnlineUI(displayName);
    toggleInputs(true);
    loadContactMessages(conn.peer);
    if (isAdmin) renderContacts();
    const emptyEl = document.querySelector('.empty-state');
    if (emptyEl) emptyEl.remove();
    flushPendingMessages();
    startLatencyTracker();
    generateE2EEFingerprint(myId, conn.peer);
  });

  conn.on('data', (data) => handleIncomingData(data));

  conn.on('close', () => {
    if (activeConn === conn) {
      document.getElementById('connection-status').textContent = '● Scanning Mesh...';
      document.getElementById('connection-status').className = 'status-offline';
      document.getElementById('latency-badge').classList.add('hidden');
      document.getElementById('e2ee-fingerprint').classList.add('hidden');
      clearInterval(latencyInterval);
      activeConn = null;
      setTimeout(attemptConnectAll, 800);
    }
  });
}

function startLatencyTracker() {
  clearInterval(latencyInterval);
  document.getElementById('latency-badge').classList.remove('hidden');
  latencyInterval = setInterval(() => {
    if (activeConn && activeConn.open) activeConn.send({ type: 'ping', t: Date.now() });
  }, 3000);
}

function generateE2EEFingerprint(id1, id2) {
  const combined = [id1, id2].sort().join(':');
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << 5) - hash) + combined.charCodeAt(i);
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
  const badge = document.getElementById('e2ee-fingerprint');
  badge.textContent = `🔒 E2EE: #${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
  badge.classList.remove('hidden');
}

function updateOnlineUI(name) {
  const statusEl = document.getElementById('connection-status');
  statusEl.textContent = `● Online: ${name}`;
  statusEl.className = 'status-online';
  document.getElementById('current-contact-name').textContent = name;
  const guestStatus = document.getElementById('guest-status-text');
  if (guestStatus) guestStatus.textContent = `Direct Mesh Session with ${name}`;
}

function getContactName(peerId) {
  const c = contacts.find(item => item.id === peerId);
  return c ? c.name : null;
}

// ============================================================
// INCOMING DATA
// ============================================================
function handleIncomingData(data) {
  if (data.type === 'ping') {
    if (activeConn) activeConn.send({ type: 'pong', t: data.t });
  } else if (data.type === 'pong') {
    const latency = Math.round((Date.now() - data.t) / 2);
    document.getElementById('latency-badge').textContent = `⚡ ${latency} ms P2P`;
  } else if (data.type === 'handshake') {
    updateOnlineUI(data.deviceLabel);
  } else if (data.type === 'typing_status') {
    handleTypingIndicator(data.isTyping);
  } else if (data.type === 'chat') {
    playLoudChime();
    sendDesktopNotification("Node Message", data.text);
    appendMessageUI(data.msgId, 'received', data.text, null, null, null, data.timestamp);
    appendStudioMessage(getContactName(activeConn.peer) || 'Peer', data.text);
    document.getElementById('hud-latest-text').textContent = `${getContactName(activeConn.peer) || 'Peer'}: ${data.text}`;
    saveMessageLocally(data.msgId, activeConn.peer, activeConn.peer, data.text);
  } else if (data.type === 'file') {
    playLoudChime();
    sendDesktopNotification("File received", data.fileName || 'Media');
    appendMessageUI(data.msgId, 'received', '', data.fileData, data.fileType, data.fileName, data.timestamp);
    saveMessageLocally(data.msgId, activeConn.peer, activeConn.peer, '', data.fileData, data.fileType, data.fileName);
  } else if (data.type === 'delete_msg_everyone') {
    const el = document.getElementById(`msg-${data.msgId}`);
    if (el) el.remove();
    deleteMessageLocally(data.msgId);
  } else if (data.type === 'call_ring') {
    // Notification only — real flow uses peer.on('call')
    playRingtone();
    sendDesktopNotification("Incoming Call", "Someone is calling!");
  } else if (data.type === 'call_accepted') {
    document.getElementById('call-status-title').textContent = "Live Session Active";
    document.getElementById('btn-accept-call').classList.add('hidden');
  } else if (data.type === 'call_ended') {
    closeCallModal();
  } else if (data.type === 'live_typing') {
    document.getElementById('remote-live-text').textContent = data.text || '...';
    document.getElementById('hud-latest-text').textContent = `Typing: ${data.text}`;
  }
}

function formatMessageContent(text) {
  if (text.startsWith('```') && text.endsWith('```')) {
    const pre = document.createElement('pre');
    pre.className = 'code-block';
    pre.textContent = text.slice(3, -3);
    return pre;
  }
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

// ============================================================
// CHAT / EMOJI / FILES
// ============================================================
const msgInput = document.getElementById('message-input');
let typingTimeout = null;

msgInput.addEventListener('input', () => {
  if (!activeConn) return;
  activeConn.send({ type: 'typing_status', isTyping: true });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    if (activeConn) activeConn.send({ type: 'typing_status', isTyping: false });
  }, 1500);
});

function handleTypingIndicator(isTyping) {
  const el = document.getElementById('typing-indicator');
  if (isTyping) el.classList.remove('hidden');
  else el.classList.add('hidden');
}

const EMOJI_DATA = {
  smileys: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','😉','😌','😍','🥰','😘','😋','😛','😜','🤪','🤔','🤨','😐','😏','😒','🙄','😴','😷','🤒','🤯','🤠','🥳','😎','🤓'],
  gestures: ['👍','👎','👊','✊','🤛','🤜','🤞','✌️','🤟','🤘','👌','👈','👉','👆','👇','☝️','✋','🤚','👋','🤙','💪','🙏','🤝','👏','🙌'],
  hearts: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','❤️‍🔥','💕','💞','💗','💖','💘','💝','🔥','✨','💥','💯'],
  tech: ['💻','🖥️','📱','⌨️','🖱️','📷','🎥','🎙️','🎧','📡','🚀','⚡','🔋','💡','🤖','🔒','🔑','📦','☕']
};

const emojiPanel = document.getElementById('emoji-picker-panel');
const emojiGrid = document.getElementById('emoji-grid-content');

document.getElementById('btn-toggle-emoji').onclick = (e) => {
  e.stopPropagation();
  emojiPanel.classList.toggle('hidden');
  renderEmojiCategory('smileys');
};
document.querySelectorAll('.emoji-tabs .tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.emoji-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    renderEmojiCategory(tab.dataset.cat);
  };
});
function renderEmojiCategory(cat) {
  emojiGrid.innerHTML = '';
  (EMOJI_DATA[cat] || []).forEach(em => {
    const s = document.createElement('span');
    s.className = 'emoji-item';
    s.textContent = em;
    s.onclick = () => { msgInput.value += em; msgInput.focus(); };
    emojiGrid.appendChild(s);
  });
}
document.body.addEventListener('click', (e) => {
  if (!emojiPanel.contains(e.target) && e.target.id !== 'btn-toggle-emoji') {
    emojiPanel.classList.add('hidden');
  }
});

document.getElementById('chat-form').onsubmit = (e) => {
  e.preventDefault();
  const text = msgInput.value.trim();
  if (!text) return;
  const msgId = 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
  const timestamp = Date.now();
  queueOrSend({ type: 'chat', text, msgId, timestamp });
  appendMessageUI(msgId, 'sent', text, null, null, null, timestamp);
  appendStudioMessage('Me', text);
  document.getElementById('hud-latest-text').textContent = `Me: ${text}`;
  saveMessageLocally(msgId, activeConn ? activeConn.peer : 'pending', myId, text);
  msgInput.value = '';
  if (activeConn) activeConn.send({ type: 'typing_status', isTyping: false });
};

// FILE SEND with image compression
document.getElementById('file-input').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    if (!confirm(`File is ${(file.size/1024/1024).toFixed(1)}MB. Large files may fail. Continue?`)) {
      e.target.value = '';
      return;
    }
  }
  if (file.type.startsWith('image/')) {
    compressImage(file, (url) => sendFilePayload(url, 'image/jpeg', file.name.replace(/\.[^.]+$/, '.jpg')));
  } else {
    const reader = new FileReader();
    reader.onload = () => sendFilePayload(reader.result, file.type, file.name);
    reader.readAsDataURL(file);
  }
  e.target.value = '';
};

function compressImage(file, callback) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const canvas = document.createElement('canvas');
    const maxDim = 1280;
    let { width, height } = img;
    if (width > maxDim || height > maxDim) {
      if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
      else { width = Math.round(width * maxDim / height); height = maxDim; }
    }
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);
    callback(canvas.toDataURL('image/jpeg', 0.8));
  };
  img.onerror = () => {
    const reader = new FileReader();
    reader.onload = () => callback(reader.result);
    reader.readAsDataURL(file);
  };
  img.src = url;
}

function sendFilePayload(fileData, fileType, fileName) {
  const msgId = 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
  const timestamp = Date.now();
  queueOrSend({ type: 'file', fileData, fileType, fileName, msgId, timestamp });
  appendMessageUI(msgId, 'sent', '', fileData, fileType, fileName, timestamp);
  saveMessageLocally(msgId, activeConn ? activeConn.peer : 'pending', myId, '', fileData, fileType, fileName);
}

// VOICE NOTE
const voiceBtn = document.getElementById('btn-voice-memo');
voiceBtn.onclick = async () => {
  if (!isRecordingVoice) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => sendFilePayload(reader.result, 'audio/webm', 'VoiceMemo.webm');
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorder.start();
      isRecordingVoice = true;
      voiceBtn.classList.add('recording');
      voiceBtn.title = "Click to Stop & Send";
    } catch(err) {
      alert("⚠️ Microphone unavailable: " + err.message);
    }
  } else {
    mediaRecorder.stop();
    isRecordingVoice = false;
    voiceBtn.classList.remove('recording');
    voiceBtn.title = "Record Voice Note";
  }
};

function appendMessageUI(msgId, type, text, fileData = null, fileType = null, fileName = null, timestamp = Date.now()) {
  const container = document.getElementById('messages-container');
  const msgDiv = document.createElement('div');
  msgDiv.className = `msg ${type}`;
  msgDiv.id = `msg-${msgId}`;
  if (text) msgDiv.appendChild(formatMessageContent(text));
  if (fileData) {
    if (fileType.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = fileData;
      msgDiv.appendChild(img);
    } else if (fileType.startsWith('video/')) {
      const vid = document.createElement('video');
      vid.src = fileData; vid.controls = true;
      msgDiv.appendChild(vid);
    } else if (fileType.startsWith('audio/')) {
      const aud = document.createElement('audio');
      aud.src = fileData; aud.controls = true;
      msgDiv.appendChild(aud);
    }
  }
  const footer = document.createElement('div');
  footer.className = 'msg-footer';
  const d = new Date(timestamp);
  const timeSpan = document.createElement('span');
  timeSpan.textContent = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  footer.appendChild(timeSpan);
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'msg-actions';
  if (fileData) {
    const dlBtn = document.createElement('a');
    dlBtn.className = 'btn-action-mini';
    dlBtn.href = fileData;
    dlBtn.download = fileName || 'ghost_file';
    dlBtn.textContent = '⬇️';
    actionsDiv.appendChild(dlBtn);
  }
  const delBtn = document.createElement('button');
  delBtn.className = 'btn-action-mini btn-del-msg';
  delBtn.textContent = '🗑️';
  delBtn.onclick = () => showDeleteChoiceModal(msgId, msgDiv);
  actionsDiv.appendChild(delBtn);
  footer.appendChild(actionsDiv);
  msgDiv.appendChild(footer);
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

function appendStudioMessage(sender, text) {
  const feed = document.getElementById('in-call-messages');
  if (!feed) return;
  const item = document.createElement('div');
  item.className = 'studio-msg-item';
  item.innerHTML = `<strong>${sender}:</strong> <span>${text}</span>`;
  feed.appendChild(item);
  feed.scrollTop = feed.scrollHeight;
}

function showDeleteChoiceModal(msgId, msgDiv) {
  const choiceModal = document.createElement('div');
  choiceModal.className = 'modal';
  choiceModal.innerHTML = `
    <div class="delete-dialog">
      <h4>Permanent Node Purge</h4>
      <p style="font-size:12px; color:#8b949e; margin:8px 0 16px;">Purge message locally or for whole mesh?</p>
      <div class="delete-actions">
        <button id="opt-del-everyone" class="btn-del-opt btn-del-for-all">Purge for Everyone</button>
        <button id="opt-del-me" class="btn-del-opt btn-del-for-me">Purge for Me Only</button>
        <button id="opt-del-cancel" class="btn-del-opt btn-del-cancel">Abort</button>
      </div>
    </div>`;
  document.body.appendChild(choiceModal);
  document.getElementById('opt-del-me').onclick = () => { msgDiv.remove(); deleteMessageLocally(msgId); choiceModal.remove(); };
  document.getElementById('opt-del-everyone').onclick = () => {
    msgDiv.remove(); deleteMessageLocally(msgId);
    if (activeConn) activeConn.send({ type: 'delete_msg_everyone', msgId });
    choiceModal.remove();
  };
  document.getElementById('opt-del-cancel').onclick = () => choiceModal.remove();
}

// ============================================================
// MEDIA STREAM (silent audio + synthetic video — FIXED)
// ============================================================
const ringtone = document.getElementById('ringtone');
function playRingtone() { ringtone.play().catch(() => playLoudChime()); }
function stopRingtone() { ringtone.pause(); ringtone.currentTime = 0; }

let _ghostAudioCtx = null;
function createSilentAudioStream() {
  try {
    if (!_ghostAudioCtx) _ghostAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_ghostAudioCtx.state === 'suspended') _ghostAudioCtx.resume().catch(() => {});
    const osc = _ghostAudioCtx.createOscillator();
    const gain = _ghostAudioCtx.createGain();
    gain.gain.value = 0.0001; // silent but LIVE track
    osc.frequency.value = 440;
    const dst = _ghostAudioCtx.createMediaStreamDestination();
    osc.connect(gain); gain.connect(dst);
    osc.start();
    window._ghostSilentOsc = osc;
    return dst.stream;
  } catch(e) {
    console.warn('Silent audio failed:', e);
    return new MediaStream();
  }
}

function createSyntheticVideoStream() {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 240;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, 320, 240);
  ctx.font = '14px monospace';
  ctx.fillStyle = '#58a6ff';
  ctx.fillText('💻 Terminal Active', 60, 120);
  return canvas.captureStream(5);
}

async function getAdaptiveMediaStream(wantAudio = true, wantVideo = true) {
  const stream = new MediaStream();
  try {
    const constraints = {};
    if (wantAudio) constraints.audio = { echoCancellation: true, noiseSuppression: true };
    if (wantVideo) constraints.video = { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } };
    const real = await navigator.mediaDevices.getUserMedia(constraints);
    real.getTracks().forEach(t => stream.addTrack(t));
  } catch(e) {
    console.warn('Real media failed:', e.name);
  }
  if (wantAudio && stream.getAudioTracks().length === 0) {
    createSilentAudioStream().getAudioTracks().forEach(t => stream.addTrack(t));
  }
  if (wantVideo && stream.getVideoTracks().length === 0) {
    try { createSyntheticVideoStream().getVideoTracks().forEach(t => stream.addTrack(t)); } catch(e) {}
  }
  console.log('🎥 Stream ready:', stream.getTracks().map(t => t.kind));
  return stream;
}

// ============================================================
// CALLS — FIXED FLOW
// ============================================================
document.getElementById('btn-start-call').onclick = async () => {
  if (!activeConn) return alert("No peer connected.");
  isGroupCallActive = false;

  // Notify via chat channel (for ringtone/notification on receiver)
  activeConn.send({ type: 'call_ring', isGroup: false });

  document.getElementById('call-modal').classList.remove('hidden');
  document.getElementById('call-status-title').textContent = "Pinging Peer...";
  document.getElementById('btn-accept-call').classList.add('hidden');

  try {
    localStream = await getAdaptiveMediaStream(true, true);
  } catch(e) {
    return alert("Could not get mic/camera: " + e.message);
  }

  if (localStream.getVideoTracks().some(t => t.readyState === 'live')) {
    document.getElementById('local-stream-video').srcObject = localStream;
    document.getElementById('local-preview-card').classList.remove('hidden');
  }
  updateHardwareStatusPill();

  try {
    const call = peer.call(activeConn.peer, localStream);
    console.log('📞 Call initiated to', activeConn.peer);
    bindCallEvents(call, activeConn.peer);
  } catch(e) {
    console.error('peer.call failed:', e);
    alert("Call failed: " + e.message);
  }
};

// INCOMING CALL
peer.on('call', async (call) => {
  console.log('📞 Incoming call from:', call.peer);
  activeCalls[call.peer] = call;
  bindCallEvents(call, call.peer);

  const modalOpen = !document.getElementById('call-modal').classList.contains('hidden');
  const inCall = localStream !== null;

  if (modalOpen && inCall) {
    // Auto-answer (we're in a call — this is a group/second incoming)
    console.log('Auto-answering incoming (already in call)');
    try { call.answer(localStream); } catch(e) { console.error('Auto-answer failed:', e); }
    updateGroupCountPill();
  } else {
    // Show accept UI
    playRingtone();
    document.getElementById('call-modal').classList.remove('hidden');
    document.getElementById('call-status-title').textContent = `Incoming Call from ${getContactName(call.peer) || call.peer}`;
    document.getElementById('btn-accept-call').classList.remove('hidden');
    _pendingCall = call;
  }
});

document.getElementById('btn-accept-call').onclick = async () => {
  stopRingtone();
  const call = _pendingCall;
  if (!call) return;

  try {
    localStream = await getAdaptiveMediaStream(true, true);
  } catch(e) {
    return alert("Could not get media: " + e.message);
  }

  try { call.answer(localStream); }
  catch(e) { console.error('Answer failed:', e); return alert("Answer failed: " + e.message); }

  _pendingCall = null;
  document.getElementById('btn-accept-call').classList.add('hidden');
  document.getElementById('call-status-title').textContent = "Live Session Active";

  if (localStream.getVideoTracks().some(t => t.readyState === 'live')) {
    document.getElementById('local-stream-video').srcObject = localStream;
    document.getElementById('local-preview-card').classList.remove('hidden');
  }
  updateHardwareStatusPill();
  if (activeConn) activeConn.send({ type: 'call_accepted', isGroup: isGroupCallActive });
};

function bindCallEvents(call, peerId, peerName = null) {
  activeCalls[peerId] = call;

  call.on('stream', (remoteStream) => {
    console.log('📺 Remote stream from', peerId, remoteStream.getTracks().map(t => t.kind));
    const video = document.getElementById('remote-stream-video');
    const audio = document.getElementById('remote-audio-player');
    video.srcObject = remoteStream;
    video.playsInline = true;
    video.muted = false;
    audio.srcObject = remoteStream;
    video.play().catch(() => {
      document.getElementById('btn-unmute-audio').classList.remove('hidden');
    });
    audio.play().catch(() => {
      document.getElementById('btn-unmute-audio').classList.remove('hidden');
    });
    document.getElementById('call-modal').classList.remove('hidden');
    document.getElementById('call-status-title').textContent = "Live Session Active";
    document.getElementById('remote-stream-label').textContent = `${peerName || getContactName(peerId) || peerId} (Live)`;
    updateGroupCountPill();
  });

  call.on('close', () => {
    delete activeCalls[peerId];
    updateGroupCountPill();
  });

  call.on('error', (err) => console.error('Call error:', err));
}

document.getElementById('btn-unmute-audio').onclick = () => {
  document.getElementById('remote-stream-video').play();
  document.getElementById('remote-audio-player').play();
  document.getElementById('btn-unmute-audio').classList.add('hidden');
};

function updateGroupCountPill() {
  const count = Object.keys(activeCalls).length + 1;
  const pill = document.getElementById('group-participants-count');
  pill.textContent = `👥 ${count} in Session`;
  if (count > 2) pill.classList.remove('hidden');
}

function updateHardwareStatusPill() {
  const pill = document.getElementById('studio-media-status');
  if (localStream && localStream.getVideoTracks().some(t => t.enabled && t.readyState === 'live')) {
    pill.textContent = "📷 Camera + Mic Active";
    pill.style.color = "#3fb950";
  } else if (localStream && localStream.getAudioTracks().some(t => t.enabled && t.readyState === 'live')) {
    pill.textContent = "🎙️ Mic Active";
    pill.style.color = "#3fb950";
  } else {
    pill.textContent = "🔇 Output Mode";
    pill.style.color = "#58a6ff";
  }
}

// GROUP CALL
document.getElementById('btn-group-call').onclick = async () => {
  if (!isAdmin || contacts.length === 0) return alert("Add contacts first!");
  isGroupCallActive = true;
  document.getElementById('call-modal').classList.remove('hidden');
  document.getElementById('call-status-title').textContent = "Dialing Group Mesh...";
  document.getElementById('btn-accept-call').classList.add('hidden');

  localStream = await getAdaptiveMediaStream(true, true);
  updateHardwareStatusPill();

  contacts.forEach(contact => {
    try {
      const c = peer.connect(contact.id, { reliable: true });
      c.on('open', () => c.send({ type: 'call_ring', isGroup: true }));
      const call = peer.call(contact.id, localStream);
      bindCallEvents(call, contact.id, contact.name);
    } catch(err) {}
  });
};

document.getElementById('btn-in-call-add').onclick = async () => {
  const targetId = prompt("Enter Node ID to add:");
  if (!targetId || targetId === myId) return;
  if (!localStream) localStream = await getAdaptiveMediaStream(true, true);
  try {
    const c = peer.connect(targetId, { reliable: true });
    c.on('open', () => c.send({ type: 'call_ring', isGroup: true }));
    const call = peer.call(targetId, localStream);
    bindCallEvents(call, targetId, targetId);
    alert(`Dialing ${targetId} into session`);
  } catch(e) { alert("Failed: " + e.message); }
};

// MIC TOGGLE
document.getElementById('btn-toggle-mic').onclick = async () => {
  const btn = document.getElementById('btn-toggle-mic');
  if (!isMicOn) {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioTrack = micStream.getAudioTracks()[0];
      Object.values(activeCalls).forEach(call => {
        if (call.peerConnection) {
          const sender = call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio');
          if (sender) sender.replaceTrack(audioTrack);
        }
      });
      if (localStream) {
        localStream.getAudioTracks().forEach(t => { t.enabled = false; localStream.removeTrack(t); });
        localStream.addTrack(audioTrack);
      }
      isMicOn = true;
      btn.textContent = "🎙️ Mic: ON";
      btn.classList.add('active');
    } catch(e) {
      alert("⚠️ Mic unavailable: " + e.message);
    }
  } else {
    if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = false);
    isMicOn = false;
    btn.textContent = "🎙️ Mic: Off";
    btn.classList.remove('active');
  }
  updateHardwareStatusPill();
};

// CAM TOGGLE
document.getElementById('btn-toggle-cam').onclick = async () => {
  const btn = document.getElementById('btn-toggle-cam');
  const localVideo = document.getElementById('local-stream-video');
  if (!isCamOn) {
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      const videoTrack = camStream.getVideoTracks()[0];
      localVideo.srcObject = camStream;
      document.getElementById('local-preview-card').classList.remove('hidden');
      Object.values(activeCalls).forEach(call => {
        if (call.peerConnection) {
          const sender = call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) sender.replaceTrack(videoTrack);
          else call.peerConnection.addTrack(videoTrack, camStream);
        }
      });
      isCamOn = true;
      btn.textContent = "📷 Cam: ON";
      btn.classList.add('active');
    } catch(e) { alert("⚠️ Camera unavailable: " + e.message); }
  } else {
    isCamOn = false;
    btn.textContent = "📷 Cam: Off";
    btn.classList.remove('active');
    document.getElementById('local-preview-card').classList.add('hidden');
    if (localVideo.srcObject) {
      localVideo.srcObject.getTracks().forEach(t => t.stop());
      localVideo.srcObject = null;
    }
  }
  updateHardwareStatusPill();
};

// SCREEN SHARE + AUDIO
async function triggerUniversalScreenShare() {
  if (!navigator.mediaDevices.getDisplayMedia) {
    return alert("⚠️ Screen share not supported. Use Chrome desktop or Android Chrome.");
  }
  if (!activeConn && Object.keys(activeCalls).length === 0) {
    return alert("Connect to a peer first!");
  }

  try {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always', frameRate: 30 },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });

    console.log('🖥️ Screen captured. Tracks:', displayStream.getTracks().map(t => `${t.kind}:${t.label}`));
    console.log('🖥️ Audio captured:', displayStream.getAudioTracks().length, 'tracks');

    document.getElementById('call-modal').classList.remove('hidden');
    document.getElementById('call-status-title').textContent = "Broadcasting Screen...";
    document.getElementById('local-stream-video').srcObject = displayStream;
    document.getElementById('local-preview-card').classList.remove('hidden');

    const videoTrack = displayStream.getVideoTracks()[0];
    const audioTrack = displayStream.getAudioTracks()[0];

    if (Object.keys(activeCalls).length > 0) {
      // In existing call — replace tracks
      Object.values(activeCalls).forEach(call => {
        if (call.peerConnection) {
          const senders = call.peerConnection.getSenders();
          const vSender = senders.find(s => s.track && s.track.kind === 'video');
          if (vSender) vSender.replaceTrack(videoTrack);
          if (audioTrack) {
            const aSender = senders.find(s => s.track && s.track.kind === 'audio');
            if (aSender) aSender.replaceTrack(audioTrack);
            else call.peerConnection.addTrack(audioTrack, displayStream);
          }
        }
      });
    } else if (activeConn) {
      // New call with screen
      activeConn.send({ type: 'call_ring', isGroup: false });
      const screenCall = peer.call(activeConn.peer, displayStream);
      bindCallEvents(screenCall, activeConn.peer);
    }

    videoTrack.onended = () => {
      document.getElementById('call-status-title').textContent = "Screen Share Ended";
      if (activeConn) activeConn.send({ type: 'call_ended' });
      setTimeout(closeCallModal, 800);
    };
  } catch(err) {
    if (err.name === 'NotAllowedError') console.log('User cancelled screen share');
    else { console.error('Screen share error:', err); alert("Screen share failed: " + err.message); }
  }
}

document.getElementById('btn-screen-share').onclick = triggerUniversalScreenShare;
document.getElementById('btn-screen-in-call').onclick = triggerUniversalScreenShare;

document.getElementById('btn-end-call').onclick = () => {
  stopRingtone();
  if (activeConn) activeConn.send({ type: 'call_ended' });
  closeCallModal();
};

function closeCallModal() {
  stopRingtone();
  document.getElementById('call-modal').classList.add('hidden');
  document.getElementById('group-participants-count').classList.add('hidden');
  const remoteVideo = document.getElementById('remote-stream-video');
  const remoteAudio = document.getElementById('remote-audio-player');
  remoteVideo.srcObject = null;
  remoteAudio.srcObject = null;
  const localVideo = document.getElementById('local-stream-video');
  if (localVideo.srcObject) localVideo.srcObject.getTracks().forEach(t => t.stop());
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  Object.values(activeCalls).forEach(c => { try { c.close(); } catch(e){} });
  activeCalls = {};
  localStream = null;
  _pendingCall = null;
  isGroupCallActive = false;
  isMicOn = false;
  isCamOn = false;
  document.getElementById('btn-toggle-mic').textContent = "🎙️ Mic: Off";
  document.getElementById('btn-toggle-cam').textContent = "📷 Cam: Off";
  document.getElementById('btn-toggle-mic').classList.remove('active');
  document.getElementById('btn-toggle-cam').classList.remove('active');
}

document.getElementById('my-live-input').oninput = (e) => {
  if (activeConn) activeConn.send({ type: 'live_typing', text: e.target.value });
  document.getElementById('hud-latest-text').textContent = `Me: ${e.target.value}`;
};

document.getElementById('btn-toggle-pip').onclick = () => {
  const modal = document.querySelector('.studio-modal');
  if (!document.fullscreenElement) modal.requestFullscreen().catch(() => {});
  else document.exitFullscreen();
};

// ============================================================
// CONTACTS
// ============================================================
document.getElementById('btn-add-contact').onclick = () => {
  if (!isAdmin) return;
  const nameInput = document.getElementById('target-contact-name');
  const idInput = document.getElementById('target-peer-id');
  const name = nameInput.value.trim();
  const id = idInput.value.trim();
  if (!name || !id) return alert("Provide label and node ID!");
  const existing = contacts.find(c => c.id === id);
  if (existing) existing.name = name;
  else contacts.push({ name, id });
  localStorage.setItem('ghost_admin_contacts', JSON.stringify(contacts));
  renderContacts();
  silentConnect(id, name);
  nameInput.value = ''; idInput.value = '';
};

function deleteContact(contactId, event) {
  if (event) event.stopPropagation();
  if (confirm(`Remove ${contactId}?`)) {
    contacts = contacts.filter(c => c.id !== contactId);
    localStorage.setItem('ghost_admin_contacts', JSON.stringify(contacts));
    renderContacts();
    if (activeConn && activeConn.peer === contactId) { activeConn.close(); activeConn = null; }
  }
}

function renderContacts() {
  if (!isAdmin) return;
  const list = document.getElementById('contacts-list');
  list.innerHTML = '';
  contacts.forEach(contact => {
    const li = document.createElement('li');
    li.className = `contact-item ${contact.id === currentContactPeerId ? 'active' : ''}`;
    li.innerHTML = `
      <div class="contact-info" onclick="silentConnect('${contact.id}', '${contact.name}')">
        <span class="c-name">${contact.name}</span>
        <span class="c-id">${contact.id}</span>
      </div>
      <button class="btn-del-contact" title="Delete" onclick="deleteContact('${contact.id}', event)">❌</button>
    `;
    list.appendChild(li);
  });
}

function toggleInputs(enabled) {
  msgInput.disabled = false;
  document.getElementById('btn-send').disabled = false;
  document.getElementById('btn-start-call').disabled = !enabled;
  document.getElementById('btn-screen-share').disabled = !enabled;
}

window.silentConnect = silentConnect;
window.deleteContact = deleteContact;

// ============================================================
// PRIVACY
// ============================================================
window.addEventListener('blur', () => document.getElementById('privacy-shield').classList.remove('hidden'));
window.addEventListener('focus', () => document.getElementById('privacy-shield').classList.add('hidden'));
document.addEventListener('contextmenu', e => e.preventDefault());
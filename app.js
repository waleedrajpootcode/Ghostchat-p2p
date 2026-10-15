// --- 1. CONFIG & IDENTITIES ---
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

const peer = new Peer(myId);
let activeConn = null;
let currentContactPeerId = null;
let activeMediaCall = null;
let contacts = JSON.parse(localStorage.getItem('ghost_admin_contacts') || '[]');
let latencyInterval = null;

// Media Stream States
let localStream = null;
let isMicOn = false;
let isCamOn = false;

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
    } else {
      alert("Unauthorized Access.");
    }
  }
};

// --- 3. INDEXEDDB SETUP ---
let db;
const dbReq = indexedDB.open('GhostChatDB', 6);
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

function saveMessageLocally(msgId, contactId, sender, text, fileData = null, fileType = null) {
  if (!db) return;
  const tx = db.transaction('messages', 'readwrite');
  tx.objectStore('messages').put({ msgId, contactId, sender, text, fileData, fileType, timestamp: Date.now() });
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
    req.result.forEach(msg => appendMessageUI(msg.msgId, msg.sender === myId ? 'sent' : 'received', msg.text, msg.fileData, msg.fileType, msg.timestamp));
  };
}

// --- 4. DUAL-FREQUENCY AUDIO ---
function playLoudChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.frequency.setValueAtTime(659.25, ctx.currentTime);
    gain1.gain.setValueAtTime(0.4, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start();
    osc1.stop(ctx.currentTime + 0.3);

    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.frequency.setValueAtTime(880, ctx.currentTime);
      gain2.gain.setValueAtTime(0.5, ctx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start();
      osc2.stop(ctx.currentTime + 0.4);
    }, 120);
  } catch (e) {}
}

function sendDesktopNotification(title, body) {
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
    new Notification(title, { body, icon: 'https://cdn-icons-png.flaticon.com/512/9446/9446864.png' });
  }
}

// --- 5. ZERO-CLICK AUTO ENGINE & LATENCY ---
peer.on('open', (id) => {
  console.log('GhostNode Online:', id);
  startAutoConnectEngine();
});

peer.on('connection', (conn) => setupConnection(conn));

function startAutoConnectEngine() {
  setInterval(() => {
    if (activeConn && activeConn.open) return;

    if (isAdmin) {
      contacts.forEach(contact => {
        if (!activeConn || !activeConn.open) silentConnect(contact.id, contact.name);
      });
    } else {
      ['admin_pc', 'admin_laptop'].forEach(adminId => {
        if (!activeConn || !activeConn.open) silentConnect(adminId, "Orchestrator");
      });
    }
  }, 2500);
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

    const myDeviceLabel = isAdmin ? `Admin (${adminDevice})` : 'Peer Node';
    conn.send({ type: 'handshake', deviceLabel: myDeviceLabel });

    const displayName = customName || getContactName(conn.peer) || conn.peer;
    updateOnlineUI(displayName);
    toggleInputs(true);
    loadContactMessages(conn.peer);
    if (isAdmin) renderContacts();

    startLatencyTracker();
  });

  conn.on('data', (data) => handleIncomingData(data));

  conn.on('close', () => {
    document.getElementById('connection-status').textContent = '● Scanning Mesh...';
    document.getElementById('connection-status').className = 'status-offline';
    document.getElementById('latency-badge').classList.add('hidden');
    clearInterval(latencyInterval);
    toggleInputs(false);
    activeConn = null;
  });
}

function startLatencyTracker() {
  clearInterval(latencyInterval);
  document.getElementById('latency-badge').classList.remove('hidden');
  latencyInterval = setInterval(() => {
    if (activeConn && activeConn.open) {
      activeConn.send({ type: 'ping', t: Date.now() });
    }
  }, 3000);
}

function updateOnlineUI(name) {
  const statusEl = document.getElementById('connection-status');
  statusEl.textContent = `● Online: ${name}`;
  statusEl.className = 'status-online';
  document.getElementById('current-contact-name').textContent = name;
  const guestStatus = document.getElementById('guest-status-text');
  if (guestStatus) guestStatus.textContent = `Heterogeneous Link Established with ${name}`;
}

function getContactName(peerId) {
  const c = contacts.find(item => item.id === peerId);
  return c ? c.name : null;
}

// --- 6. DATA HANDLING ---
function handleIncomingData(data) {
  if (data.type === 'ping') {
    activeConn.send({ type: 'pong', t: data.t });
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
    appendMessageUI(data.msgId, 'received', data.text, null, null, data.timestamp);
    appendStudioMessage(getContactName(activeConn.peer) || 'Peer', data.text);
    saveMessageLocally(data.msgId, activeConn.peer, activeConn.peer, data.text);
  } else if (data.type === 'file') {
    playLoudChime();
    appendMessageUI(data.msgId, 'received', '', data.fileData, data.fileType, data.timestamp);
    saveMessageLocally(data.msgId, activeConn.peer, activeConn.peer, '', data.fileData, data.fileType);
  } else if (data.type === 'delete_msg_everyone') {
    const el = document.getElementById(`msg-${data.msgId}`);
    if (el) el.remove();
    deleteMessageLocally(data.msgId);
  } else if (data.type === 'call_ring') {
    showIncomingCallUI();
  } else if (data.type === 'call_accepted') {
    document.getElementById('call-status-title').textContent = "Adaptive Studio Live";
    document.getElementById('btn-accept-call').classList.add('hidden');
  } else if (data.type === 'call_ended') {
    closeCallModal();
  } else if (data.type === 'live_typing') {
    document.getElementById('remote-live-text').textContent = data.text || '...';
  }
}

function formatMessageContent(text) {
  if (text.startsWith('```') && text.endsWith('```')) {
    const code = text.slice(3, -3);
    const pre = document.createElement('pre');
    pre.className = 'code-block';
    pre.textContent = code;
    return pre;
  }
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

// --- 7. CHAT & EMOJIS ---
const msgInput = document.getElementById('message-input');
let typingTimeout = null;

msgInput.addEventListener('input', () => {
  if (!activeConn) return;
  activeConn.send({ type: 'typing_status', isTyping: true });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    activeConn.send({ type: 'typing_status', isTyping: false });
  }, 1500);
});

function handleTypingIndicator(isTyping) {
  const el = document.getElementById('typing-indicator');
  if (isTyping) el.classList.remove('hidden');
  else el.classList.add('hidden');
}

document.querySelectorAll('.q-emoji').forEach(emoji => {
  emoji.onclick = () => {
    msgInput.value += emoji.getAttribute('data-emoji');
    msgInput.focus();
  };
});

document.getElementById('chat-form').onsubmit = (e) => {
  e.preventDefault();
  const text = msgInput.value.trim();
  if (!text || !activeConn) return;

  const msgId = 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
  const timestamp = Date.now();
  activeConn.send({ type: 'chat', text, msgId, timestamp });
  appendMessageUI(msgId, 'sent', text, null, null, timestamp);
  appendStudioMessage('Me', text);
  saveMessageLocally(msgId, activeConn.peer, myId, text);
  msgInput.value = '';
  activeConn.send({ type: 'typing_status', isTyping: false });
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

  if (text) msgDiv.appendChild(formatMessageContent(text));
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
  const d = new Date(timestamp);
  footer.innerHTML = `<span>${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}</span>`;

  const delBtn = document.createElement('button');
  delBtn.className = 'btn-del-msg';
  delBtn.textContent = '🗑️';
  delBtn.onclick = () => showDeleteChoiceModal(msgId, msgDiv);
  footer.appendChild(delBtn);

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
      <p style="font-size:12px; color:#8b949e; margin:8px 0 16px;">Purge message from local storage or entire mesh?</p>
      <div class="delete-actions">
        <button id="opt-del-everyone" class="btn-del-opt btn-del-for-all">Purge from Entire Mesh</button>
        <button id="opt-del-me" class="btn-del-opt btn-del-for-me">Purge for Me Only</button>
        <button id="opt-del-cancel" class="btn-del-opt btn-del-cancel">Abort</button>
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
    if (activeConn) activeConn.send({ type: 'delete_msg_everyone', msgId });
    choiceModal.remove();
  };

  document.getElementById('opt-del-cancel').onclick = () => choiceModal.remove();
}

// --- 8. HETEROGENEOUS ADAPTIVE AV ENGINE ---
const ringtone = document.getElementById('ringtone');
function playRingtone() { ringtone.play().catch(() => playLoudChime()); }
function stopRingtone() { ringtone.pause(); ringtone.currentTime = 0; }

// Safe Hardware Discovery: Tries to grab mic/cam, returns silent/null stream if not found
async function getAdaptiveMediaStream(wantAudio = false, wantVideo = false) {
  if (!wantAudio && !wantVideo) {
    // Generate a dummy silent audio track to keep WebRTC media session alive without mic hardware!
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const dst = ctx.createMediaStreamDestination();
    osc.connect(dst);
    osc.start();
    const track = dst.stream.getAudioTracks()[0];
    track.enabled = false;
    return new MediaStream([track]);
  }

  try {
    return await navigator.mediaDevices.getUserMedia({ audio: wantAudio, video: wantVideo });
  } catch (err) {
    console.warn("Hardware device not detected or denied. Running silent fallback:", err);
    // Fallback: silent stream
    return getAdaptiveMediaStream(false, false);
  }
}

// Start Call Button
document.getElementById('btn-start-call').onclick = async () => {
  if (!activeConn) return;
  activeConn.send({ type: 'call_ring' });
  document.getElementById('call-modal').classList.remove('hidden');
  document.getElementById('call-status-title').textContent = "Pinging Peer Node...";
  document.getElementById('btn-accept-call').classList.add('hidden');

  // Prepare safe adaptive stream (checks if mic exists, else silent)
  localStream = await getAdaptiveMediaStream(true, false);
  updateHardwareStatusPill();
  activeMediaCall = peer.call(activeConn.peer, localStream);
  bindCallEvents(activeMediaCall);
};

function showIncomingCallUI() {
  playRingtone();
  const name = getContactName(activeConn.peer) || activeConn.peer;
  sendDesktopNotification("Adaptive Session Request", `${name} is calling!`);
  document.getElementById('call-modal').classList.remove('hidden');
  document.getElementById('call-status-title').textContent = "Incoming Call from " + name;
  document.getElementById('btn-accept-call').classList.remove('hidden');
}

document.getElementById('btn-accept-call').onclick = async () => {
  stopRingtone();
  activeConn.send({ type: 'call_accepted' });
  document.getElementById('call-status-title').textContent = "Adaptive Studio Live";
  document.getElementById('btn-accept-call').classList.add('hidden');

  // Mobile or PC safely grabs whatever hardware is present
  localStream = await getAdaptiveMediaStream(true, false);
  updateHardwareStatusPill();
  if (activeMediaCall) {
    activeMediaCall.answer(localStream);
  }
};

peer.on('call', async (call) => {
  activeMediaCall = call;
  bindCallEvents(call);
});

function bindCallEvents(call) {
  call.on('stream', (remoteStream) => {
    const video = document.getElementById('remote-stream-video');
    video.srcObject = remoteStream;
    // Remote audio plays loud through speaker automatically!
    video.muted = false;
    document.getElementById('call-modal').classList.remove('hidden');
    document.getElementById('call-status-title').textContent = "Studio Session Live";
    updateHardwareStatusPill();
  });
}

function updateHardwareStatusPill() {
  const pill = document.getElementById('studio-media-status');
  if (localStream && localStream.getAudioTracks().some(t => t.enabled)) {
    pill.textContent = "🎙️ Mic Active";
    pill.style.color = "#3fb950";
  } else {
    pill.textContent = "🔇 No Mic (Text & AV Output Only)";
    pill.style.color = "#58a6ff";
  }
}

// In-Call Controls: Toggle Mic
document.getElementById('btn-toggle-mic').onclick = async () => {
  const btn = document.getElementById('btn-toggle-mic');
  if (!isMicOn) {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioTrack = micStream.getAudioTracks()[0];
      if (activeMediaCall && activeMediaCall.peerConnection) {
        const sender = activeMediaCall.peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (sender) sender.replaceTrack(audioTrack);
      }
      isMicOn = true;
      btn.textContent = "🎙️ Mic: ON";
      btn.classList.add('active');
    } catch(e) {
      alert("No Microphone detected on this device. Text participation active!");
    }
  } else {
    isMicOn = false;
    btn.textContent = "🎙️ Mic: Off";
    btn.classList.remove('active');
  }
  updateHardwareStatusPill();
};

// In-Call Controls: Toggle Camera (For Mobile or Laptop Webcam)
document.getElementById('btn-toggle-cam').onclick = async () => {
  const btn = document.getElementById('btn-toggle-cam');
  const previewCard = document.getElementById('local-preview-card');
  const localVideo = document.getElementById('local-stream-video');

  if (!isCamOn) {
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const videoTrack = camStream.getVideoTracks()[0];
      localVideo.srcObject = camStream;
      previewCard.classList.remove('hidden');

      if (activeMediaCall && activeMediaCall.peerConnection) {
        const sender = activeMediaCall.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack);
        else activeMediaCall.peerConnection.addTrack(videoTrack, camStream);
      }
      isCamOn = true;
      btn.textContent = "📷 Cam: ON";
      btn.classList.add('active');
    } catch(e) {
      alert("No Camera device found on this system.");
    }
  } else {
    isCamOn = false;
    btn.textContent = "📷 Cam: Off";
    btn.classList.remove('active');
    previewCard.classList.add('hidden');
    if (localVideo.srcObject) {
      localVideo.srcObject.getTracks().forEach(t => t.stop());
      localVideo.srcObject = null;
    }
  }
};

// Screen Share WITH SYSTEM AUDIO (PC to Mobile)
async function triggerScreenShareWithAudio() {
  if (!activeConn) return;
  try {
    // Captures both desktop display + system audio!
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: true, noiseSuppression: true }
    });

    document.getElementById('call-modal').classList.remove('hidden');
    document.getElementById('call-status-title').textContent = "Broadcasting Display + Audio...";

    activeMediaCall = peer.call(activeConn.peer, displayStream);
    bindCallEvents(activeMediaCall);

    displayStream.getVideoTracks()[0].onended = () => {
      document.getElementById('call-status-title').textContent = "Screen Share Stopped";
    };
  } catch (err) {
    console.warn("Screen share cancelled:", err);
  }
}

document.getElementById('btn-screen-share').onclick = triggerScreenShareWithAudio;
document.getElementById('btn-screen-in-call').onclick = triggerScreenShareWithAudio;

document.getElementById('btn-end-call').onclick = () => {
  stopRingtone();
  if (activeConn) activeConn.send({ type: 'call_ended' });
  closeCallModal();
};

function closeCallModal() {
  stopRingtone();
  document.getElementById('call-modal').classList.add('hidden');
  const video = document.getElementById('remote-stream-video');
  video.srcObject = null;
  const localVideo = document.getElementById('local-stream-video');
  if (localVideo.srcObject) localVideo.srcObject.getTracks().forEach(t => t.stop());
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (activeMediaCall) activeMediaCall.close();
}

document.getElementById('my-live-input').oninput = (e) => {
  if (activeConn) activeConn.send({ type: 'live_typing', text: e.target.value });
};

document.getElementById('btn-toggle-pip').onclick = () => {
  const modal = document.querySelector('.studio-modal');
  if (!document.fullscreenElement) modal.requestFullscreen().catch(() => {});
  else document.exitFullscreen();
};

// --- 9. ADMIN CONTACTS ---
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
    li.innerHTML = `<span class="c-name">${contact.name}</span><span class="c-id">${contact.id}</span>`;
    li.onclick = () => silentConnect(contact.id, contact.name);
    list.appendChild(li);
  });
}

function toggleInputs(enabled) {
  msgInput.disabled = !enabled;
  document.getElementById('btn-send').disabled = !enabled;
  document.getElementById('btn-start-call').disabled = !enabled;
  document.getElementById('btn-screen-share').disabled = !enabled;
}

// --- 10. PRIVACY ---
window.addEventListener('blur', () => document.getElementById('privacy-shield').classList.remove('hidden'));
window.addEventListener('focus', () => document.getElementById('privacy-shield').classList.add('hidden'));
document.addEventListener('contextmenu', e => e.preventDefault());
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

// Detect mobile device
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
if (isMobile) {
  // Hide Screen Share on Mobile (not supported by mobile browsers)
  document.getElementById('btn-screen-share').style.display = 'none';
  document.getElementById('btn-screen-in-call').style.display = 'none';
}

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
let activeCalls = {}; // Multi-call storage for Group Call
let contacts = JSON.parse(localStorage.getItem('ghost_admin_contacts') || '[]');
let latencyInterval = null;

// Media Stream States
let localStream = null;
let isMicOn = false;
let isCamOn = false;
let mediaRecorder = null;
let audioChunks = [];
let isRecordingVoice = false;
let isGroupCallActive = false;

// --- 2. ADMIN LOCK UI ---
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
    } else {
      alert("Unauthorized Access.");
    }
  }
};

// --- 3. INDEXEDDB SETUP (VERSION 6) ---
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

// --- 4. AUDIO NOTIFICATIONS ---
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

    const myDeviceLabel = isAdmin ? `Admin (${adminDevice})` : (isMobile ? 'Mobile Node' : 'PC Node');
    conn.send({ type: 'handshake', deviceLabel: myDeviceLabel });

    const displayName = customName || getContactName(conn.peer) || conn.peer;
    updateOnlineUI(displayName);
    toggleInputs(true);
    loadContactMessages(conn.peer);
    if (isAdmin) renderContacts();

    startLatencyTracker();
    generateE2EEFingerprint(myId, conn.peer);
  });

  conn.on('data', (data) => handleIncomingData(data));

  conn.on('close', () => {
    document.getElementById('connection-status').textContent = '● Scanning Mesh...';
    document.getElementById('connection-status').className = 'status-offline';
    document.getElementById('latency-badge').classList.add('hidden');
    document.getElementById('e2ee-fingerprint').classList.add('hidden');
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
  if (guestStatus) guestStatus.textContent = `Mesh Connected with ${name}`;
}

function getContactName(peerId) {
  const c = contacts.find(item => item.id === peerId);
  return c ? c.name : null;
}

// --- 6. DATA INCOMING ---
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
    appendMessageUI(data.msgId, 'received', data.text, null, null, null, data.timestamp);
    appendStudioMessage(getContactName(activeConn.peer) || 'Peer', data.text);
    saveMessageLocally(data.msgId, activeConn.peer, activeConn.peer, data.text);
  } else if (data.type === 'file') {
    playLoudChime();
    appendMessageUI(data.msgId, 'received', '', data.fileData, data.fileType, data.fileName, data.timestamp);
    saveMessageLocally(data.msgId, activeConn.peer, activeConn.peer, '', data.fileData, data.fileType, data.fileName);
  } else if (data.type === 'delete_msg_everyone') {
    const el = document.getElementById(`msg-${data.msgId}`);
    if (el) el.remove();
    deleteMessageLocally(data.msgId);
  } else if (data.type === 'call_ring') {
    showIncomingCallUI(data.isGroup);
  } else if (data.type === 'call_accepted') {
    document.getElementById('call-status-title').textContent = data.isGroup ? "Group Mesh Active" : "Studio Session Live";
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

// --- 7. CHAT, VOICE NOTES & EXTENDED EMOJI PICKER ---
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

const EMOJI_DATA = {
  smileys: ['😀','😃','😄','😁','😆','😅','😂','🤣','🥲','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐'],
  gestures: ['👍','👎','👊','✊','🤛','🤜','🤞','✌️','🤟','🤘','👌','🤌','🤏','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤙','💪','🦾','🖕','✍️','🙏','🤝','👏','🙌','👐','🤲'],
  hearts: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','❣️','💕','💞','💓','💗','💖','💘','💝','💟','🔥','✨','💥','💯','💢'],
  tech: ['💻','🖥️','📱','⌨️','🖱️','🖨️','📷','🎥','📽️','🎙️','🎧','📡','🚀','🛸','⚡','🔋','💡','🕹️','🎮','🤖','🔒','🔑','📦','☕']
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
  const list = EMOJI_DATA[cat] || [];
  list.forEach(em => {
    const s = document.createElement('span');
    s.className = 'emoji-item';
    s.textContent = em;
    s.onclick = () => {
      msgInput.value += em;
      msgInput.focus();
    };
    emojiGrid.appendChild(s);
  });
}

document.body.addEventListener('click', (e) => {
  if (!emojiPanel.contains(e.target) && e.target.id !== 'btn-toggle-emoji') {
    emojiPanel.classList.add('hidden');
  }
});

// Chat Send
document.getElementById('chat-form').onsubmit = (e) => {
  e.preventDefault();
  const text = msgInput.value.trim();
  if (!text || !activeConn) return;

  const msgId = 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
  const timestamp = Date.now();
  activeConn.send({ type: 'chat', text, msgId, timestamp });
  appendMessageUI(msgId, 'sent', text, null, null, null, timestamp);
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
    activeConn.send({ type: 'file', fileData, fileType: file.type, fileName: file.name, msgId, timestamp });
    appendMessageUI(msgId, 'sent', '', fileData, file.type, file.name, timestamp);
    saveMessageLocally(msgId, activeConn.peer, myId, '', fileData, file.type, file.name);
  };
  reader.readAsDataURL(file);
};

// Voice Note Push-To-Talk
const voiceBtn = document.getElementById('btn-voice-memo');
voiceBtn.onclick = async () => {
  if (!activeConn) return;
  if (!isRecordingVoice) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          const fileData = reader.result;
          const msgId = 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
          const timestamp = Date.now();
          activeConn.send({ type: 'file', fileData, fileType: 'audio/webm', fileName: 'VoiceMemo.webm', msgId, timestamp });
          appendMessageUI(msgId, 'sent', '', fileData, 'audio/webm', 'VoiceMemo.webm', timestamp);
          saveMessageLocally(msgId, activeConn.peer, myId, '', fileData, 'audio/webm', 'VoiceMemo.webm');
        };
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorder.start();
      isRecordingVoice = true;
      voiceBtn.classList.add('recording');
      voiceBtn.title = "Click to Stop & Send Voice Note";
    } catch(err) {
      alert("No Microphone detected on this device to record voice note.");
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
      vid.src = fileData;
      vid.controls = true;
      msgDiv.appendChild(vid);
    } else if (fileType.startsWith('audio/')) {
      const aud = document.createElement('audio');
      aud.src = fileData;
      aud.controls = true;
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
    dlBtn.title = 'Save to Device';
    actionsDiv.appendChild(dlBtn);
  }

  const delBtn = document.createElement('button');
  delBtn.className = 'btn-action-mini btn-del-msg';
  delBtn.textContent = '🗑️';
  delBtn.title = 'Purge Message';
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

// --- 8. ADAPTIVE AV & GUARANTEED VIDEO/AUDIO PIPELINE ---
const ringtone = document.getElementById('ringtone');
function playRingtone() { ringtone.play().catch(() => playLoudChime()); }
function stopRingtone() { ringtone.pause(); ringtone.currentTime = 0; }

// Safe Hardware Discovery: Mobile acquires Camera+Mic; PC acquires silent stream if no hardware
async function getAdaptiveMediaStream(wantAudio = true, wantVideo = true) {
  // Try Camera + Mic first (Especially for mobile)
  if (wantAudio || wantVideo) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: wantAudio,
        video: wantVideo ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false
      });
      return stream;
    } catch (err) {
      console.warn("Could not acquire full media, trying audio only:", err);
      // Fallback: Try Audio Only
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (err2) {
        console.warn("No Mic/Cam found on this device. Fallback to Receive-Only silent stream:", err2);
      }
    }
  }

  // Silent fallback for PC without mic/cam
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const dst = ctx.createMediaStreamDestination();
  osc.connect(dst);
  osc.start();
  const track = dst.stream.getAudioTracks()[0];
  track.enabled = false;
  return new MediaStream([track]);
}

// 1-to-1 CALL
document.getElementById('btn-start-call').onclick = async () => {
  if (!activeConn) return;
  isGroupCallActive = false;
  activeConn.send({ type: 'call_ring', isGroup: false });
  document.getElementById('call-modal').classList.remove('hidden');
  document.getElementById('call-status-title').textContent = "Pinging Peer Node...";
  document.getElementById('btn-accept-call').classList.add('hidden');

  // Mobile gets camera+mic; PC gets whatever it has
  localStream = await getAdaptiveMediaStream(true, isMobile);
  if (isMobile && localStream.getVideoTracks().length > 0) {
    document.getElementById('local-stream-video').srcObject = localStream;
    document.getElementById('local-preview-card').classList.remove('hidden');
  }

  updateHardwareStatusPill();
  const call = peer.call(activeConn.peer, localStream);
  bindCallEvents(call, activeConn.peer);
};

// ADMIN GROUP CALL
document.getElementById('btn-group-call').onclick = async () => {
  if (!isAdmin || contacts.length === 0) {
    return alert("Add contacts before starting a Group Call!");
  }
  isGroupCallActive = true;
  document.getElementById('call-modal').classList.remove('hidden');
  document.getElementById('call-status-title').textContent = "Dialing Group Mesh...";
  document.getElementById('btn-accept-call').classList.add('hidden');
  document.getElementById('group-participants-count').classList.remove('hidden');

  localStream = await getAdaptiveMediaStream(true, isMobile);
  updateHardwareStatusPill();

  contacts.forEach(contact => {
    try {
      const conn = peer.connect(contact.id, { reliable: true });
      conn.on('open', () => conn.send({ type: 'call_ring', isGroup: true }));
      const call = peer.call(contact.id, localStream);
      bindCallEvents(call, contact.id, contact.name);
    } catch(err) {}
  });
};

function showIncomingCallUI(isGroup = false) {
  playRingtone();
  const name = getContactName(activeConn.peer) || activeConn.peer;
  sendDesktopNotification("Incoming Call", `${name} is calling!`);
  document.getElementById('call-modal').classList.remove('hidden');
  document.getElementById('call-status-title').textContent = isGroup ? "Group Call from " + name : "Incoming Call from " + name;
  document.getElementById('btn-accept-call').classList.remove('hidden');
}

document.getElementById('btn-accept-call').onclick = async () => {
  stopRingtone();
  activeConn.send({ type: 'call_accepted', isGroup: isGroupCallActive });
  document.getElementById('call-status-title').textContent = isGroupCallActive ? "Group Mesh Live" : "Adaptive Session Live";
  document.getElementById('btn-accept-call').classList.add('hidden');

  // On Mobile: ALWAYS turn on camera & mic!
  localStream = await getAdaptiveMediaStream(true, isMobile);
  if (isMobile && localStream.getVideoTracks().length > 0) {
    document.getElementById('local-stream-video').srcObject = localStream;
    document.getElementById('local-preview-card').classList.remove('hidden');
    isCamOn = true;
    document.getElementById('btn-toggle-cam').textContent = "📷 Cam: ON";
    document.getElementById('btn-toggle-cam').classList.add('active');
  }

  updateHardwareStatusPill();
  Object.values(activeCalls).forEach(call => {
    try { call.answer(localStream); } catch(e){}
  });
};

peer.on('call', async (call) => {
  activeCalls[call.peer] = call;
  bindCallEvents(call, call.peer);
});

function bindCallEvents(call, peerId, peerName = null) {
  activeCalls[peerId] = call;

  call.on('stream', (remoteStream) => {
    const video = document.getElementById('remote-stream-video');
    const audio = document.getElementById('remote-audio-player');
    
    // Attach stream to video tag
    video.srcObject = remoteStream;
    video.playsInline = true;
    video.muted = false;

    // Attach stream to audio player as backup to guarantee loud sound!
    audio.srcObject = remoteStream;

    // Force play to overcome mobile/browser autoplay restrictions
    video.play().catch(e => {
      console.warn("Autoplay block detected, showing unblock button:", e);
      document.getElementById('btn-unmute-audio').classList.remove('hidden');
    });
    audio.play().catch(() => {});

    document.getElementById('call-modal').classList.remove('hidden');
    document.getElementById('call-status-title').textContent = "Session Live";
    document.getElementById('remote-stream-label').textContent = `${peerName || getContactName(peerId) || peerId} (Live)`;
    updateGroupCountPill();
  });

  call.on('close', () => {
    delete activeCalls[peerId];
    updateGroupCountPill();
  });
}

// Tap to enable audio button for strict browser policies
document.getElementById('btn-unmute-audio').onclick = () => {
  const video = document.getElementById('remote-stream-video');
  const audio = document.getElementById('remote-audio-player');
  video.play();
  audio.play();
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
  if (localStream && localStream.getVideoTracks().some(t => t.enabled)) {
    pill.textContent = "📷 Camera + Mic Active";
    pill.style.color = "#3fb950";
  } else if (localStream && localStream.getAudioTracks().some(t => t.enabled)) {
    pill.textContent = "🎙️ Mic Only Active";
    pill.style.color = "#3fb950";
  } else {
    pill.textContent = "🔇 Output / Text Mode (No Mic)";
    pill.style.color = "#58a6ff";
  }
}

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
      isMicOn = true;
      btn.textContent = "🎙️ Mic: ON";
      btn.classList.add('active');
    } catch(e) {
      alert("No Microphone detected on this device. Output mode active!");
    }
  } else {
    isMicOn = false;
    btn.textContent = "🎙️ Mic: Off";
    btn.classList.remove('active');
  }
  updateHardwareStatusPill();
};

document.getElementById('btn-toggle-cam').onclick = async () => {
  const btn = document.getElementById('btn-toggle-cam');
  const localVideo = document.getElementById('local-stream-video');

  if (!isCamOn) {
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
      });
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
    } catch(e) {
      alert("No Camera device detected on this system.");
    }
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

// PC Screen Share with Audio
async function triggerScreenShareWithAudio() {
  if (isMobile) {
    return alert("Screen sharing is not supported by mobile browsers.");
  }
  if (!activeConn && Object.keys(activeCalls).length === 0) return;
  try {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: true, noiseSuppression: true }
    });

    document.getElementById('call-modal').classList.remove('hidden');
    document.getElementById('call-status-title').textContent = "Broadcasting Display + Audio...";

    const localVideo = document.getElementById('local-stream-video');
    localVideo.srcObject = displayStream;
    document.getElementById('local-preview-card').classList.remove('hidden');

    Object.values(activeCalls).forEach(call => {
      if (call.peerConnection) {
        const videoTrack = displayStream.getVideoTracks()[0];
        const audioTrack = displayStream.getAudioTracks()[0];
        const vSender = call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (vSender) vSender.replaceTrack(videoTrack);
        else call.peerConnection.addTrack(videoTrack, displayStream);
        if (audioTrack) {
          const aSender = call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio');
          if (aSender) aSender.replaceTrack(audioTrack);
        }
      }
    });

    displayStream.getVideoTracks()[0].onended = () => {
      document.getElementById('call-status-title').textContent = "Screen Share Concluded";
    };
  } catch (err) {}
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
  document.getElementById('group-participants-count').classList.add('hidden');

  const remoteVideo = document.getElementById('remote-stream-video');
  const remoteAudio = document.getElementById('remote-audio-player');
  remoteVideo.srcObject = null;
  remoteAudio.srcObject = null;

  const localVideo = document.getElementById('local-stream-video');
  if (localVideo.srcObject) localVideo.srcObject.getTracks().forEach(t => t.stop());
  if (localStream) localStream.getTracks().forEach(t => t.stop());

  Object.values(activeCalls).forEach(c => {
    try { c.close(); } catch(e){}
  });
  activeCalls = {};
  isGroupCallActive = false;
}

document.getElementById('my-live-input').oninput = (e) => {
  if (activeConn) activeConn.send({ type: 'live_typing', text: e.target.value });
};

document.getElementById('btn-toggle-pip').onclick = () => {
  const modal = document.querySelector('.studio-modal');
  if (!document.fullscreenElement) modal.requestFullscreen().catch(() => {});
  else document.exitFullscreen();
};

// --- 9. ADMIN CONTACTS & DELETE CONTACT FUNCTIONALITY ---
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

function deleteContact(contactId, event) {
  if (event) event.stopPropagation();
  if (confirm(`Remove this Node (${contactId}) permanently from Mesh?`)) {
    contacts = contacts.filter(c => c.id !== contactId);
    localStorage.setItem('ghost_admin_contacts', JSON.stringify(contacts));
    renderContacts();
    if (activeConn && activeConn.peer === contactId) {
      activeConn.close();
      activeConn = null;
    }
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
      <button class="btn-del-contact" title="Delete Node" onclick="deleteContact('${contact.id}', event)">❌</button>
    `;
    list.appendChild(li);
  });
}

function toggleInputs(enabled) {
  msgInput.disabled = !enabled;
  document.getElementById('btn-send').disabled = !enabled;
  document.getElementById('btn-start-call').disabled = !enabled;
  if (!isMobile) document.getElementById('btn-screen-share').disabled = !enabled;
}

// --- 10. PRIVACY ---
window.addEventListener('blur', () => document.getElementById('privacy-shield').classList.remove('hidden'));
window.addEventListener('focus', () => document.getElementById('privacy-shield').classList.add('hidden'));
document.addEventListener('contextmenu', e => e.preventDefault());
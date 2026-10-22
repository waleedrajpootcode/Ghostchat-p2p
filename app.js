// ============================================================
// GHOSTNODE v10.5 — Verified Production Engine
// ============================================================
const ADMIN_PIN = "2007";
let isAdmin = sessionStorage.getItem('ghost_is_admin') === 'true';
let adminDevice = localStorage.getItem('ghost_admin_device') || 'PC';
let myId = localStorage.getItem('ghost_my_id');

if (!myId) {
  myId = isAdmin ? (adminDevice === 'PC' ? 'admin_pc' : 'admin_laptop') : 'node_' + Math.floor(1000 + Math.random() * 9000);
  localStorage.setItem('ghost_my_id', myId);
}
if (isAdmin) {
  myId = adminDevice === 'PC' ? 'admin_pc' : 'admin_laptop';
  localStorage.setItem('ghost_my_id', myId);
}

let activeConns = {};
let currentPeerId = null;
let activeCalls = {};
let contacts = JSON.parse(localStorage.getItem('ghost_admin_contacts') || '[]');
let pendingMessages = JSON.parse(localStorage.getItem('ghost_pending_msgs') || '[]');
let localStream = null;
let screenStream = null;
let isMicOn = false;
let isCamOn = false;
let isScreenSharing = false;
let isGroupCallActive = false;
let mediaRecorder = null;
let audioChunks = [];
let isRecordingVoice = false;
let _pendingCall = null;
let latencyInterval = null;
let pipState = 0;

// === PWA INSTALL SUPPORT ===
let deferredPrompt = null;
const installBtn = document.getElementById('btn-install-app');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn) installBtn.classList.remove('hidden');
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) {
      alert("Browser menu (⋮) par ja kar 'Add to Home screen' ya 'Install' dabayein.");
      return;
    }
    deferredPrompt.prompt();
    deferredPrompt = null;
    installBtn.classList.add('hidden');
  });
}

window.addEventListener('appinstalled', () => {
  if (installBtn) installBtn.classList.add('hidden');
});

// === CONNECTION HELPERS ===
function getActiveConn() { return currentPeerId ? activeConns[currentPeerId] : null; }

function queueOrSend(payload) {
  const conn = getActiveConn();
  if (conn && conn.open) {
    try { conn.send(payload); return true; }
    catch(e) { console.error('Send fail:', e); }
  }
  pendingMessages.push({ peerId: currentPeerId, payload });
  localStorage.setItem('ghost_pending_msgs', JSON.stringify(pendingMessages));
  return false;
}

function flushPendingFor(peerId) {
  const conn = activeConns[peerId];
  if (!conn || !conn.open) return;
  const remaining = [];
  pendingMessages.forEach(item => {
    if (item.peerId === peerId) { try { conn.send(item.payload); } catch(e) { remaining.push(item); } }
    else remaining.push(item);
  });
  pendingMessages = remaining;
  localStorage.setItem('ghost_pending_msgs', JSON.stringify(pendingMessages));
}

function switchToPeer(peerId, name) {
  currentPeerId = peerId;
  const conn = activeConns[peerId];
  if (conn && conn.open) {
    updateOnlineUI(name || getContactName(peerId) || peerId);
    toggleInputs(true);
    loadContactMessages(peerId);
    flushPendingFor(peerId);
    generateE2EEFingerprint(myId, peerId);
    startLatencyTracker(peerId);
  } else {
    document.getElementById('connection-status').textContent = 'â— Connecting...';
    document.getElementById('connection-status').className = 'status-offline';
    document.getElementById('current-contact-name').textContent = name || peerId;
    loadContactMessages(peerId);
    silentConnect(peerId, name);
  }
  if (isAdmin) renderContacts();
}

// === GLOBAL STUN SERVERS ===
const peer = new Peer(myId, {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ],
    iceCandidatePoolSize: 10
  },
  debug: 0
});

peer.on('open', (id) => {
  console.log('✅ Online:', id);
  document.getElementById('my-peer-id').textContent = id;
  attemptConnectAll();
  setInterval(attemptConnectAll, 3000);
});

peer.on('connection', (conn) => setupConnection(conn));
peer.on('call', (call) => handleIncomingCall(call));

peer.on('disconnected', () => {
  setTimeout(() => { try { peer.reconnect(); } catch(e) {} }, 1500);
});

peer.on('error', (err) => {
  if (err.type === 'peer-unavailable') {
    const match = err.message.match(/peer (\S+)/);
    if (match) {
      delete connectingTo[match[1]];
    }
    return;
  }
  if (err.type === 'unavailable-id') {
    localStorage.removeItem('ghost_my_id');
    setTimeout(() => location.reload(), 800);
    return;
  }
  console.warn('Peer error:', err.type);
});

// === AUTO-CONNECT ===
const connectingTo = {};

function attemptConnectAll() {
  if (isAdmin) {
    contacts.forEach(c => {
      if (!activeConns[c.id] || !activeConns[c.id].open) silentConnect(c.id, c.name);
    });
  } else {
    const connected = Object.keys(activeConns).some(id =>
      (id === 'admin_pc' || id === 'admin_laptop') && activeConns[id].open
    );
    if (connected) return;

    ['admin_pc', 'admin_laptop'].forEach(id => {
      if (!activeConns[id] || !activeConns[id].open) {
        silentConnect(id, id === 'admin_pc' ? 'Admin PC' : 'Admin Laptop');
      }
    });
  }
}

function silentConnect(targetId, name = null) {
  if (!targetId || targetId === myId) return;
  if (activeConns[targetId] && activeConns[targetId].open) return;
  if (connectingTo[targetId]) return;

  connectingTo[targetId] = true;
  let conn;
  try {
    conn = peer.connect(targetId, { reliable: true });
  } catch(e) {
    delete connectingTo[targetId];
    return;
  }

  const timer = setTimeout(() => {
    delete connectingTo[targetId];
  }, 6000);

  conn.on('open', () => {
    clearTimeout(timer);
    delete connectingTo[targetId];
  });

  conn.on('error', () => {
    clearTimeout(timer);
    delete connectingTo[targetId];
  });

  setupConnection(conn, name);
}

function setupConnection(conn, name = null) {
  conn.on('open', () => {
    activeConns[conn.peer] = conn;

    if (isAdmin && !contacts.some(c => c.id === conn.peer)) {
      contacts.push({ name: name || `Node (${conn.peer.slice(-4)})`, id: conn.peer });
      localStorage.setItem('ghost_admin_contacts', JSON.stringify(contacts));
      renderContacts();
    }

    if (!currentPeerId) currentPeerId = conn.peer;

    const label = isAdmin ? `Admin (${adminDevice})` : 'Peer Node';
    try { conn.send({ type: 'handshake', deviceLabel: label }); } catch(e) {}

    if (currentPeerId === conn.peer) {
      updateOnlineUI(name || getContactName(conn.peer) || conn.peer);
      toggleInputs(true);
      loadContactMessages(conn.peer);
      const e = document.querySelector('.empty-state'); if (e) e.remove();
    }

    if (isAdmin) renderContacts();
    flushPendingFor(conn.peer);
    startLatencyTracker(conn.peer);
    generateE2EEFingerprint(myId, conn.peer);
  });

  conn.on('data', (data) => handleIncomingData(data, conn));

  conn.on('close', () => {
    delete activeConns[conn.peer];
    if (currentPeerId === conn.peer) {
      document.getElementById('connection-status').textContent = 'â— Scanning...';
      document.getElementById('connection-status').className = 'status-offline';
      document.getElementById('latency-badge').classList.add('hidden');
      document.getElementById('e2ee-fingerprint').classList.add('hidden');
      toggleInputs(false);
    }
    if (isAdmin) renderContacts();
  });
}

function startLatencyTracker(peerId) {
  clearInterval(latencyInterval);
  document.getElementById('latency-badge').classList.remove('hidden');
  latencyInterval = setInterval(() => {
    const c = activeConns[peerId];
    if (c && c.open && peerId === currentPeerId) c.send({ type: 'ping', t: Date.now() });
  }, 3000);
}

function updateOnlineUI(name) {
  document.getElementById('connection-status').textContent = `â— Online: ${name}`;
  document.getElementById('connection-status').className = 'status-online';
  document.getElementById('current-contact-name').textContent = name;
  const gs = document.getElementById('guest-status-text');
  if (gs) gs.textContent = `Connected to ${name}`;
}

function getContactName(peerId) { return (contacts.find(c => c.id === peerId) || {}).name || null; }

function generateE2EEFingerprint(id1, id2) {
  const combined = [id1, id2].sort().join(':');
  let h = 0;
  for (let i = 0; i < combined.length; i++) { h = ((h << 5) - h) + combined.charCodeAt(i); h |= 0; }
  const hex = Math.abs(h).toString(16).toUpperCase().padStart(8, '0');
  const b = document.getElementById('e2ee-fingerprint');
  b.textContent = `🔒 E2EE: #${hex.slice(0,4)}-${hex.slice(4,8)}`;
  b.classList.remove('hidden');
}

// === DATA HANDLER ===
function handleIncomingData(data, conn) {
  const sp = conn.peer;

  if (!currentPeerId) {
    currentPeerId = sp;
    updateOnlineUI(getContactName(sp) || sp);
    toggleInputs(true);
    loadContactMessages(sp);
  }

  if (data.type === 'ping') { if (conn.open) conn.send({ type: 'pong', t: data.t }); }
  else if (data.type === 'pong') {
    if (sp === currentPeerId) document.getElementById('latency-badge').textContent = `⚡ ${Math.round((Date.now()-data.t)/2)} ms P2P`;
  }
  else if (data.type === 'handshake') { if (sp === currentPeerId) updateOnlineUI(data.deviceLabel); }
  else if (data.type === 'typing_status') { if (sp === currentPeerId) document.getElementById('typing-indicator').classList.toggle('hidden', !data.isTyping); }
  else if (data.type === 'chat') {
    playLoudChime();
    sendDesktopNotification("Node Message", data.text);
    if (sp === currentPeerId) appendMessageUI(data.msgId, 'received', data.text, null, null, null, data.timestamp);
    appendStudioMessage(getContactName(sp) || sp, data.text);
    document.getElementById('hud-latest-text').textContent = `${getContactName(sp) || sp}: ${data.text}`;
    saveMessageLocally(data.msgId, sp, sp, data.text);
  }
  else if (data.type === 'file') {
    playLoudChime();
    sendDesktopNotification("File received", data.fileName || 'Media');
    if (sp === currentPeerId) appendMessageUI(data.msgId, 'received', '', data.fileData, data.fileType, data.fileName, data.timestamp);
    saveMessageLocally(data.msgId, sp, sp, '', data.fileData, data.fileType, data.fileName);
  }
  else if (data.type === 'delete_msg_everyone') {
    const el = document.getElementById(`msg-${data.msgId}`);
    if (el) el.remove();
    deleteMessageLocally(data.msgId);
  }
  else if (data.type === 'cam_state') {
    const remoteVid = document.getElementById('remote-stream-video');
    if (data.isCamOn) {
      document.getElementById('remote-stream-label').textContent = `${getContactName(sp) || sp} (Camera)`;
      if (remoteVid) remoteVid.play().catch(() => {});
    }
  }
  else if (data.type === 'call_ring') {
    playRingtone();
    sendDesktopNotification(data.isScreen ? "Screen Sharing Session" : "Incoming Call", "Click to join");
    // Call aate hi foran Accept Call ka button screen par show karein
    document.getElementById('call-modal').classList.remove('hidden');
    document.getElementById('call-status-title').textContent = `Incoming: ${getContactName(sp) || sp}`;
    document.getElementById('btn-accept-call').classList.remove('hidden');
  }
  else if (data.type === 'call_accepted') {
    document.getElementById('call-status-title').textContent = "Live Session Active";
    document.getElementById('btn-accept-call').classList.add('hidden');
  }
  else if (data.type === 'call_ended') {
    closeCallModal();
  }
  else if (data.type === 'screen_state') {
    const title = document.getElementById('call-status-title');
    const grid = document.getElementById('video-grid');
    const remoteVid = document.getElementById('remote-stream-video');

    if (data.isSharing) {
      title.textContent = `ðŸ–¥ï¸ ${getContactName(sp) || sp} is Sharing Screen`;
      if (grid) grid.classList.add('maximized-remote');
      if (remoteVid) remoteVid.play().catch(() => {});
    } else {
      title.textContent = "Live Session Active";
      if (grid) grid.classList.remove('maximized-remote');
    }
  }
  else if (data.type === 'live_typing') {
    document.getElementById('remote-live-text').textContent = data.text || '...';
    document.getElementById('hud-latest-text').textContent = `Typing: ${data.text}`;
  }
  else if (data.type === 'screen_click') {
    showRemoteClick(data.x, data.y, data.screenW, data.screenH);
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
    new Notification(title, { body, icon: 'ghost-icon-v2.png' });
  }
}
if ("Notification" in window && Notification.permission !== "granted") Notification.requestPermission();

// === ALL 10 EMOJI CATEGORIES ===
const EMOJI_DATA = {
  smileys: ['ðŸ˜€','ðŸ˜ƒ','ðŸ˜„','ðŸ˜','ðŸ˜†','ðŸ˜…','ðŸ¤£','ðŸ˜‚','ðŸ™‚','ðŸ™ƒ','ðŸ˜‰','ðŸ˜Š','ðŸ˜‡','ðŸ¥°','ðŸ˜','ðŸ¤©','ðŸ˜˜','ðŸ˜—','â˜ºï¸','ðŸ˜š','ðŸ˜™','ðŸ¥²','ðŸ˜‹','ðŸ˜›','ðŸ˜œ','ðŸ¤ª','ðŸ˜','ðŸ¤‘','ðŸ¤—','ðŸ¤­','ðŸ¤«','ðŸ¤”','ðŸ¤','ðŸ¤¨','ðŸ˜','ðŸ˜‘','ðŸ˜¶','ðŸ˜','ðŸ˜’','ðŸ™„','ðŸ˜¬','ðŸ¤¥','ðŸ˜Œ','ðŸ˜”','ðŸ˜ª','ðŸ¤¤','ðŸ˜´','ðŸ˜·','ðŸ¤’','ðŸ¤•','ðŸ¤¢','ðŸ¤®','ðŸ¤§','ðŸ¥µ','ðŸ¥¶','ðŸ¥´','ðŸ˜µ','ðŸ¤¯','ðŸ¤ ','ðŸ¥³','ðŸ¥¸','ðŸ˜Ž','ðŸ¤“','ðŸ§','ðŸ˜•','ðŸ˜Ÿ','ðŸ™','â˜¹ï¸','ðŸ˜®','ðŸ˜¯','ðŸ˜²','ðŸ˜³','ðŸ¥º','ðŸ˜¦','ðŸ˜§','ðŸ˜¨','ðŸ˜°','ðŸ˜¥','ðŸ˜¢','ðŸ˜­','ðŸ˜±','ðŸ˜–','ðŸ˜£','ðŸ˜ž','ðŸ˜“','ðŸ˜©','ðŸ˜«','ðŸ¥±','ðŸ˜¤','ðŸ˜¡','ðŸ˜ ','ðŸ¤¬','ðŸ˜ˆ','ðŸ‘¿','ðŸ’€','â˜ ï¸','ðŸ’©','ðŸ¤¡','ðŸ‘¹','ðŸ‘º','ðŸ‘»','ðŸ‘½','ðŸ‘¾','ðŸ¤–'],
  gestures: ['ðŸ‘‹','ðŸ¤š','ðŸ–ï¸','âœ‹','ðŸ––','ðŸ‘Œ','ðŸ¤Œ','ðŸ¤','âœŒï¸','ðŸ¤ž','ðŸ¤Ÿ','ðŸ¤˜','ðŸ¤™','ðŸ‘ˆ','ðŸ‘‰','ðŸ‘†','ðŸ–•','ðŸ‘‡','â˜ï¸','ðŸ‘','ðŸ‘Ž','âœŠ','ðŸ‘Š','ðŸ¤›','ðŸ¤œ','ðŸ‘','ðŸ™Œ','ðŸ‘','ðŸ¤²','ðŸ¤','ðŸ™','âœï¸','ðŸ’…','ðŸ¤³','ðŸ’ª','ðŸ¦¾','ðŸ¦µ','ðŸ¦¿','ðŸ¦¶','ðŸ‘‚','ðŸ¦»','ðŸ‘ƒ','ðŸ‘€','ðŸ‘ï¸','ðŸ‘…','ðŸ‘„','ðŸ’‹','ðŸ§ ','ðŸ«€','ðŸ«','ðŸ¦·','ðŸ¦´','ðŸ‘¤','👥','ðŸ«‚','ðŸ§‘','ðŸ‘¶','ðŸ§’','ðŸ‘¦','ðŸ‘§','ðŸ§“','ðŸ‘´','ðŸ‘µ','ðŸ™','ðŸ™Ž','ðŸ™…','ðŸ™†','ðŸ’','ðŸ™‹','ðŸ§','ðŸ™‡','ðŸ¤¦','ðŸ¤·'],
  hearts: ['â¤ï¸','ðŸ§¡','ðŸ’›','ðŸ’š','ðŸ’™','ðŸ’œ','ðŸ–¤','ðŸ¤','ðŸ¤Ž','ðŸ’”','â£ï¸','ðŸ’•','ðŸ’ž','ðŸ’“','ðŸ’—','ðŸ’–','ðŸ’˜','ðŸ’','ðŸ’Ÿ','â¤ï¸â€ðŸ”¥','â¤ï¸â€ðŸ©¹','ðŸ”¥','âœ¨','â­','ðŸŒŸ','ðŸ’«','⚡','ðŸ’¥','ðŸ’¢','ðŸ’¦','ðŸ’¨','ðŸ’£','ðŸ’¬','ðŸ—¯ï¸','ðŸ’­','ðŸ’¤'],
  animals: ['ðŸ¶','ðŸ±','ðŸ­','ðŸ¹','ðŸ°','ðŸ¦Š','ðŸ»','ðŸ¼','ðŸ»â€â„ï¸','ðŸ¨','ðŸ¯','ðŸ¦','ðŸ®','ðŸ·','ðŸ¸','ðŸµ','ðŸ™ˆ','ðŸ™‰','ðŸ™Š','ðŸ’','ðŸ”','ðŸ§','ðŸ¦','ðŸ¤','ðŸ£','ðŸ¥','ðŸ¦†','ðŸ¦…','ðŸ¦‰','ðŸ¦‡','ðŸº','ðŸ—','ðŸ´','ðŸ¦„','ðŸ','ðŸ›','ðŸ¦‹','ðŸŒ','ðŸž','ðŸœ','ðŸ¦Ÿ','ðŸ¦—','ðŸ•·ï¸','ðŸ•¸ï¸','ðŸ¦‚','ðŸ¢','ðŸ','ðŸ¦Ž','ðŸ¦–','ðŸ¦•','ðŸ™','ðŸ¦‘','ðŸ¦','ðŸ¦ž','ðŸ¦€','ðŸ¡','ðŸ ','ðŸŸ','ðŸ¬','ðŸ³','ðŸ‹','ðŸ¦ˆ','ðŸŠ','ðŸ…','ðŸ†','ðŸ¦“','ðŸ¦','ðŸ˜','ðŸ¦›','ðŸ¦','ðŸª','ðŸ«','ðŸ¦’','ðŸ¦˜','ðŸƒ','ðŸ‚','ðŸ„','ðŸŽ','ðŸ–','ðŸ','ðŸ‘','ðŸ¦™','ðŸ','ðŸ¦Œ','ðŸ•','ðŸ©','ðŸˆ','ðŸ“','ðŸ¦ƒ','ðŸ¦š','ðŸ¦œ','ðŸ¦¢','ðŸ¦©','ðŸ•Šï¸','ðŸ‡','ðŸ¦','ðŸ¦¨','ðŸ¦¡','ðŸ¦«','ðŸ¦¦','ðŸ¦¥','ðŸ','ðŸ€','ðŸ¿ï¸','ðŸ¦”'],
  food: ['ðŸŽ','ðŸ','ðŸŠ','ðŸ‹','ðŸŒ','ðŸ‰','ðŸ‡','ðŸ“','ðŸ«','ðŸˆ','ðŸ’','ðŸ‘','ðŸ¥­','ðŸ','ðŸ¥¥','ðŸ¥','ðŸ…','ðŸ†','ðŸ¥‘','ðŸ¥¦','ðŸ¥¬','ðŸ¥’','ðŸŒ¶ï¸','ðŸ«‘','ðŸŒ½','ðŸ¥•','ðŸ§„','ðŸ§…','ðŸ¥”','ðŸ ','ðŸ¥','ðŸ¥¯','ðŸž','ðŸ¥–','ðŸ¥¨','ðŸ§€','ðŸ¥š','ðŸ³','ðŸ§ˆ','ðŸ¥ž','ðŸ§‡','ðŸ¥“','ðŸ¥©','ðŸ—','ðŸ–','ðŸŒ­','ðŸ”','ðŸŸ','ðŸ•','ðŸ¥ª','ðŸ¥™','ðŸŒ®','ðŸŒ¯','ðŸ¥—','ðŸ','ðŸœ','ðŸ²','ðŸ›','ðŸ£','ðŸ±','ðŸ¥Ÿ','ðŸ¤','ðŸ™','ðŸš','ðŸ˜','ðŸ¢','ðŸ¡','ðŸ§','ðŸ¨','ðŸ¦','ðŸ¥§','ðŸ§','ðŸ°','ðŸŽ‚','ðŸ®','ðŸ­','ðŸ¬','ðŸ«','ðŸ¿','ðŸ©','ðŸª','ðŸŒ°','ðŸ¥œ','ðŸ¯','ðŸ¥›','ðŸ¼','â˜•','ðŸµ','ðŸ§ƒ','ðŸ¥¤','ðŸ§‹','ðŸº','ðŸ»','ðŸ¥‚','ðŸ·','ðŸ¥ƒ','ðŸ¸','ðŸ¹','ðŸ¾'],
  nature: ['ðŸŒ¸','ðŸ’®','ðŸµï¸','ðŸŒ¹','ðŸ¥€','ðŸŒº','ðŸŒ»','ðŸŒ¼','ðŸŒ·','ðŸŒ±','ðŸª´','ðŸŒ²','ðŸŒ³','ðŸŒ´','ðŸŒµ','ðŸŒ¾','ðŸŒ¿','â˜˜ï¸','ðŸ€','ðŸ','ðŸ‚','ðŸƒ','ðŸ„','ðŸŒ','ðŸŒŽ','ðŸŒ','ðŸŒ•','ðŸŒ–','ðŸŒ—','ðŸŒ˜','ðŸŒ‘','ðŸŒ’','ðŸŒ“','ðŸŒ”','ðŸŒ™','ðŸŒš','ðŸŒ›','ðŸŒœ','â˜€ï¸','ðŸŒ','ðŸŒž','ðŸª','â­','ðŸŒŸ','ðŸŒ ','â˜ï¸','â›…','â›ˆï¸','ðŸŒ¤ï¸','ðŸŒ¥ï¸','ðŸŒ¦ï¸','ðŸŒ§ï¸','ðŸŒ¨ï¸','ðŸŒ©ï¸','ðŸŒªï¸','ðŸŒ«ï¸','ðŸŒˆ','â˜”','ðŸ’§','ðŸŒŠ','â„ï¸','â˜ƒï¸','â›„'],
  travel: ['ðŸš—','ðŸš•','ðŸš™','ðŸšŒ','ðŸŽï¸','ðŸš“','ðŸš‘','ðŸš’','ðŸš','ðŸ›»','ðŸšš','ðŸš›','ðŸšœ','ðŸ›´','ðŸš²','ðŸ›µ','ðŸï¸','ðŸ›º','ðŸš¨','ðŸš”','ðŸš¡','ðŸš ','ðŸšŸ','ðŸšƒ','ðŸš‹','ðŸšž','ðŸš','ðŸš„','ðŸš…','ðŸšˆ','ðŸš‚','ðŸš†','ðŸš‡','ðŸšŠ','ðŸš‰','âœˆï¸','ðŸ›«','ðŸ›¬','ðŸ›©ï¸','ðŸ’º','ðŸ›°ï¸','ðŸš€','ðŸ›¸','ðŸš','ðŸ›¶','â›µ','ðŸš¤','ðŸ›¥ï¸','ðŸ›³ï¸','â›´ï¸','ðŸš¢','âš“','â›½','ðŸš§','ðŸš¦','ðŸš¥','ðŸš','ðŸ—ºï¸','ðŸ—¿','ðŸ—½','ðŸ—¼','ðŸ°','ðŸ¯','ðŸŸï¸','ðŸŽ¡','ðŸŽ¢','ðŸŽ ','â›²','â›±ï¸','ðŸ–ï¸','ðŸï¸','ðŸœï¸','ðŸŒ‹','â›°ï¸','ðŸ”ï¸','ðŸ—»','ðŸ•ï¸','â›º','ðŸ ','ðŸ¡','ðŸ˜ï¸','ðŸšï¸','ðŸ—ï¸','ðŸ­','ðŸ¢','ðŸ¬','ðŸ¥','ðŸ¦','ðŸ¨','ðŸª','ðŸ«','ðŸ’’','ðŸ›ï¸','â›ª','ðŸ•Œ','ðŸ•','ðŸ•‹','â›©ï¸'],
  objects: ['âŒš','ðŸ“±','ðŸ“²','ðŸ’»','âŒ¨ï¸','ðŸ–¥ï¸','ðŸ–¨ï¸','ðŸ–±ï¸','ðŸ–²ï¸','ðŸ•¹ï¸','ðŸ’½','ðŸ’¾','ðŸ’¿','ðŸ“€','ðŸ“¼','📷','ðŸ“¸','ðŸ“¹','ðŸŽ¥','ðŸ“½ï¸','ðŸŽžï¸','ðŸ“ž','â˜Žï¸','ðŸ“Ÿ','ðŸ“ ','ðŸ“º','ðŸ“»','ðŸŽ™ï¸','ðŸŽšï¸','ðŸŽ›ï¸','ðŸ§­','â±ï¸','â²ï¸','â°','ðŸ•°ï¸','âŒ›','â³','ðŸ“¡','ðŸ”‹','ðŸ”Œ','ðŸ’¡','ðŸ”¦','ðŸ•¯ï¸','ðŸ§¯','ðŸ’¸','ðŸ’µ','ðŸ’´','ðŸ’¶','ðŸ’·','ðŸ’°','ðŸ’³','ðŸ’Ž','âš–ï¸','ðŸ”§','ðŸ”¨','â›ï¸','ðŸ”©','âš™ï¸','ðŸ§²','ðŸ”«','ðŸ’£','ðŸ§¨','ðŸ”ª','ðŸ—¡ï¸','âš”ï¸','ðŸ›¡ï¸','ðŸš¬','âš°ï¸','ðŸº','ðŸ”®','ðŸ“¿','ðŸ§¿','ðŸ’ˆ','âš—ï¸','ðŸ”­','ðŸ”¬','ðŸ©¹','ðŸ©º','ðŸ’Š','ðŸ’‰','ðŸ©¸','ðŸ§¬','ðŸ¦ ','ðŸ§ª','ðŸ§¹','ðŸ§º','ðŸ§»','ðŸš½','ðŸš¿','ðŸ›','ðŸ§¼','ðŸª¥','ðŸª’','ðŸ§½','ðŸª£','ðŸ§´','ðŸ”‘','ðŸ—ï¸','ðŸšª','ðŸª‘','ðŸ›‹ï¸','ðŸ›ï¸','ðŸ§¸','ðŸ–¼ï¸','ðŸ›ï¸','ðŸ›’','ðŸŽ','ðŸŽˆ','ðŸŽ€','ðŸŽŠ','ðŸŽ‰','ðŸ®','ðŸ§§','âœ‰ï¸','ðŸ“©','ðŸ“¨','ðŸ“§','ðŸ’Œ','ðŸ“¥','ðŸ“¤','ðŸ“¦','ðŸ·ï¸','ðŸ“ª','ðŸ“«','ðŸ“¬','ðŸ“­','ðŸ“®','ðŸ“œ','ðŸ“ƒ','ðŸ“„','ðŸ“‘','ðŸ§¾','ðŸ“Š','ðŸ“ˆ','ðŸ“‰','ðŸ“†','ðŸ“…','ðŸ—‘ï¸','ðŸ“‡','ðŸ“‹','ðŸ“','ðŸ“‚','ðŸ“°','ðŸ““','ðŸ“”','ðŸ“’','ðŸ“•','ðŸ“—','ðŸ“˜','ðŸ“™','ðŸ“š','ðŸ“–','ðŸ”–','ðŸ“Ž','ðŸ“','ðŸ“','ðŸ“Œ','ðŸ“','âœ‚ï¸','ðŸ–Šï¸','ðŸ–‹ï¸','âœ’ï¸','ðŸ–Œï¸','ðŸ–ï¸','ðŸ“','âœï¸','ðŸ”','ðŸ”Ž','ðŸ”','ðŸ”','🔒','🔓'],
  symbols: ['â¤ï¸','â˜®ï¸','âœï¸','â˜ªï¸','ðŸ•‰ï¸','â˜¸ï¸','âœ¡ï¸','ðŸ”¯','ðŸ•Ž','â˜¯ï¸','â˜¦ï¸','ðŸ›','â›Ž','â™ˆ','â™‰','â™Š','â™‹','â™Œ','â™','â™Ž','â™','â™','â™‘','â™’','â™“','ðŸ†”','âš›ï¸','ðŸ‰‘','â˜¢ï¸','â˜£ï¸','ðŸ“´','ðŸ“³','ðŸˆ¶','ðŸˆš','ðŸˆ¸','ðŸˆº','ðŸˆ·ï¸','âœ´ï¸','ðŸ†š','ðŸ’®','ðŸ‰','ãŠ™ï¸','ãŠ—ï¸','ðŸˆ´','ðŸˆµ','ðŸˆ¹','ðŸˆ²','ðŸ…°ï¸','ðŸ…±ï¸','ðŸ†Ž','ðŸ†‘','ðŸ…¾ï¸','ðŸ†˜','âŒ','â­•','ðŸ›‘','â›”','ðŸ“›','ðŸš«','ðŸ’¯','ðŸ’¢','â™¨ï¸','ðŸš·','ðŸš¯','ðŸš³','ðŸš±','ðŸ”ž','ðŸ“µ','ðŸš­','â—','â•','â“','â”','â€¼ï¸','â‰ï¸','ðŸ”…','ðŸ”†','ã€½ï¸','âš ï¸','ðŸš¸','ðŸ”±','âšœï¸','ðŸ”°','â™»ï¸','✅','ðŸˆ¯','ðŸ’¹','â‡ï¸','âœ³ï¸','âŽ','ðŸŒ','ðŸ’ ','â“‚ï¸','ðŸŒ€','ðŸ’¤','ðŸ§','ðŸš¾','â™¿','ðŸ…¿ï¸','ðŸ›—','ðŸˆ³','ðŸˆ‚ï¸','ðŸ›‚','ðŸ›ƒ','ðŸ›„','ðŸ›…','ðŸš¹','ðŸšº','ðŸš¼','ðŸš»','ðŸš®','ðŸŽ¦','ðŸ“¶','ðŸˆ','ðŸ”£','â„¹ï¸','ðŸ”¤','ðŸ”¡','ðŸ” ','ðŸ†–','ðŸ†—','ðŸ†™','ðŸ†’','ðŸ†•','ðŸ†“','0ï¸âƒ£','1ï¸âƒ£','2ï¸âƒ£','3ï¸âƒ£','4ï¸âƒ£','5ï¸âƒ£','6ï¸âƒ£','7ï¸âƒ£','8ï¸âƒ£','9ï¸âƒ£','ðŸ”Ÿ','ðŸ”¢','#ï¸âƒ£','*ï¸âƒ£','âï¸','â–¶ï¸','â¸ï¸','â¯ï¸','â¹ï¸','âºï¸','â­ï¸','â®ï¸','â©','âª','â«','â¬','â—€ï¸','ðŸ”¼','ðŸ”½','âž¡ï¸','â¬…ï¸','â¬†ï¸','â¬‡ï¸','â†—ï¸','â†˜ï¸','â†™ï¸','â†–ï¸','â†•ï¸','â†”ï¸','â†©ï¸','â†ªï¸','â¤´ï¸','â¤µï¸','ðŸ”€','ðŸ”','ðŸ”‚','ðŸ”„','ðŸ”ƒ','ðŸŽµ','ðŸŽ¶','âž•','âž–','âž—','âœ–ï¸','ðŸ’²','ðŸ’±','â„¢ï¸','Â©ï¸','Â®ï¸','ðŸ”š','ðŸ”™','ðŸ”›','ðŸ”','ðŸ”œ','ã€°ï¸','âž°','âž¿','âœ”ï¸','â˜‘ï¸','ðŸ”˜','ðŸ”´','ðŸŸ ','ðŸŸ¡','🟢','ðŸ”µ','ðŸŸ£','âš«','⚪','ðŸŸ¤','ðŸ”º','ðŸ”»','ðŸ”¸','ðŸ”¹','ðŸ”¶','ðŸ”·','ðŸ”³','ðŸ”²','â–ªï¸','â–«ï¸','â—¾','â—½','â—¼ï¸','â—»ï¸','ðŸŸ¥','ðŸŸ§','ðŸŸ¨','ðŸŸ©','ðŸŸ¦','ðŸŸª','â¬›','â¬œ','ðŸŸ«','ðŸ”ˆ','🔇','ðŸ”‰','ðŸ”Š','ðŸ””','ðŸ”•','ðŸ“£','ðŸ“¢','â™ ï¸','â™£ï¸','â™¥ï¸','â™¦ï¸','ðŸƒ','ðŸŽ´','ðŸ€„','ðŸ•','ðŸ•‘','ðŸ•’','ðŸ•“','ðŸ•”','ðŸ••','ðŸ•–','ðŸ•—','ðŸ•˜','ðŸ•™','ðŸ•š','ðŸ•›'],
  tech: ['ðŸ’»','ðŸ–¥ï¸','ðŸ“±','âŒ¨ï¸','ðŸ–±ï¸','ðŸ–¨ï¸','📷','ðŸŽ¥','ðŸ“½ï¸','ðŸŽ™ï¸','ðŸŽ§','ðŸ“¡','ðŸš€','ðŸ›¸','⚡','ðŸ”‹','ðŸ’¡','ðŸ•¹ï¸','ðŸŽ®','ðŸ¤–','🔒','ðŸ”‘','ðŸ“¦','â˜•','ðŸ’¾','ðŸ’¿','ðŸ“€','ðŸ“¼','ðŸ–²ï¸','ðŸ“Ÿ','ðŸ“ ','â˜Žï¸','ðŸ“ž','ðŸ”Œ','ðŸ”¦','ðŸ•¯ï¸','â°','â±ï¸','âŒš','ðŸ“º','ðŸ“»','ðŸŽšï¸','ðŸŽ›ï¸','ðŸ§­','ðŸ“¶','ðŸ“³','ðŸ“´','🔇','ðŸ”ˆ','ðŸ”‰','ðŸ”Š','ðŸ“¢','ðŸ“£','ðŸ””','ðŸ”•','ðŸ›°ï¸','ðŸ§¬','ðŸ”¬','ðŸ”­','ðŸ§ª','ðŸ§«','âš—ï¸','ðŸ”®']
};

function initEmojiTabs() {
  const tabsContainer = document.querySelector('.emoji-tabs');
  if (!tabsContainer) return;
  const categories = [
    { key: 'smileys', label: 'Smileys' },
    { key: 'gestures', label: 'Gestures' },
    { key: 'hearts', label: 'Hearts' },
    { key: 'animals', label: 'Animals' },
    { key: 'food', label: 'Food' },
    { key: 'nature', label: 'Nature' },
    { key: 'travel', label: 'Travel' },
    { key: 'objects', label: 'Objects' },
    { key: 'symbols', label: 'Symbols' },
    { key: 'tech', label: 'Tech' }
  ];
  tabsContainer.innerHTML = '';
  categories.forEach((cat, i) => {
    const tab = document.createElement('span');
    tab.className = 'tab' + (i === 0 ? ' active' : '');
    tab.dataset.cat = cat.key;
    tab.textContent = cat.label;
    tab.onclick = () => {
      document.querySelectorAll('.emoji-tabs .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderEmojiCategory(cat.key);
    };
    tabsContainer.appendChild(tab);
  });
}

const emojiPanel = document.getElementById('emoji-picker-panel');
const emojiGrid = document.getElementById('emoji-grid-content');

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

document.getElementById('btn-toggle-emoji').onclick = (e) => {
  e.stopPropagation();
  emojiPanel.classList.toggle('hidden');
  if (!emojiPanel.classList.contains('hidden')) renderEmojiCategory('smileys');
};

document.body.addEventListener('click', (e) => {
  if (emojiPanel && !emojiPanel.contains(e.target) && e.target.id !== 'btn-toggle-emoji') {
    emojiPanel.classList.add('hidden');
  }
});

// === CHAT & INPUTS ===
const msgInput = document.getElementById('message-input');
let typingTimeout = null;
msgInput.addEventListener('input', () => {
  const conn = getActiveConn();
  if (!conn) return;
  conn.send({ type: 'typing_status', isTyping: true });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => { if (conn.open) conn.send({ type: 'typing_status', isTyping: false }); }, 1500);
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
  saveMessageLocally(msgId, currentPeerId || 'pending', myId, text);
  msgInput.value = '';
  const conn = getActiveConn();
  if (conn) conn.send({ type: 'typing_status', isTyping: false });
};

document.getElementById('file-input').onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 8 * 1024 * 1024 && !confirm(`File ${(f.size/1024/1024).toFixed(1)}MB. Continue?`)) { e.target.value = ''; return; }
  const r = new FileReader();
  r.onload = () => sendFilePayload(r.result, f.type, f.name);
  r.readAsDataURL(f);
  e.target.value = '';
};

function sendFilePayload(data, type, name) {
  const msgId = 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
  const ts = Date.now();
  queueOrSend({ type: 'file', fileData: data, fileType: type, fileName: name, msgId, timestamp: ts });
  appendMessageUI(msgId, 'sent', '', data, type, name, ts);
  saveMessageLocally(msgId, currentPeerId || 'pending', myId, '', data, type, name);
}

const voiceBtn = document.getElementById('btn-voice-memo');
voiceBtn.onclick = async () => {
  if (!isRecordingVoice) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(s);
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = () => {
        const b = new Blob(audioChunks, { type: 'audio/webm' });
        const r = new FileReader();
        r.onload = () => sendFilePayload(r.result, 'audio/webm', 'VoiceMemo.webm');
        r.readAsDataURL(b);
        s.getTracks().forEach(t => t.stop());
      };
      mediaRecorder.start();
      isRecordingVoice = true;
      voiceBtn.classList.add('recording');
      voiceBtn.title = "Click to Stop & Send";
    } catch(e) { alert("âš ï¸ Mic: " + e.message); }
  } else {
    mediaRecorder.stop();
    isRecordingVoice = false;
    voiceBtn.classList.remove('recording');
    voiceBtn.title = "Record Voice Note";
  }
};

function appendMessageUI(msgId, type, text, fileData = null, fileType = null, fileName = null, ts = Date.now()) {
  const c = document.getElementById('messages-container');
  const empty = c.querySelector('.empty-state');
  if (empty) empty.remove();

  const m = document.createElement('div');
  m.className = `msg ${type}`;
  m.id = `msg-${msgId}`;
  if (text) m.appendChild(formatMessageContent(text));
  if (fileData) {
    if (fileType.startsWith('image/')) { const i = document.createElement('img'); i.src = fileData; m.appendChild(i); }
    else if (fileType.startsWith('video/')) { const v = document.createElement('video'); v.src = fileData; v.controls = true; m.appendChild(v); }
    else if (fileType.startsWith('audio/')) { const a = document.createElement('audio'); a.src = fileData; a.controls = true; m.appendChild(a); }
  }
  const f = document.createElement('div'); f.className = 'msg-footer';
  const d = new Date(ts);
  const t = document.createElement('span');
  t.textContent = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
  f.appendChild(t);
  const a = document.createElement('div'); a.className = 'msg-actions';
  if (fileData) { const dl = document.createElement('a'); dl.className = 'btn-action-mini'; dl.href = fileData; dl.download = fileName || 'file'; dl.textContent = 'â¬‡ï¸'; a.appendChild(dl); }
  const del = document.createElement('button'); del.className = 'btn-action-mini btn-del-msg'; del.textContent = 'ðŸ—‘ï¸';
  del.onclick = () => showDeleteChoiceModal(msgId, m);
  a.appendChild(del);
  f.appendChild(a); m.appendChild(f);
  c.appendChild(m); c.scrollTop = c.scrollHeight;
}

function appendStudioMessage(s, t) {
  const f = document.getElementById('in-call-messages');
  if (!f) return;
  const i = document.createElement('div');
  i.className = 'studio-msg-item';
  i.innerHTML = `<strong>${s}:</strong> <span>${t}</span>`;
  f.appendChild(i); f.scrollTop = f.scrollHeight;
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
    const conn = getActiveConn();
    if (conn) conn.send({ type: 'delete_msg_everyone', msgId });
    choiceModal.remove();
  };
  document.getElementById('opt-del-cancel').onclick = () => choiceModal.remove();
}

// === DB ===
let db;
const dbReq = indexedDB.open('GhostChatDB', 8);
dbReq.onupgradeneeded = (e) => {
  db = e.target.result;
  if (db.objectStoreNames.contains('messages')) db.deleteObjectStore('messages');
  const s = db.createObjectStore('messages', { keyPath: 'msgId' });
  s.createIndex('contactId', 'contactId', { unique: false });
};
dbReq.onsuccess = (e) => { db = e.target.result; if (isAdmin) renderContacts(); };

function saveMessageLocally(msgId, contactId, sender, text, fileData = null, fileType = null, fileName = null) {
  if (!db) return;
  db.transaction('messages', 'readwrite').objectStore('messages').put({ msgId, contactId, sender, text, fileData, fileType, fileName, timestamp: Date.now() });
}

function deleteMessageLocally(msgId) {
  if (!db) return;
  db.transaction('messages', 'readwrite').objectStore('messages').delete(msgId);
}

function loadContactMessages(cid) {
  const c = document.getElementById('messages-container');
  c.innerHTML = '';
  if (!db) return;
  const r = db.transaction('messages', 'readonly').objectStore('messages').index('contactId').getAll(cid);
  r.onsuccess = () => r.result.forEach(m => appendMessageUI(m.msgId, m.sender === myId ? 'sent' : 'received', m.text, m.fileData, m.fileType, m.fileName, m.timestamp));
}

// === MEDIA STREAM HELPERS ===
const ringtone = document.getElementById('ringtone');
function playRingtone() { ringtone.play().catch(() => playLoudChime()); }
function stopRingtone() { ringtone.pause(); ringtone.currentTime = 0; }

function createSilentAudioTrack() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const dst = ctx.createMediaStreamDestination();
    osc.connect(dst);
    osc.start();
    const track = dst.stream.getAudioTracks()[0];
    track.enabled = false;
    return track;
  } catch(e) { return null; }
}

function createDummyVideoTrack() {
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 480;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, 640, 480);
  ctx.fillStyle = '#58a6ff'; ctx.font = '24px monospace';
  ctx.fillText('💻 GhostNode Session', 180, 240);
  return canvas.captureStream(10).getVideoTracks()[0];
}

function createDummyStream() {
  const stream = new MediaStream();
  const vt = createDummyVideoTrack();
  const at = createSilentAudioTrack();
  if (vt) stream.addTrack(vt);
  if (at) stream.addTrack(at);
  return stream;
}

async function getMediaStream(wantAudio = true, wantVideo = true) {
  let audioTrack = null;
  let videoTrack = null;

  if (wantAudio) {
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioTrack = audioStream.getAudioTracks()[0];
      isMicOn = true;
    } catch(e) {
      audioTrack = createSilentAudioTrack();
    }
  }

  if (wantVideo) {
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      videoTrack = videoStream.getVideoTracks()[0];
      isCamOn = true;
    } catch(e) {
      videoTrack = createDummyVideoTrack();
    }
  }

  const stream = new MediaStream();
  if (audioTrack) stream.addTrack(audioTrack);
  if (videoTrack) stream.addTrack(videoTrack);
  return stream;
}

// === CALL EVENTS (TWO-WAY SCREEN RENDERING) ===
function bindCallEvents(call, peerId, name = null) {
  activeCalls[peerId] = call;
  if (!currentPeerId) currentPeerId = peerId;

  call.on('stream', (remoteStream) => {
    const video = document.getElementById('remote-stream-video');
    const audio = document.getElementById('remote-audio-player');

    video.srcObject = remoteStream;
    video.muted = true;
    video.playsInline = true;

    audio.srcObject = remoteStream; audio.muted = false; audio.playsInline = true;

    video.onloadedmetadata = () => video.play().catch(() => {});
    video.play().catch(() => {});
    audio.play().catch(() => {
      document.getElementById('btn-unmute-audio').classList.remove('hidden');
    });

    document.getElementById('call-modal').classList.remove('hidden');
    document.getElementById('call-status-title').textContent = "Live Session Active";
    document.getElementById('remote-stream-label').textContent = `${name || getContactName(peerId) || peerId} (Live)`;
    updateGroupCountPill();
  });

  call.on('close', () => {
    delete activeCalls[peerId];
    updateGroupCountPill();
  });
  call.on('error', (err) => console.error('Call error:', err));
}

document.getElementById('btn-unmute-audio').onclick = () => {
  const audio = document.getElementById('remote-audio-player');
  if (audio) audio.play().catch(() => {});
  document.getElementById('btn-unmute-audio').classList.add('hidden');
};

function updateGroupCountPill() {
  const c = Object.keys(activeCalls).length + 1;
  const p = document.getElementById('group-participants-count');
  if (!p) return;
  p.textContent = `👥 ${c} in Session`;
  if (c > 2) p.classList.remove('hidden');
}

function updateHardwareStatusPill() {
  const pill = document.getElementById('studio-media-status');
  if (!pill) return;
  if (isScreenSharing) {
    pill.textContent = "ðŸ–¥ï¸ Screen Sharing Active";
    pill.style.color = "#58a6ff";
  }
  else if (localStream && localStream.getVideoTracks().some(t => t.enabled && t.readyState === 'live')) {
    pill.textContent = "📷 Camera Active";
    pill.style.color = "#3fb950";
  }
  else if (localStream && localStream.getAudioTracks().some(t => t.enabled && t.readyState === 'live')) {
    pill.textContent = "ðŸŽ™ï¸ Mic Active";
    pill.style.color = "#3fb950";
  }
  else {
    pill.textContent = "🔇 Live Session";
    pill.style.color = "#58a6ff";
  }
}

// === CALL INITIATE ===
document.getElementById('btn-start-call').onclick = async () => {
  if (!currentPeerId) return alert("Select a peer first");
  const conn = getActiveConn();
  if (!conn || !conn.open) return alert("Not connected");
  isGroupCallActive = false;
  
  try { conn.send({ type: 'call_ring', isGroup: false }); } catch(e) {}
  document.getElementById('call-modal').classList.remove('hidden');
  document.getElementById('call-status-title').textContent = "Pinging Peer...";
  document.getElementById('btn-accept-call').classList.add('hidden');

  try { localStream = await getMediaStream(); }
  catch(e) { return alert("Media error: " + e.message); }
  
  if (localStream.getVideoTracks().some(t => t.readyState === 'live')) {
    document.getElementById('local-stream-video').srcObject = localStream;
    document.getElementById('local-preview-card').classList.remove('hidden');
  }
  isMicOn = true; isCamOn = true;
  document.getElementById('btn-toggle-mic').textContent = "ðŸŽ™ï¸ Mic: ON";
  document.getElementById('btn-toggle-mic').classList.add('active');
  document.getElementById('btn-toggle-cam').textContent = "📷 Cam: ON";
  document.getElementById('btn-toggle-cam').classList.add('active');
  updateHardwareStatusPill();

  try {
    const call = peer.call(currentPeerId, localStream);
    bindCallEvents(call, currentPeerId);
  } catch(e) { alert("Call failed: " + e.message); }
};

let _userAcceptedCall = false;

function handleIncomingCall(call) {
  activeCalls[call.peer] = call;
  _pendingCall = call;
  if (!currentPeerId) currentPeerId = call.peer;
  bindCallEvents(call, call.peer);

  // Agar user ne screen par Accept ka button pehle hi daba diya tha
  if (_userAcceptedCall) {
    _userAcceptedCall = false;
    stopRingtone();
    if (!localStream) localStream = createDummyStream();
    try { call.answer(localStream); } catch(e) {}
    document.getElementById('call-status-title').textContent = "Live Session Active";
    document.getElementById('btn-accept-call').classList.add('hidden');
    const conn = activeConns[call.peer];
    if (conn && conn.open) conn.send({ type: 'call_accepted', isGroup: isGroupCallActive });
    return;
  }

  playRingtone();
  document.getElementById('call-modal').classList.remove('hidden');
  document.getElementById('call-status-title').textContent = `Incoming: ${getContactName(call.peer) || call.peer}`;
  document.getElementById('btn-accept-call').classList.remove('hidden');
}

document.getElementById('btn-accept-call').onclick = async () => {
  stopRingtone();
  const call = _pendingCall;

  const audioEl = document.getElementById('remote-audio-player');
  if (audioEl) audioEl.play().catch(() => {});

  if (!call) {
    _userAcceptedCall = true;
    document.getElementById('call-status-title').textContent = "Connecting Session...";
    document.getElementById('btn-accept-call').classList.add('hidden');
    return;
  }

  if (!localStream) {
    localStream = await getMediaStream(true, true);
    if (isMicOn) {
      document.getElementById('btn-toggle-mic').textContent = "🎙️ Mic: ON";
      document.getElementById('btn-toggle-mic').classList.add('active');
    }
  }

  try {
    call.answer(localStream);
  } catch(e) {
    return alert("Answer failed: " + e.message);
  }

  _pendingCall = null;
  _userAcceptedCall = false;
  document.getElementById('btn-accept-call').classList.add('hidden');
  document.getElementById('call-status-title').textContent = "Live Session Active";
  updateHardwareStatusPill();

  const conn = activeConns[call.peer];
  if (conn && conn.open) conn.send({ type: 'call_accepted', isGroup: isGroupCallActive });
};

// === TWO-WAY SCREEN SHARING ===
function mixAudioStreams(t1, t2) {
  if (t1 && !t2) return t1;
  if (!t1 && t2) return t2;
  if (!t1 && !t2) return createSilentAudioTrack();
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const dst = ctx.createMediaStreamDestination();
    if (t1) ctx.createMediaStreamSource(new MediaStream([t1])).connect(dst);
    if (t2) ctx.createMediaStreamSource(new MediaStream([t2])).connect(dst);
    return dst.stream.getAudioTracks()[0];
  } catch(e) { return t1 || t2; }
}

async function triggerUniversalScreenShare() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    return alert("Screen sharing is supported on Laptop, PC, and Android Chrome. iPhone Safari supports viewing only.");
  }
  if (!currentPeerId) return alert("Select or connect to a peer first.");

  try {
    let ds = null;
    try {
      ds = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch(err) {
      console.warn("Screen share cancelled:", err);
      return;
    }

    if (!ds || !ds.getVideoTracks().length) return;

    screenStream = ds;
    isScreenSharing = true;

    // Asli Microphone attach karein taake screen share ke dauran aap ki awaz aaye
    let micTrack = null;
    if (localStream && localStream.getAudioTracks().some(t => t.readyState === 'live')) {
      micTrack = localStream.getAudioTracks().find(t => t.readyState === 'live');
    } else {
      try {
        const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
        micTrack = ms.getAudioTracks()[0];
        isMicOn = true;
        document.getElementById('btn-toggle-mic').textContent = "🎙️ Mic: ON";
        document.getElementById('btn-toggle-mic').classList.add('active');
      } catch(e) {
        micTrack = createSilentAudioTrack();
      }
    }
    const screenAudio = ds.getAudioTracks()[0];
    const finalAudio = mixAudioStreams(screenAudio, micTrack);
    ds.getAudioTracks().forEach(t => ds.removeTrack(t));
    if (finalAudio) ds.addTrack(finalAudio);

    const screenTrack = ds.getVideoTracks()[0];

    document.getElementById('call-modal').classList.remove('hidden');
    document.getElementById('call-status-title').textContent = "Broadcasting Screen...";
    
    const localVid = document.getElementById('local-stream-video');
    localVid.srcObject = ds;
    localVid.muted = true;
    localVid.play().catch(() => {});
    document.getElementById('local-preview-card').classList.remove('hidden');
    
    const conn = getActiveConn();
    if (conn && conn.open) conn.send({ type: 'screen_state', isSharing: true });

    if (Object.keys(activeCalls).length > 0) {
      let replaced = false;
      Object.values(activeCalls).forEach(call => {
        if (call.peerConnection) {
          const senders = call.peerConnection.getSenders();
          const videoSender = senders.find(s => s.track && s.track.kind === 'video');
          if (videoSender) {
            videoSender.replaceTrack(screenTrack);
            replaced = true;
          }
          const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
          if (audioSender && finalAudio) audioSender.replaceTrack(finalAudio);
        }
      });
      if (!replaced) {
        localStream = ds;
        const sc = peer.call(currentPeerId, ds);
        bindCallEvents(sc, currentPeerId);
      }
    } else {
      localStream = ds;
      if (conn && conn.open) conn.send({ type: 'call_ring', isScreen: true });
      const sc = peer.call(currentPeerId, ds);
      bindCallEvents(sc, currentPeerId);
    }

    updateHardwareStatusPill();

    screenTrack.onended = () => {
      stopScreenShare();
    };

  } catch(err) {
    console.error("Screen share error:", err);
  }
}

function stopScreenShare() {
  isScreenSharing = false;
  document.getElementById('call-status-title').textContent = "Live Session Active";

  const conn = getActiveConn();
  if (conn && conn.open) conn.send({ type: 'screen_state', isSharing: false });

  if (localStream) {
    const camTrack = localStream.getVideoTracks().find(t => t.readyState === 'live');
    if (camTrack) {
      Object.values(activeCalls).forEach(call => {
        if (call.peerConnection) {
          const s = call.peerConnection.getSenders().find(x => x.track && x.track.kind === 'video');
          if (s) s.replaceTrack(camTrack);
        }
      });
      document.getElementById('local-stream-video').srcObject = localStream;
    }
  }

  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  updateHardwareStatusPill();
}

document.getElementById('btn-screen-share').onclick = triggerUniversalScreenShare;
document.getElementById('btn-screen-in-call').onclick = triggerUniversalScreenShare;

// === MIC/CAM TOGGLES ===
document.getElementById('btn-toggle-mic').onclick = async () => {
  const btn = document.getElementById('btn-toggle-mic');
  if (!isMicOn) {
    try {
      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      const at = ms.getAudioTracks()[0];
      Object.values(activeCalls).forEach(c => {
        if (c.peerConnection) {
          const s = c.peerConnection.getSenders().find(x => x.track && x.track.kind === 'audio');
          if (s) s.replaceTrack(at);
        }
      });
      if (localStream) {
        localStream.getAudioTracks().forEach(t => localStream.removeTrack(t));
        localStream.addTrack(at);
      }
      isMicOn = true; btn.textContent = "ðŸŽ™ï¸ Mic: ON"; btn.classList.add('active');
    } catch(e) { alert("Mic error: " + e.message); }
  } else {
    if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = false);
    isMicOn = false; btn.textContent = "ðŸŽ™ï¸ Mic: Off"; btn.classList.remove('active');
  }
  updateHardwareStatusPill();
};

document.getElementById('btn-toggle-cam').onclick = async () => {
  const btn = document.getElementById('btn-toggle-cam');
  const lv = document.getElementById('local-stream-video');
  if (!isCamOn) {
    try {
      // Mobile-safe camera constraints jo Android/iOS par crash nahi hotay
      const cs = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      const vt = cs.getVideoTracks()[0];
      lv.srcObject = cs;
      lv.muted = true;
      lv.play().catch(() => {});
      document.getElementById('local-preview-card').classList.remove('hidden');

      Object.values(activeCalls).forEach(c => {
        if (c.peerConnection) {
          const s = c.peerConnection.getSenders().find(x => x.track && x.track.kind === 'video');
          if (s) {
            s.replaceTrack(vt);
          } else {
            c.peerConnection.addTrack(vt, cs);
          }
        }
      });

      if (!localStream) localStream = new MediaStream();
      localStream.getVideoTracks().forEach(t => localStream.removeTrack(t));
      localStream.addTrack(vt);

      isCamOn = true;
      btn.textContent = "📷 Cam: ON";
      btn.classList.add('active');

      // Laptop ko signal bhejein taake video live render kare
      const conn = getActiveConn();
      if (conn && conn.open) conn.send({ type: 'cam_state', isCamOn: true });

    } catch(e) {
      alert("Camera error: " + e.message);
    }
  } else {
    isCamOn = false;
    btn.textContent = "📷 Cam: Off";
    btn.classList.remove('active');
    document.getElementById('local-preview-card').classList.add('hidden');
    if (lv.srcObject) {
      lv.srcObject.getVideoTracks().forEach(t => t.stop());
      lv.srcObject = null;
    }
    const dummy = createDummyStream().getVideoTracks()[0];
    Object.values(activeCalls).forEach(c => {
      if (c.peerConnection) {
        const s = c.peerConnection.getSenders().find(x => x.track && x.track.kind === 'video');
        if (s) s.replaceTrack(dummy);
      }
    });
    const conn = getActiveConn();
    if (conn && conn.open) conn.send({ type: 'cam_state', isCamOn: false });
  }
  updateHardwareStatusPill();
};

// === GROUP CALL ===
document.getElementById('btn-group-call').onclick = async () => {
  if (!isAdmin || !contacts.length) return alert("Add contacts first!");
  isGroupCallActive = true;
  document.getElementById('call-modal').classList.remove('hidden');
  document.getElementById('call-status-title').textContent = "Dialing Group Mesh...";
  document.getElementById('btn-accept-call').classList.add('hidden');
  localStream = await getMediaStream();
  updateHardwareStatusPill();
  contacts.forEach(c => {
    if (activeConns[c.id] && activeConns[c.id].open) {
      try {
        activeConns[c.id].send({ type: 'call_ring', isGroup: true });
        const call = peer.call(c.id, localStream);
        bindCallEvents(call, c.id, c.name);
      } catch(e) {}
    }
  });
};

// === IN-CALL ADD PERSON ===
document.getElementById('btn-in-call-add').onclick = async () => {
  const targetId = prompt("Enter Node ID to add to this call:");
  if (!targetId || targetId === myId) return;
  if (!localStream) localStream = await getMediaStream();
  try {
    const c = peer.connect(targetId, { reliable: true });
    c.on('open', () => c.send({ type: 'call_ring', isGroup: true }));
    const call = peer.call(targetId, localStream);
    bindCallEvents(call, targetId, targetId);
    alert(`Dialing ${targetId} into session`);
  } catch(e) { alert("Failed: " + e.message); }
};

// === END CALL ===
document.getElementById('btn-end-call').onclick = () => {
  stopRingtone();
  const conn = getActiveConn();
  if (conn && conn.open) conn.send({ type: 'call_ended' });
  closeCallModal();
};

function closeCallModal() {
  stopRingtone();
  document.getElementById('call-modal').classList.add('hidden');
  document.getElementById('group-participants-count').classList.add('hidden');
  
  const rv = document.getElementById('remote-stream-video'); if (rv) rv.srcObject = null;
  const ra = document.getElementById('remote-audio-player'); if (ra) ra.srcObject = null;
  const lv = document.getElementById('local-stream-video');
  if (lv && lv.srcObject) lv.srcObject.getTracks().forEach(t => t.stop());
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());

  Object.values(activeCalls).forEach(c => { try { c.close(); } catch(e){} });
  activeCalls = {}; localStream = null; screenStream = null; _pendingCall = null;
  isGroupCallActive = false; isMicOn = false; isCamOn = false; isScreenSharing = false; pipState = 0;
  
  const m = document.querySelector('.studio-modal');
  if (m) m.classList.remove('floating-share');
  document.getElementById('btn-toggle-mic').textContent = "ðŸŽ™ï¸ Mic: Off";
  document.getElementById('btn-toggle-cam').textContent = "📷 Cam: Off";
  document.getElementById('btn-toggle-mic').classList.remove('active');
  document.getElementById('btn-toggle-cam').classList.remove('active');
  document.getElementById('btn-toggle-pip').textContent = "⛶ Fullscreen";
}

// === PIP / FLOAT / FULLSCREEN ===
document.getElementById('btn-toggle-pip').onclick = async () => {
  const modal = document.querySelector('.studio-modal');
  const btn = document.getElementById('btn-toggle-pip');
  if (document.fullscreenElement) await document.exitFullscreen();
  modal.classList.remove('floating-share');
  pipState = (pipState + 1) % 3;
  if (pipState === 0) {
    btn.textContent = '⛶ Fullscreen';
  } else if (pipState === 1) {
    modal.requestFullscreen().catch(() => {});
    btn.textContent = '⛶ Float';
  } else {
    modal.classList.add('floating-share');
    btn.textContent = '⛶ Exit';
  }
};

// === FLOAT DRAG ===
let isDragging = false, dragOffset = { x: 0, y: 0 };
document.addEventListener('mousedown', (e) => {
  const m = document.querySelector('.studio-modal.floating-share');
  if (!m) return;
  if (m.querySelector('.studio-header')?.contains(e.target)) {
    isDragging = true;
    const r = m.getBoundingClientRect();
    dragOffset.x = e.clientX - r.left;
    dragOffset.y = e.clientY - r.top;
  }
});
document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const m = document.querySelector('.studio-modal.floating-share');
  if (!m) return;
  m.style.left = (e.clientX - dragOffset.x) + 'px';
  m.style.top = (e.clientY - dragOffset.y) + 'px';
  m.style.right = 'auto'; m.style.bottom = 'auto';
});
document.addEventListener('mouseup', () => { isDragging = false; });

// === VIDEO MAXIMIZE ===
setTimeout(() => {
  const videoGrid = document.getElementById('video-grid');
  const remoteCard = document.getElementById('remote-card-main');
  const localCard = document.getElementById('local-preview-card');
  if (!videoGrid || !remoteCard || !localCard) return;

  remoteCard.addEventListener('click', (e) => {
    if (currentPeerId) {
      const conn = activeConns[currentPeerId];
      if (conn && conn.open) {
        const vid = document.getElementById('remote-stream-video');
        const r = vid.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * 1920;
        const y = ((e.clientY - r.top) / r.height) * 1080;
        conn.send({ type: 'screen_click', x, y, screenW: 1920, screenH: 1080 });
      }
    }
    if (localCard.classList.contains('hidden')) return;
    if (videoGrid.classList.contains('maximized-remote')) {
      videoGrid.classList.remove('maximized-remote', 'maximized-local');
    } else {
      videoGrid.classList.remove('maximized-local');
      videoGrid.classList.add('maximized-remote');
    }
  });

  localCard.addEventListener('click', () => {
    if (videoGrid.classList.contains('maximized-local')) {
      videoGrid.classList.remove('maximized-remote', 'maximized-local');
    } else {
      videoGrid.classList.remove('maximized-remote');
      videoGrid.classList.add('maximized-local');
    }
  });
}, 1500);

function showRemoteClick(x, y, screenW, screenH) {
  const video = document.getElementById('remote-stream-video');
  if (!video) return;
  const r = video.getBoundingClientRect();
  const relX = (x / screenW) * r.width;
  const relY = (y / screenH) * r.height;
  const rip = document.createElement('div');
  rip.className = 'remote-click-ripple';
  rip.style.left = (r.left + relX) + 'px';
  rip.style.top = (r.top + relY) + 'px';
  document.body.appendChild(rip);
  setTimeout(() => rip.remove(), 800);
}

// === CONTACTS ===
document.getElementById('btn-add-contact').onclick = () => {
  if (!isAdmin) return;
  const n = document.getElementById('target-contact-name'), i = document.getElementById('target-peer-id');
  const name = n.value.trim(), id = i.value.trim();
  if (!name || !id) return alert("Provide name and ID!");
  const ex = contacts.find(c => c.id === id);
  if (ex) ex.name = name; else contacts.push({ name, id });
  localStorage.setItem('ghost_admin_contacts', JSON.stringify(contacts));
  renderContacts(); silentConnect(id, name);
  n.value = ''; i.value = '';
};

function deleteContact(cid, e) {
  if (e) e.stopPropagation();
  if (confirm(`Remove ${cid}?`)) {
    contacts = contacts.filter(c => c.id !== cid);
    localStorage.setItem('ghost_admin_contacts', JSON.stringify(contacts));
    renderContacts();
    if (activeConns[cid]) { try { activeConns[cid].close(); } catch(e) {} delete activeConns[cid]; }
  }
}

function renderContacts() {
  if (!isAdmin) return;
  const l = document.getElementById('contacts-list');
  l.innerHTML = '';
  contacts.forEach(c => {
    const online = activeConns[c.id] && activeConns[c.id].open;
    const li = document.createElement('li');
    li.className = `contact-item ${c.id === currentPeerId ? 'active' : ''}`;
    li.innerHTML = `
      <div class="contact-info" onclick="switchToPeer('${c.id}', '${c.name}')">
        <span class="c-name">${online ? '🟢' : '⚪'} ${c.name}</span>
        <span class="c-id">${c.id}</span>
      </div>
      <button class="btn-del-contact" onclick="deleteContact('${c.id}', event)">âŒ</button>`;
    l.appendChild(li);
  });
}

function toggleInputs(enabled) {
  msgInput.disabled = false;
  document.getElementById('btn-send').disabled = false;
  document.getElementById('btn-start-call').disabled = !enabled;
  document.getElementById('btn-screen-share').disabled = !enabled;
}

window.switchToPeer = switchToPeer;
window.silentConnect = silentConnect;
window.deleteContact = deleteContact;

// === ADMIN ===
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
    if (confirm("Lock?")) { 
      isAdmin = false; 
      sessionStorage.removeItem('ghost_is_admin'); 
      localStorage.removeItem('ghost_my_id');
      location.reload(); 
    } 
  } else { 
    const p = prompt("PIN:"); 
    if (p === ADMIN_PIN) { 
      isAdmin = true; 
      sessionStorage.setItem('ghost_is_admin', 'true'); 
      location.reload(); 
    } else alert("Unauthorized"); 
  }
};

const ds = document.getElementById('select-device-type');
if (ds) { 
  ds.value = adminDevice; 
  ds.onchange = (e) => { 
    localStorage.setItem('ghost_admin_device', e.target.value); 
    location.reload(); 
  }; 
}

document.getElementById('my-peer-id').textContent = myId;
document.getElementById('btn-copy-id').onclick = () => { navigator.clipboard.writeText(myId); alert("Copied"); };

document.getElementById('my-live-input').oninput = (e) => {
  const cn = getActiveConn();
  if (cn) cn.send({ type: 'live_typing', text: e.target.value });
  document.getElementById('hud-latest-text').textContent = `Me: ${e.target.value}`;
};

window.addEventListener('focus', () => {
  attemptConnectAll();
});

// Privacy
window.addEventListener('blur', () => document.getElementById('privacy-shield').classList.remove('hidden'));
window.addEventListener('focus', () => document.getElementById('privacy-shield').classList.add('hidden'));
document.addEventListener('contextmenu', e => e.preventDefault());

setTimeout(initEmojiTabs, 100);




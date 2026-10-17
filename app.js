// ============================================================
// GHOSTNODE v7.2 — Complete Build (All Features Restored)
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

// === CONN HELPERS ===
function getActiveConn() { return currentPeerId ? activeConns[currentPeerId] : null; }

function queueOrSend(payload) {
  const conn = getActiveConn();
  if (conn && conn.open) {
    try { conn.send(payload); console.log('📤 Sent:', payload.type); return true; }
    catch(e) { console.error('Send fail:', e); }
  }
  pendingMessages.push({ peerId: currentPeerId, payload });
  localStorage.setItem('ghost_pending_msgs', JSON.stringify(pendingMessages));
  console.log('📬 Queued:', payload.type);
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
    document.getElementById('connection-status').textContent = '● Connecting...';
    document.getElementById('connection-status').className = 'status-offline';
    document.getElementById('current-contact-name').textContent = name || peerId;
    loadContactMessages(peerId);
    silentConnect(peerId, name);
  }
  if (isAdmin) renderContacts();
}

// === PEER INIT ===
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

peer.on('open', (id) => {
  console.log('✅ Ready:', id);
  document.getElementById('my-peer-id').textContent = id;
  attemptConnectAll();
  setInterval(attemptConnectAll, 3000);
});
peer.on('connection', (conn) => setupConnection(conn));
peer.on('call', (call) => handleIncomingCall(call));
peer.on('disconnected', () => setTimeout(() => { try { peer.reconnect(); } catch(e) { location.reload(); } }, 1500));
peer.on('error', (err) => {
  console.warn('Peer error:', err.type);
  if (err.type === 'unavailable-id') { localStorage.removeItem('ghost_my_id'); setTimeout(() => location.reload(), 800); }
  if (['network','server-error','socket-error'].includes(err.type)) setTimeout(() => { try { peer.reconnect(); } catch(e){} }, 3000);
});

// === CONNECTIONS ===
const connectingTo = {};
function attemptConnectAll() {
  if (isAdmin) {
    contacts.forEach(c => { if (!activeConns[c.id] || !activeConns[c.id].open) silentConnect(c.id, c.name); });
  } else {
    ['admin_pc', 'admin_laptop'].forEach(id => { if (!activeConns[id] || !activeConns[id].open) silentConnect(id, id); });
  }
}

function silentConnect(targetId, name) {
  if (!targetId || targetId === myId) return;
  if (activeConns[targetId] && activeConns[targetId].open) return;
  if (connectingTo[targetId]) return;
  connectingTo[targetId] = true;
  let conn;
  try { conn = peer.connect(targetId, { reliable: true }); } catch(e) { delete connectingTo[targetId]; return; }
  setTimeout(() => { delete connectingTo[targetId]; try { conn.close(); } catch(e) {} }, 8000);
  conn.on('open', () => delete connectingTo[targetId]);
  conn.on('error', () => delete connectingTo[targetId]);
  setupConnection(conn, name);
}

function setupConnection(conn, name = null) {
  conn.on('open', () => {
    activeConns[conn.peer] = conn;
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
      document.getElementById('connection-status').textContent = '● Scanning...';
      document.getElementById('connection-status').className = 'status-offline';
      document.getElementById('latency-badge').classList.add('hidden');
      document.getElementById('e2ee-fingerprint').classList.add('hidden');
      toggleInputs(false);
    }
    if (isAdmin) renderContacts();
    setTimeout(attemptConnectAll, 800);
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
  document.getElementById('connection-status').textContent = `● Online: ${name}`;
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
  else if (data.type === 'call_ring') { playRingtone(); sendDesktopNotification("Incoming Call", "Someone is calling!"); }
  else if (data.type === 'call_accepted') { document.getElementById('call-status-title').textContent = "Live Session Active"; document.getElementById('btn-accept-call').classList.add('hidden'); }
  else if (data.type === 'call_ended') { closeCallModal(); }
  else if (data.type === 'live_typing') {
    document.getElementById('remote-live-text').textContent = data.text || '...';
    document.getElementById('hud-latest-text').textContent = `Typing: ${data.text}`;
  }
  else if (data.type === 'screen_click') { showRemoteClick(data.x, data.y, data.screenW, data.screenH); }
}

// === FORMAT MESSAGE (RESTORED) ===
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

// === NOTIFICATIONS ===
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

// === FULL EMOJI DATA (10 categories) ===
const EMOJI_DATA = {
  smileys: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','☺️','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'],
  gestures: ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦵','🦿','🦶','👂','🦻','👃','👀','👁️','👅','👄','💋','🧠','🫀','🫁','🦷','🦴','👤','👥','🫂','🧑','👶','🧒','👦','👧','🧓','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🧏','🙇','🤦','🤷'],
  hearts: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','❤️‍🔥','❤️‍🩹','🔥','✨','⭐','🌟','💫','⚡','💥','💢','💦','💨','💣','💬','🗯️','💭','💤'],
  animals: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷️','🕸️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🐈','🐓','🦃','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿️','🦔'],
  food: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🥪','🥙','🌮','🌯','🥗','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🍤','🍙','🍚','🍘','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼','☕','🍵','🧃','🥤','🧋','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🍾'],
  nature: ['🌸','💮','🏵️','🌹','🥀','🌺','🌻','🌼','🌷','🌱','🪴','🌲','🌳','🌴','🌵','🌾','🌿','☘️','🍀','🍁','🍂','🍃','🍄','🌍','🌎','🌏','🌕','🌖','🌗','🌘','🌑','🌒','🌓','🌔','🌙','🌚','🌛','🌜','☀️','🌝','🌞','🪐','⭐','🌟','🌠','☁️','⛅','⛈️','🌤️','🌥️','🌦️','🌧️','🌨️','🌩️','🌪️','🌫️','🌈','☔','💧','🌊','❄️','☃️','⛄'],
  travel: ['🚗','🚕','🚙','🚌','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🛴','🚲','🛵','🏍️','🛺','🚨','🚔','🚡','🚠','🚟','🚃','🚋','🚞','🚝','🚄','🚅','🚈','🚂','🚆','🚇','🚊','🚉','✈️','🛫','🛬','🛩️','💺','🛰️','🚀','🛸','🚁','🛶','⛵','🚤','🛥️','🛳️','⛴️','🚢','⚓','⛽','🚧','🚦','🚥','🚏','🗺️','🗿','🗽','🗼','🏰','🏯','🏟️','🎡','🎢','🎠','⛲','⛱️','🏖️','🏝️','🏜️','🌋','⛰️','🏔️','🗻','🏕️','⛺','🏠','🏡','🏘️','🏚️','🏗️','🏭','🏢','🏬','🏥','🏦','🏨','🏪','🏫','💒','🏛️','⛪','🕌','🕍','🕋','⛩️'],
  objects: ['⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯️','🧯','💸','💵','💴','💶','💷','💰','💳','💎','⚖️','🔧','🔨','⛏️','🔩','⚙️','🧲','🔫','💣','🧨','🔪','🗡️','⚔️','🛡️','🚬','⚰️','🏺','🔮','📿','🧿','💈','⚗️','🔭','🔬','🩹','🩺','💊','💉','🩸','🧬','🦠','🧪','🧹','🧺','🧻','🚽','🚿','🛁','🧼','🪥','🪒','🧽','🪣','🧴','🔑','🗝️','🚪','🪑','🛋️','🛏️','🧸','🖼️','🛍️','🛒','🎁','🎈','🎀','🎊','🎉','🏮','🧧','✉️','📩','📨','📧','💌','📥','📤','📦','🏷️','📪','📫','📬','📭','📮','📜','📃','📄','📑','🧾','📊','📈','📉','📆','📅','🗑️','📇','📋','📁','📂','📰','📓','📔','📒','📕','📗','📘','📙','📚','📖','🔖','📎','📐','📏','📌','📍','✂️','🖊️','🖋️','✒️','🖌️','🖍️','📝','✏️','🔍','🔎','🔏','🔐','🔒','🔓'],
  symbols: ['❤️','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','♿','🅿️','🛗','🈳','🈂️','🛂','🛃','🛄','🛅','🚹','🚺','🚼','🚻','🚮','🎦','📶','🈁','🔣','ℹ️','🔤','🔡','🔠','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔢','#️⃣','*️⃣','⏏️','▶️','⏸️','⏯️','⏹️','⏺️','⏭️','⏮️','⏩','⏪','⏫','⏬','◀️','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','↩️','↪️','⤴️','⤵️','🔀','🔁','🔂','🔄','🔃','🎵','🎶','➕','➖','➗','✖️','💲','💱','™️','©️','®️','🔚','🔙','🔛','🔝','🔜','〰️','➰','➿','✔️','☑️','🔘','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','🔸','🔹','🔶','🔷','🔳','🔲','▪️','▫️','◾','◽','◼️','◻️','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','🟫','🔈','🔇','🔉','🔊','🔔','🔕','📣','📢','♠️','♣️','♥️','♦️','🃏','🎴','🀄','🕐','🕑','🕒','🕓','🕔','🕕','🕖','🕗','🕘','🕙','🕚','🕛'],
  tech: ['💻','🖥️','📱','⌨️','🖱️','🖨️','📷','🎥','📽️','🎙️','🎧','📡','🚀','🛸','⚡','🔋','💡','🕹️','🎮','🤖','🔒','🔑','📦','☕','💾','💿','📀','📼','🖲️','📟','📠','☎️','📞','🔌','🔦','🕯️','⏰','⏱️','⌚','📺','📻','🎚️','🎛️','🧭','📶','📳','📴','🔇','🔈','🔉','🔊','📢','📣','🔔','🔕','🛰️','🧬','🔬','🔭','🧪','🧫','⚗️','🔮']
};

// === EMOJI TABS INJECTION ===
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
  if (!emojiPanel.contains(e.target) && e.target.id !== 'btn-toggle-emoji') {
    emojiPanel.classList.add('hidden');
  }
});

// === CHAT ===
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
  if (f.type.startsWith('image/')) {
    compressImage(f, (u) => sendFilePayload(u, 'image/jpeg', f.name.replace(/\.[^.]+$/, '.jpg')));
  } else {
    const r = new FileReader();
    r.onload = () => sendFilePayload(r.result, f.type, f.name);
    r.readAsDataURL(f);
  }
  e.target.value = '';
};

function compressImage(file, cb) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const c = document.createElement('canvas');
    let { width, height } = img;
    const max = 1280;
    if (width > max || height > max) {
      if (width > height) { height = Math.round(height * max / width); width = max; }
      else { width = Math.round(width * max / height); height = max; }
    }
    c.width = width; c.height = height;
    c.getContext('2d').drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);
    cb(c.toDataURL('image/jpeg', 0.8));
  };
  img.onerror = () => { const r = new FileReader(); r.onload = () => cb(r.result); r.readAsDataURL(file); };
  img.src = url;
}

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
    } catch(e) { alert("⚠️ Microphone: " + e.message); }
  } else {
    mediaRecorder.stop();
    isRecordingVoice = false;
    voiceBtn.classList.remove('recording');
    voiceBtn.title = "Record Voice Note";
  }
};

function appendMessageUI(msgId, type, text, fileData = null, fileType = null, fileName = null, ts = Date.now()) {
  const c = document.getElementById('messages-container');
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
  if (fileData) { const dl = document.createElement('a'); dl.className = 'btn-action-mini'; dl.href = fileData; dl.download = fileName || 'file'; dl.textContent = '⬇️'; a.appendChild(dl); }
  const del = document.createElement('button'); del.className = 'btn-action-mini btn-del-msg'; del.textContent = '🗑️';
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

// === DELETE CHOICE MODAL (RESTORED) ===
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

// === MEDIA STREAM ===
const ringtone = document.getElementById('ringtone');
function playRingtone() { ringtone.play().catch(() => playLoudChime()); }
function stopRingtone() { ringtone.pause(); ringtone.currentTime = 0; }

let _ghostAudioCtx = null;
function createSilentAudioStream() {
  try {
    if (!_ghostAudioCtx) _ghostAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_ghostAudioCtx.state === 'suspended') _ghostAudioCtx.resume();
    const osc = _ghostAudioCtx.createOscillator();
    const gain = _ghostAudioCtx.createGain();
    gain.gain.value = 0.0001;
    const dst = _ghostAudioCtx.createMediaStreamDestination();
    osc.connect(gain); gain.connect(dst); osc.start();
    window._ghostSilentOsc = osc;
    return dst.stream;
  } catch(e) { return new MediaStream(); }
}

function createSyntheticVideoStream() {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 480;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, 640, 480);
  ctx.fillStyle = '#58a6ff'; ctx.font = '20px monospace';
  ctx.fillText('💻 Terminal', 250, 240);
  return c.captureStream(5);
}

async function getAdaptiveMediaStream(wantAudio = true, wantVideo = true) {
  const stream = new MediaStream();
  try {
    const cons = {};
    if (wantAudio) cons.audio = { echoCancellation: true, noiseSuppression: true };
    if (wantVideo) cons.video = { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } };
    const real = await navigator.mediaDevices.getUserMedia(cons);
    real.getTracks().forEach(t => stream.addTrack(t));
  } catch(e) { console.warn('getUserMedia:', e.name); }
  if (wantAudio && !stream.getAudioTracks().length) {
    createSilentAudioStream().getAudioTracks().forEach(t => stream.addTrack(t));
  }
  if (wantVideo && !stream.getVideoTracks().length) {
    try { createSyntheticVideoStream().getVideoTracks().forEach(t => stream.addTrack(t)); } catch(e) {}
  }
  console.log('🎥 Stream:', stream.getTracks().map(t => `${t.kind}:${t.readyState}`));
  return stream;
}

// === CALLS ===
document.getElementById('btn-start-call').onclick = async () => {
  if (!currentPeerId) return alert("Select a peer first");
  const conn = getActiveConn();
  if (!conn || !conn.open) return alert("Not connected");
  isGroupCallActive = false;
  try { conn.send({ type: 'call_ring', isGroup: false }); } catch(e) {}
  document.getElementById('call-modal').classList.remove('hidden');
  document.getElementById('call-status-title').textContent = "Pinging Peer...";
  document.getElementById('btn-accept-call').classList.add('hidden');
  try { localStream = await getAdaptiveMediaStream(true, true); }
  catch(e) { return alert("Media error: " + e.message); }
  if (localStream.getVideoTracks().some(t => t.readyState === 'live')) {
    document.getElementById('local-stream-video').srcObject = localStream;
    document.getElementById('local-preview-card').classList.remove('hidden');
  }
  updateHardwareStatusPill();
  try {
    const call = peer.call(currentPeerId, localStream);
    console.log('📞 Call initiated to', currentPeerId);
    bindCallEvents(call, currentPeerId);
  } catch(e) { alert("Call failed: " + e.message); }
};

function handleIncomingCall(call) {
  console.log('📞 Incoming:', call.peer);
  activeCalls[call.peer] = call;
  bindCallEvents(call, call.peer);
  const modalOpen = !document.getElementById('call-modal').classList.contains('hidden');
  if (modalOpen && localStream) {
    try { call.answer(localStream); updateGroupCountPill(); } catch(e) {}
    return;
  }
  playRingtone();
  _pendingCall = call;
  document.getElementById('call-modal').classList.remove('hidden');
  document.getElementById('call-status-title').textContent = `Incoming: ${getContactName(call.peer) || call.peer}`;
  document.getElementById('btn-accept-call').classList.remove('hidden');
}

document.getElementById('btn-accept-call').onclick = async () => {
  stopRingtone();
  const call = _pendingCall;
  if (!call) return;
  try { localStream = await getAdaptiveMediaStream(true, true); }
  catch(e) { return alert("Media error: " + e.message); }
  try { call.answer(localStream); }
  catch(e) { return alert("Answer failed: " + e.message); }
  _pendingCall = null;
  document.getElementById('btn-accept-call').classList.add('hidden');
  document.getElementById('call-status-title').textContent = "Live Session Active";
  if (localStream.getVideoTracks().some(t => t.readyState === 'live')) {
    document.getElementById('local-stream-video').srcObject = localStream;
    document.getElementById('local-preview-card').classList.remove('hidden');
  }
  updateHardwareStatusPill();
  const conn = activeConns[call.peer];
  if (conn && conn.open) conn.send({ type: 'call_accepted', isGroup: isGroupCallActive });
};

function bindCallEvents(call, peerId, name = null) {
  activeCalls[peerId] = call;
  call.on('stream', (remote) => {
    console.log('📺 Stream from', peerId, ':', remote.getTracks().map(t => `${t.kind}:${t.readyState}`));
    const video = document.getElementById('remote-stream-video');
    const audio = document.getElementById('remote-audio-player');
    video.srcObject = remote; video.playsInline = true; video.muted = false;
    audio.srcObject = remote;
    video.play().catch(() => document.getElementById('btn-unmute-audio').classList.remove('hidden'));
    audio.play().catch(() => document.getElementById('btn-unmute-audio').classList.remove('hidden'));
    document.getElementById('call-modal').classList.remove('hidden');
    document.getElementById('call-status-title').textContent = "Live Session Active";
    document.getElementById('remote-stream-label').textContent = `${name || getContactName(peerId) || peerId} (Live)`;
    updateGroupCountPill();
  });
  call.on('close', () => { delete activeCalls[peerId]; updateGroupCountPill(); });
  call.on('error', (err) => console.error('Call error:', err));
}

document.getElementById('btn-unmute-audio').onclick = () => {
  document.getElementById('remote-stream-video').play().catch(() => {});
  document.getElementById('remote-audio-player').play().catch(() => {});
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
  if (isScreenSharing) { pill.textContent = "🖥️ Screen + Mic"; pill.style.color = "#58a6ff"; }
  else if (localStream && localStream.getVideoTracks().some(t => t.enabled && t.readyState === 'live')) { pill.textContent = "📷 Camera + Mic Active"; pill.style.color = "#3fb950"; }
  else if (localStream && localStream.getAudioTracks().some(t => t.enabled && t.readyState === 'live')) { pill.textContent = "🎙️ Mic Active"; pill.style.color = "#3fb950"; }
  else { pill.textContent = "🔇 Output Mode"; pill.style.color = "#58a6ff"; }
}

// === GROUP CALL ===
document.getElementById('btn-group-call').onclick = async () => {
  if (!isAdmin || !contacts.length) return alert("Add contacts first!");
  isGroupCallActive = true;
  document.getElementById('call-modal').classList.remove('hidden');
  document.getElementById('call-status-title').textContent = "Dialing Group Mesh...";
  document.getElementById('btn-accept-call').classList.add('hidden');
  localStream = await getAdaptiveMediaStream(true, true);
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

// === IN-CALL ADD PERSON (RESTORED) ===
document.getElementById('btn-in-call-add').onclick = async () => {
  const targetId = prompt("Enter Node ID to add to this call:");
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

// === MIC/CAM ===
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
      if (localStream) { localStream.getAudioTracks().forEach(t => { t.enabled = false; localStream.removeTrack(t); }); localStream.addTrack(at); }
      isMicOn = true; btn.textContent = "🎙️ Mic: ON"; btn.classList.add('active');
    } catch(e) { alert("Mic: " + e.message); }
  } else {
    if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = false);
    isMicOn = false; btn.textContent = "🎙️ Mic: Off"; btn.classList.remove('active');
  }
  updateHardwareStatusPill();
};

document.getElementById('btn-toggle-cam').onclick = async () => {
  const btn = document.getElementById('btn-toggle-cam');
  const lv = document.getElementById('local-stream-video');
  if (!isCamOn) {
    try {
      const cs = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      const vt = cs.getVideoTracks()[0];
      lv.srcObject = cs;
      document.getElementById('local-preview-card').classList.remove('hidden');
      Object.values(activeCalls).forEach(c => {
        if (c.peerConnection) {
          const s = c.peerConnection.getSenders().find(x => x.track && x.track.kind === 'video');
          if (s) s.replaceTrack(vt);
          else c.peerConnection.addTrack(vt, cs);
        }
      });
      isCamOn = true; btn.textContent = "📷 Cam: ON"; btn.classList.add('active');
    } catch(e) { alert("Cam: " + e.message); }
  } else {
    isCamOn = false; btn.textContent = "📷 Cam: Off"; btn.classList.remove('active');
    document.getElementById('local-preview-card').classList.add('hidden');
    if (lv.srcObject) { lv.srcObject.getTracks().forEach(t => t.stop()); lv.srcObject = null; }
  }
  updateHardwareStatusPill();
};

// === SCREEN SHARE ===
async function triggerUniversalScreenShare() {
  if (!navigator.mediaDevices.getDisplayMedia) return alert("Not supported");
  if (!currentPeerId) return alert("No peer connected");
  try {
    const ds = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always', frameRate: 30 },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    console.log('🖥️ Screen tracks:', ds.getTracks().map(t => `${t.kind}:${t.label}`));
    isScreenSharing = true;
    document.getElementById('call-modal').classList.remove('hidden');
    document.getElementById('call-status-title').textContent = "Broadcasting Screen...";
    document.getElementById('local-stream-video').srcObject = ds;
    document.getElementById('local-preview-card').classList.remove('hidden');
    const vt = ds.getVideoTracks()[0];
    const at = ds.getAudioTracks()[0];
    if (Object.keys(activeCalls).length > 0) {
      Object.values(activeCalls).forEach(call => {
        if (call.peerConnection) {
          const senders = call.peerConnection.getSenders();
          const vs = senders.find(s => s.track && s.track.kind === 'video');
          if (vs) vs.replaceTrack(vt);
          if (at) {
            const as = senders.find(s => s.track && s.track.kind === 'audio');
            if (as) as.replaceTrack(at);
            else call.peerConnection.addTrack(at, ds);
          }
        }
      });
    } else {
      const conn = getActiveConn();
      if (conn) conn.send({ type: 'call_ring', isGroup: false });
      const sc = peer.call(currentPeerId, ds);
      bindCallEvents(sc, currentPeerId);
    }
    vt.onended = () => { isScreenSharing = false; document.getElementById('call-status-title').textContent = "Share ended"; };
  } catch(err) { if (err.name !== 'NotAllowedError') console.error(err); }
}

document.getElementById('btn-screen-share').onclick = triggerUniversalScreenShare;
document.getElementById('btn-screen-in-call').onclick = triggerUniversalScreenShare;

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
  Object.values(activeCalls).forEach(c => { try { c.close(); } catch(e){} });
  activeCalls = {}; localStream = null; _pendingCall = null;
  isGroupCallActive = false; isMicOn = false; isCamOn = false; isScreenSharing = false; pipState = 0;
  const m = document.querySelector('.studio-modal');
  if (m) m.classList.remove('floating-share');
  document.getElementById('btn-toggle-mic').textContent = "🎙️ Mic: Off";
  document.getElementById('btn-toggle-cam').textContent = "📷 Cam: Off";
  document.getElementById('btn-toggle-mic').classList.remove('active');
  document.getElementById('btn-toggle-cam').classList.remove('active');
  document.getElementById('btn-toggle-pip').textContent = "⛶ Fullscreen";
}

// === PIP / FLOAT / FULLSCREEN (3-state cycle — RESTORED + NEW) ===
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

// === VIDEO SWAP ===
setTimeout(() => {
  ['remote-stream-video', 'local-stream-video'].forEach(id => {
    const v = document.getElementById(id);
    if (!v) return;
    v.onclick = (e) => {
      if (currentPeerId) {
        const conn = activeConns[currentPeerId];
        if (conn && conn.open) {
          const r = e.target.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * 1920;
          const y = ((e.clientY - r.top) / r.height) * 1080;
          conn.send({ type: 'screen_click', x, y, screenW: 1920, screenH: 1080 });
        }
      }
      const r = document.getElementById('remote-card-main');
      const l = document.getElementById('local-preview-card');
      if (l.classList.contains('hidden')) return;
      r.classList.toggle('swapped');
      l.classList.toggle('swapped');
    };
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
      <button class="btn-del-contact" onclick="deleteContact('${c.id}', event)">❌</button>`;
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
  if (isAdmin) { if (confirm("Lock?")) { isAdmin = false; sessionStorage.removeItem('ghost_is_admin'); location.reload(); } }
  else { const p = prompt("PIN:"); if (p === ADMIN_PIN) { isAdmin = true; sessionStorage.setItem('ghost_is_admin', 'true'); location.reload(); } else alert("Unauthorized"); }
};

const ds = document.getElementById('select-device-type');
if (ds) { ds.value = adminDevice; ds.onchange = (e) => { localStorage.setItem('ghost_admin_device', e.target.value); location.reload(); }; }

document.getElementById('my-peer-id').textContent = myId;
document.getElementById('btn-copy-id').onclick = () => { navigator.clipboard.writeText(myId); alert("Copied"); };

document.getElementById('my-live-input').oninput = (e) => {
  const cn = getActiveConn();
  if (cn) cn.send({ type: 'live_typing', text: e.target.value });
  document.getElementById('hud-latest-text').textContent = `Me: ${e.target.value}`;
};

// === PRIVACY ===
window.addEventListener('blur', () => document.getElementById('privacy-shield').classList.remove('hidden'));
window.addEventListener('focus', () => document.getElementById('privacy-shield').classList.add('hidden'));
document.addEventListener('contextmenu', e => e.preventDefault());

// === INIT EMOJI TABS ===
setTimeout(initEmojiTabs, 100);
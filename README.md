# ⚡ GhostNode — Serverless P2P Studio

<div align="center">

![GhostNode](https://cdn-icons-png.flaticon.com/512/2827/2827989.png)

**Zero-server • Encrypted • Unlimited peers • Built for real work**

[![License: MIT](https://img.shields.io/badge/License-MIT-3fb950.svg)](https://opensource.org/licenses/MIT)
[![WebRTC](https://img.shields.io/badge/WebRTC-PeerJS%20%2B%20TURN-58a6ff.svg)](https://webrtc.org/)
[![PWA](https://img.shields.io/badge/PWA-Installable-a371f7.svg)](https://web.dev/progressive-web-apps/)
[![E2EE](https://img.shields.io/badge/E2EE-DTLS%2FSRTP-f85149.svg)](https://tools.ietf.org/html/rfc5764)

🌐 **Live:** [waleedrajpootcode.github.io/Ghostchat-p2p](https://waleedrajpootcode.github.io/Ghostchat-p2p/)

</div>

---

## 🎯 What It Does

GhostNode is a fully decentralized communication app — no accounts, no servers, no data centers. Two people open the link, share their Node ID, and instantly get:

- **1-to-1 text chat** with offline queueing
- **HD video / audio calls** (mobile ↔ laptop ↔ desktop)
- **Screen sharing with system audio**
- **File, image, voice note transfer** with auto-compression
- **Live typing** inside calls (keystroke-by-keystroke)
- **Group calls** for multiple peers
- **Persistent local history** via IndexedDB

Everything encrypted end-to-end using WebRTC's native DTLS/SRTP. Nothing passes through a broker.

---

## ✨ Feature Highlights

| Feature | Status |
|---------|:------:|
| Text chat (offline queue) | ✅ |
| Image / file send (auto-compress) | ✅ |
| Voice notes (push-to-talk) | ✅ |
| Audio call | ✅ |
| Video call (mobile + laptop) | ✅ |
| Screen share with audio | ✅ |
| Incoming call accept UI + ringtone | ✅ |
| Auto-attend while in call | ✅ |
| Live in-call typing | ✅ |
| Group call (mesh) | ✅ |
| Emoji picker (4 categories) | ✅ |
| E2EE fingerprint badge | ✅ |
| Privacy shield (auto-blur) | ✅ |
| Multi-STUN + TURN | ✅ |
| Auto-reconnect | ✅ |
| PWA installable | ✅ |

---

## 🔧 How It Works
┌──────────────────┐ WebRTC DataChannel + MediaStream ┌──────────────────┐
│ Mobile (Guest) │ ◄════════════════════════════════════════════► │ Laptop (Admin) │
│ • Camera + Mic │ DTLS 1.2 / SRTP AES-128-GCM │ • Camera + Mic │
│ • Video stream │ │ • Screen share │
│ • Live typing │ │ • Live typing │
└──────────────────┘ └──────────────────┘
▲ ▲
└──────────────────── STUN + TURN (NAT traversal) ──────────────────┘

**No broker. No central storage.** Every byte flows directly between peers. STUN finds the address, TURN relays when NAT blocks direct connection.

---

## 🚀 Quick Start

### As Guest
1. Open the live URL
2. Copy your **Node ID** (shown in top-left)
3. Share with the Admin

### As Admin
1. Click **🔒 Admin** → enter PIN (`2007`)
2. Choose **PC** or **Laptop**
3. Paste guest's Node ID → **+ Add Node**
4. Auto-connect fires within 3 seconds

### Offline Messaging
Type anything without a connection — messages queue locally and **auto-send** the moment the peer comes online.

---

## 📱 Platform Support

| Platform | Chat | Call | Screen Share | Screen Audio |
|----------|:----:|:----:|:------------:|:------------:|
| Windows / macOS / Linux (Chrome/Edge) | ✅ | ✅ | ✅ | ✅ |
| Android (Chrome) | ✅ | ✅ | ✅ | ✅* |
| iOS (Safari) | ✅ | ✅ | ⚠️ | ❌** |

\* Android screen share captures mic audio (system audio limited by OS)  
\*\* iOS Safari restricts `getDisplayMedia` — OS limitation

---

## 🛠️ Tech Stack

- **PeerJS 1.5.4** — WebRTC signaling wrapper
- **WebRTC** — DataChannel + MediaStream + Screen Capture
- **IndexedDB v7** — Atomic local storage
- **Service Worker** — PWA offline shell
- **Vanilla JS** — No framework, ~50KB total

---

## 🔐 Security

- **DTLS 1.2 / SRTP AES-128-GCM** — native WebRTC encryption
- **No server** — messages never touch a relay
- **E2EE fingerprint** — per-session MITM detection
- **Privacy shield** — auto-blur on tab blur
- **Context menu disabled** — blocks inspection shortcuts

---

## 📜 License

MIT © [Waleed Rajpoot](https://github.com/waleedrajpootcode)

---

<div align="center">

**Built with ⚡ by Waleed Rajpoot**

</div>
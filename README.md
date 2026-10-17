# ⚡ GhostNode — Serverless P2P Studio

<div align="center">

**Zero-server • Encrypted • Unlimited peers • Built for real work**

[![License: MIT](https://img.shields.io/badge/License-MIT-3fb950.svg)](https://opensource.org/licenses/MIT)
[![WebRTC](https://img.shields.io/badge/WebRTC-PeerJS%20%2B%20TURN-58a6ff.svg)](https://webrtc.org/)
[![PWA](https://img.shields.io/badge/PWA-Installable-a371f7.svg)](https://web.dev/progressive-web-apps/)
[![E2EE](https://img.shields.io/badge/E2EE-DTLS%2FSRTP-f85149.svg)](https://tools.ietf.org/html/rfc5764)

🌐 **Live:** [waleedrajpootcode.github.io/Ghostchat-p2p](https://waleedrajpootcode.github.io/Ghostchat-p2p/)

</div>

---

## 🎯 What It Is

GhostNode is a fully decentralized communication app — no accounts, no servers, no data centers. Two people open the link, share their Node ID, and instantly get:

- **1-to-1 text chat** with offline queueing
- **HD video / audio calls** (mobile ↔ laptop ↔ desktop)
- **Screen sharing with system audio**
- **File, image, voice note transfer** with auto-compression
- **Live typing** inside calls (keystroke-by-keystroke)
- **Group calls** for multiple peers
- **Multi-peer admin** with real-time online status
- **Persistent local history** via IndexedDB

Everything encrypted end-to-end using WebRTC's native DTLS/SRTP. Nothing passes through a broker.

---

## ✨ Feature Matrix

| Category | Feature | Status |
|----------|---------|:------:|
| **Messaging** | Text chat + offline queue | ✅ |
| | Typing indicator | ✅ |
| | Live in-call keystroke stream | ✅ |
| | Message delete (me / everyone) | ✅ |
| | Code block formatting | ✅ |
| **Media** | Image send (auto-compress 1280px) | ✅ |
| | File send | ✅ |
| | Voice notes (push-to-talk) | ✅ |
| | Video / audio playback inline | ✅ |
| | **10 emoji categories (~1500 emojis)** | ✅ |
| **Calling** | 1-to-1 audio + video | ✅ |
| | Group mesh calls | ✅ |
| | Incoming call UI + ringtone | ✅ |
| | Add person mid-call | ✅ |
| | Mic / camera toggle | ✅ |
| **Screen Share** | Display broadcast | ✅ |
| | **System audio capture** | ✅ |
| | **Floating draggable window** | ✅ |
| | **3-state cycle (normal/full/float)** | ✅ |
| **Advanced** | Video click-to-swap | ✅ |
| | Remote click ripples | ✅ |
| | E2EE fingerprint badge | ✅ |
| | Multi-peer admin (🟢/⚪ status) | ✅ |
| | Auto-reconnect signaling | ✅ |
| | Privacy shield on blur | ✅ |

---

## 🔧 How It Works
┌──────────────────┐ WebRTC DataChannel + MediaStream ┌──────────────────┐
│ Mobile (Guest) │ ◄════════════════════════════════════════════► │ Laptop (Admin) │
│ • Camera + Mic │ DTLS 1.2 / SRTP AES-128-GCM │ • Camera + Mic │
│ • Video stream │ │ • Screen share │
│ • Live typing │ │ • Multi-peer │
└──────────────────┘ └──────────────────┘
▲ ▲
└──────────────────── STUN + TURN (NAT traversal) ──────────────────┘

No broker. No central storage. Every byte flows directly between peers.

---

## 🚀 Quick Start

### As Guest
1. Open the live URL
2. Copy your **Node ID**
3. Share with the Admin

### As Admin
1. Click **🔒 Admin** → enter PIN (`2007`)
2. Choose **PC** or **Laptop**
3. Paste guest's Node ID → **+ Add Node**
4. Auto-connect fires within 3 seconds
5. Click a contact to switch between peers — **multiple peers stay connected**

### Offline Messaging
Type anything without connection — messages queue locally and **auto-send** when peer comes online.

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

- **PeerJS 1.5.4** — WebRTC abstraction
- **WebRTC** — DataChannel, MediaStream, Screen Capture
- **IndexedDB v8** — Atomic local message store
- **Service Worker** — PWA offline shell
- **Vanilla JS** — ~60KB total, no framework

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
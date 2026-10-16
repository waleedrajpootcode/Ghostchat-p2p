# ⚡ GhostNode — Enterprise Heterogeneous P2P Studio & Mesh Collaboration

<div align="center">

![GhostNode Banner](https://cdn-icons-png.flaticon.com/512/9446/9446864.png)

**Zero-server • Zero-knowledge • Unlimited Peers • Enterprise-grade P2P**

[![License: MIT](https://img.shields.io/badge/License-MIT-3fb950.svg)](https://opensource.org/licenses/MIT)
[![WebRTC](https://img.shields.io/badge/WebRTC-PeerJS%20%2B%20TURN-58a6ff.svg)](https://webrtc.org/)
[![Storage](https://img.shields.io/badge/IndexedDB-v7%20Atomic-2ea043.svg)](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
[![PWA](https://img.shields.io/badge/PWA-Cross--Platform%20Installable-a371f7.svg)](https://web.dev/progressive-web-apps/)
[![Security](https://img.shields.io/badge/E2EE-DTLS%2FSRTP%20AES--128--GCM-f85149.svg)](https://tools.ietf.org/html/rfc5764)
[![TURN](https://img.shields.io/badge/NAT%20Traversal-TURN%20Enabled-orange.svg)](https://webrtc.org/)

🌐 **Live:** [https://waleedrajpootcode.github.io/Ghostchat-p2p/](https://waleedrajpootcode.github.io/Ghostchat-p2p/)

</div>

---

## 🏛️ Overview

**GhostNode** is a fully decentralized, brokerless peer-to-peer communication platform built on WebRTC. It enables **unlimited peers** to connect directly without any central server — messages, files, voice notes, HD video calls, and live screen sharing all flow through encrypted DTLS/SRTP tunnels.

Built for **asymmetric hardware environments** — a mic-less desktop terminal can seamlessly video-call a mobile device, and vice versa.

---

## ✨ Feature Matrix

| Category | Capabilities |
|----------|-------------|
| **Messaging** | Offline queueing • Auto-flush on connect • Typing indicator • Live keystroke stream |
| **Media** | Images • Video • Audio • Voice notes (push-to-talk) • 4-category emoji picker |
| **Calling** | 1-to-1 HD video • Multi-peer group calls • Dynamic participant scaling |
| **Screen Share** | Live display broadcast • System audio • Floating HUD overlay with incoming chat |
| **Reliability** | Multi-STUN + TURN fallback • Auto-reconnect signaling • Smart dedup engine |
| **Storage** | IndexedDB v7 atomic store • Persistent chat history • Per-contact indexing |
| **Security** | End-to-end DTLS encryption • E2EE fingerprint badge • Privacy shield on blur |
| **Admin** | PIN-gated orchestrator • Multi-device support (PC + Laptop) • Contact book |
| **PWA** | Installable on Android/iOS/Desktop • Offline capable |

---

## 🏛️ System Architecture

```text
┌─────────────────────────────────┐        WebRTC DataChannel + MediaStream        ┌─────────────────────────────────┐
│   Desktop Node (No Mic/Cam)     │ ◄══════════════════════════════════════════► │   Mobile Node (Full Camera/Mic) │
├─────────────────────────────────┤          (DTLS 1.2 / SRTP AES-GCM)             ├─────────────────────────────────┤
│ • Canvas Synthetic Video Track   │                                               │ • Real Front Camera (640×480)   │
│ • Silent Oscillator Audio Track  │                                               │ • Real Microphone Hardware      │
│ • DisplayCapture + System Sound  │                                               │ • Floating Live HUD Overlay     │
│ • In-Call Participant Scaling    │                                               │ • Responsive Video Mesh Layout  │
│ • IndexedDB Local Store (v7)     │                                               │ • Push-to-Talk Voice Memo       │
└─────────────────────────────────┘                                               └─────────────────────────────────┘
                          ▲                                                              ▲
                          │                                                              │
                 ┌────────┴──────────────────────────────────────────────────────────────┴────────┐
                 │         STUN Cluster (Google / Twilio)  +  TURN Relay (OpenRelay)              │
                 └─────────────────────────────────────────────────────────────────────────────────┘
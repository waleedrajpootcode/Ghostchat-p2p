# ⚡ GhostNode — Decentralized P2P Real-Time Collaboration Studio

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![WebRTC](https://img.shields.io/badge/WebRTC-PeerJS-orange.svg)](https://webrtc.org/)
[![Storage](https://img.shields.io/badge/IndexedDB-v5-green.svg)](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
[![PWA](https://img.shields.io/badge/PWA-Installable-purple.svg)](https://web.dev/progressive-web-apps/)
[![Security](https://img.shields.io/badge/E2EE-DTLS%2FSRTP-red.svg)](https://tools.ietf.org/html/rfc5764)

> **Enterprise-grade, zero-knowledge, peer-to-peer collaboration studio engineered for sub-30ms real-time communication without a centralized database.**

🌐 **Live Production Link:** [https://waleedrajpootcode.github.io/Ghostchat-p2p/](https://waleedrajpootcode.github.io/Ghostchat-p2p/)

---

## 🏛️ System Architecture

GhostNode operates on a fully decentralized **Brokerless P2P Architecture**. WebRTC DataChannels and MediaStreams establish direct mesh sockets between nodes after initial STUN/TURN ICE negotiation.

```text
[ Admin Node (Desktop PC) ] <==== WebRTC DataChannel (DTLS-SRTP) ====> [ Peer Node (Laptop/Mobile) ]
           │                                                                     │
           ├────────────► IndexedDB (Isolated Local Store)                        │
           ├────────────► Web Audio API Engine (Real-Time Synthesizer)            │
           └────────────► DisplayMedia Pipeline (Screen Share Studio) ───────────┘
                                       ▲
                                       │ Signaling Only (Zero Data Retained)
                                [ PeerJS Cloud ]
# ⚡ GhostNode — Enterprise Heterogeneous P2P Studio & Mesh Collaboration

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![WebRTC](https://img.shields.io/badge/WebRTC-PeerJS%20Multi--STUN-orange.svg)](https://webrtc.org/)
[![Storage](https://img.shields.io/badge/IndexedDB-v7%20Atomic-green.svg)](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
[![PWA](https://img.shields.io/badge/PWA-Cross--Platform%20Installable-purple.svg)](https://web.dev/progressive-web-apps/)
[![Security](https://img.shields.io/badge/E2EE-DTLS%2FSRTP%20AES--128--GCM-red.svg)](https://tools.ietf.org/html/rfc5764)

> **Enterprise-grade, zero-knowledge, peer-to-peer real-time communication ecosystem. Seamlessly bridges asymmetric hardware nodes (e.g., mic-less desktop terminals communicating with camera-enabled mobile devices) with real-time screen-share HUD overlays and dynamic in-call mesh participant scaling.**

🌐 **Live Production Link:** [https://waleedrajpootcode.github.io/Ghostchat-p2p/](https://waleedrajpootcode.github.io/Ghostchat-p2p/)

---

## 🏛️ System Architecture

GhostNode operates on a fully decentralized **Brokerless P2P Architecture**. WebRTC DataChannels and MediaStreams establish direct mesh sockets between nodes after initial STUN negotiation.

```text
┌─────────────────────────────────┐               WebRTC DataChannel + MediaStream              ┌─────────────────────────────────┐
│   Desktop Node (No Mic/Cam)     │ ◄========================================================► │   Mobile Node (Full Camera/Mic) │
├─────────────────────────────────┤                 (DTLS 1.2 / SRTP AES-GCM)                 ├─────────────────────────────────┤
│ • Canvas Synthetic Video Track   │                                                             │ • Real Front Camera (640x480)   │
│ • Silent Oscillator Audio Track  │                                                             │ • Real Microphone Hardware      │
│ • DisplayCapture + System Sound │                                                             │ • Floating Live HUD Overlay     │
│ • In-Call Participant Scaling   │                                                             │ • Responsive Video Mesh Layout  │
│ • IndexedDB Local Store (v7)    │                                                             │ • Push-to-Talk Voice Memo       │
└─────────────────────────────────┘                                                             └─────────────────────────────────┘
                                                 ▲                             ▲
                                                 │                             │
                                        [ Google / Twilio STUN Cluster ]
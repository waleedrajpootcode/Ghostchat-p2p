# ⚡ GhostNode — Decentralized Heterogeneous WebRTC Collaboration Studio

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![WebRTC Core](https://img.shields.io/badge/WebRTC-PeerJS%20Multi--STUN-orange.svg)](https://webrtc.org/)
[![Storage](https://img.shields.io/badge/IndexedDB-v7%20Atomic-green.svg)](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
[![PWA](https://img.shields.io/badge/PWA-Cross--Platform%20Installable-purple.svg)](https://web.dev/progressive-web-apps/)
[![Security](https://img.shields.io/badge/E2EE-DTLS%2FSRTP%20AES--128--GCM-red.svg)](https://tools.ietf.org/html/rfc5764)

> **A high-performance, brokerless WebRTC communication and display streaming ecosystem. Bridges asymmetric hardware architectures (e.g., mic-less desktop workstations communicating seamlessly with camera-enabled mobile smartphones) with zero intermediate database overhead.**

🌐 **Live Production Link:** [https://waleedrajpootcode.github.io/Ghostchat-p2p/](https://waleedrajpootcode.github.io/Ghostchat-p2p/)

---

## 🏛️ Heterogeneous Architecture Overview

GhostNode resolves the classical WebRTC hardware asymmetry failure. By synthesizing dynamic video/audio canvas and oscillator tracks during initial SDP negotiation, nodes without camera/mic hardware can initiate and receive two-way media sessions without renegotiation drops.

```text
┌─────────────────────────────────┐               WebRTC DataChannel + MediaStream              ┌─────────────────────────────────┐
│   Desktop Node (No Mic/Cam)     │ ◄========================================================► │   Mobile Node (Full Camera/Mic) │
├─────────────────────────────────┤                 (DTLS 1.2 / SRTP AES-GCM)                 ├─────────────────────────────────┤
│ • Canvas Synthetic Video Track   │                                                             │ • Real Front Camera (640x480)   │
│ • Silent Oscillator Audio Track  │                                                             │ • Real Microphone Hardware      │
│ • DisplayCapture + System Sound │                                                             │ • Touch-Optimized Call Layout   │
│ • Live Synchronous Keystrokes   │                                                             │ • Floating Keystroke Stream     │
│ • IndexedDB Local Store (v7)    │                                                             │ • Push-to-Talk Voice Memo       │
└─────────────────────────────────┘                                                             └─────────────────────────────────┘
                                                 ▲                             ▲
                                                 │                             │
                                        [ Google / Twilio STUN Cluster ]
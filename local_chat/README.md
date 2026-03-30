# LAN Messenger PWA (Offline WiFi/LAN)

A production-style offline LAN messenger with:

- React PWA frontend (installable, service worker, offline app shell)
- Node.js + Express + WebSocket backend
- Private chats + group chats
- WebRTC voice calling (LAN candidates, signaling over WebSocket)
- Push-to-talk voice notes transferred in encrypted chunks
- Presence + typing indicators
- Local IndexedDB message history (frontend)
- Local SQLite persistence + store-and-forward queue (backend)
- mDNS/Bonjour LAN service discovery
- Dockerized end-to-end
- Onboarding wizard (username + shared key + quick ID copy)
- WhatsApp-style desktop/mobile UI layout
- Production hardening profile (rate limit, payload cap, audit log)

## Project Structure

- `frontend/` React app
- `backend/` Express + WS server
- `Dockerfile` Multi-stage build (frontend + backend)
- `docker-compose.yml` Run app on LAN

## Security Model

- Message and voice-note chunks are AES-GCM encrypted in the browser using a shared passphrase.
- Backend stores encrypted payloads and forwards them to connected recipients.
- WebRTC media already uses SRTP/DTLS transport encryption.

## Run with Docker (recommended)

1. From this folder, optionally copy `.env.example` to `.env` and adjust values.
2. Start:

```bash
docker-compose up --build
```

3. Open from devices on the same LAN:

- `http://<host-lan-ip>:3000`

## Install as PWA

### iPhone (Safari)

1. Open `http://<host-lan-ip>:3000` in Safari.
2. Tap Share.
3. Tap Add to Home Screen.

### Android/Desktop

- Use browser install prompt or menu option for app install.

## Local Development (without Docker)

### Backend

```bash
cd backend
npm install
npm start
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

For integrated mode (frontend served by backend), build frontend first:

```bash
cd frontend && npm install && npm run build
cd ../backend && npm install && npm start
```

## Offline Install and Run

This project includes an offline bundle system in `offline/`.

Prepare while internet is available:

```bash
./offline/offline.sh prepare
```

Run offline with Docker (recommended):

```bash
./offline/offline.sh run docker
```

Run offline with npm fallback:

```bash
./offline/offline.sh run npm
```

Detailed instructions are in `offline/README.md`.

## Key Features Implemented

- UUID user identity with editable username and optional avatar field in profile model
- 1-to-1 encrypted chat
- Group creation with member IDs
- Presence list (online/offline)
- Typing indicator relay
- Push-to-talk voice notes with chunked encrypted transfer over WebSocket
- Store-and-forward to offline users via SQLite `pending` table
- WebRTC voice calls with signaling events (`offer`, `answer`, `ice`, `end`)
- Theme toggle (light/dark)
- Service worker app-shell caching for offline startup
- mDNS service advertisement and discovery endpoint (`/api/discovery`)
- First-run onboarding modal to configure username/key and copy UUID
- Backend event audit trail in SQLite `audit_logs`
- Configurable backend hardening limits via `.env`

## Production Notes

- In strict production environments, place this app behind HTTPS on LAN to maximize browser media compatibility.
- iOS background behavior and microphone policies are browser-dependent.
- For stronger cryptographic trust, replace shared-passphrase keying with verified public-key identity exchange.
- Voice-note full media blobs are retained locally; backend stores voice-note metadata plus encrypted transfer stream only.

# Prepper System (Raspberry Pi 4, Fully Offline)

Commercial-grade offline stack for emergency operations, knowledge access, local communication, and resilient field deployment.

Profiles:
- Base profile (default): AI and Maps disabled for lower RAM usage.
- Full profile: enables Ollama and TileServer-GL.

## 1) What This Build Includes

- Offline knowledge library with Kiwix and multi-library support.
- Offline search service for local files + Kiwix library metadata.
- File sharing over LAN with File Browser.
- Offline AI assistant with Ollama API + built-in lightweight web chat UI.
- Offline maps using TileServer-GL and MBTiles.
- VoIP node using Asterisk with SIP extensions.
- Meshtastic USB serial bridge with local status/messages API.
- Reverse-proxy dashboard at `http://192.168.4.1`.

## 2) Folder Structure

```text
prepper-system/
  docker-compose.yml
  .env.example
  README.md

  nginx/
    nginx.conf

  html/
    index.html
    voip.html
    mesh.html
    ai/
      index.html
    pwa/
      manifest.webmanifest
      sw.js

  asterisk/
    Dockerfile
    config/
      asterisk.conf
      modules.conf
      pjsip.conf
      extensions.conf
      rtp.conf

  search/
    Dockerfile
    app.py

  mesh-bridge/
    Dockerfile
    app.py

  maps/
    mbtiles/
      # put region MBTiles files here

  system/
    prepper-stack.service
    network/
      hostapd.conf
      dnsmasq.conf
      dhcpcd.conf.snippet
  scripts/
    install-prepperpi.sh
    bootstrap-security.sh

  data/
    kiwix/
      library.xml
      # .zim files
    files/
    filebrowser-db/
    ollama/
    search-content/
    search-db/
    asterisk/
      spool/
      log/
      lib/
```

## 3) Service Endpoints

- Dashboard: `/`
- Wikipedia / Kiwix: `/wiki/`
- Offline Search: `/search/`
- File Browser: `/files/`
- AI Web UI: `/ai/`
- Ollama API (proxied): `/ollama/`
- Maps: `/maps/`
- Mesh status API: `/mesh/api/status`
- Mesh messages API: `/mesh/api/messages`
- VoIP info page: `/voip.html`

Asterisk network ports (UDP):
- `5060` SIP
- `10000-10100` RTP

## 4) Raspberry Pi Setup Steps

### A. Base OS (Raspberry Pi OS Lite 64-bit)

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin hostapd dnsmasq
sudo systemctl enable docker
sudo systemctl start docker
```

### B. Configure Wi-Fi AP (PrepperPi @ 192.168.4.1)

1. Copy `system/network/hostapd.conf` to `/etc/hostapd/hostapd.conf`.
2. Set `/etc/default/hostapd`:

```bash
DAEMON_CONF="/etc/hostapd/hostapd.conf"
```

3. Copy `system/network/dnsmasq.conf` to `/etc/dnsmasq.conf`.
4. Append `system/network/dhcpcd.conf.snippet` to `/etc/dhcpcd.conf`.
5. Restart networking services:

```bash
sudo systemctl unmask hostapd
sudo systemctl enable hostapd
sudo systemctl enable dnsmasq
sudo systemctl restart dhcpcd
sudo systemctl restart hostapd
sudo systemctl restart dnsmasq
```

### C. Prepare Content

- Place `.zim` files in `data/kiwix/` and adjust `data/kiwix/library.xml`.
- Put MBTiles map files in `maps/mbtiles/`.
- Add indexed documents to `data/search-content/`.

### D. Launch Stack

```bash
cp .env.example .env
# set MESHTASTIC_DEVICE in .env if used

docker compose build
docker compose up -d
```

To run the complete stack with AI and Maps:

```bash
docker compose --profile full build
docker compose --profile full up -d
```

### E. Pull AI Model

```bash
docker compose exec ollama ollama pull llama3.2:3b
```

### F. Initialize File Browser Admin

```bash
docker compose exec filebrowser filebrowser users add admin StrongOfflinePass --perm.admin
```

Or run the included bootstrap script to create/update both admin and operator users:

```bash
FILEBROWSER_ADMIN_PASS='StrongOfflinePass' FILEBROWSER_OPS_PASS='OpsPass' ./scripts/bootstrap-security.sh
```

## 5) One-Command Pi Installer

Run as root on Raspberry Pi OS:

```bash
sudo ./scripts/install-prepperpi.sh base
```

Or for full profile:

```bash
sudo ./scripts/install-prepperpi.sh full
```

Installer actions:
- Installs Docker + required packages.
- Applies AP config (PrepperPi on 192.168.4.1).
- Applies host firewall policy (allow only SSH, HTTP, SIP, RTP).
- Installs and enables the systemd stack service.
- Builds and starts the stack.

## 6) Auto-Start on Boot

Copy the stack to `/opt/prepper-system` and install service:

```bash
sudo cp system/prepper-stack.service /etc/systemd/system/prepper-stack.service
sudo systemctl daemon-reload
sudo systemctl enable prepper-stack.service
sudo systemctl start prepper-stack.service
```

## 7) Security and Hardening

- Keep only required host-exposed ports: `80`, `5060/udp`, `10000-10100/udp`.
- All web apps except gateway stay internal on Docker bridge network.
- Enable file browser authentication immediately.
- Use `scripts/bootstrap-security.sh` to enforce admin + non-admin accounts.
- Change SSID passphrase in `hostapd.conf`.
- Use `no-new-privileges` for non-privileged containers.
- Nginx gateway includes request rate limits for anti-abuse on LAN.
- Keep system fully offline unless manual update window is required.

## 8) Pi Resource Optimization

- Use one LLM loaded at once (`OLLAMA_MAX_LOADED_MODELS=1`).
- Prefer 3B to 7B models for smooth response on Pi 4.
- Default base profile excludes AI and Maps to reduce idle memory footprint.
- Use no-image / compressed ZIM variants for storage and speed.
- Keep MBTiles region-scoped instead of global datasets.
- Use active cooling and set conservative CPU governor if thermal throttling appears.

## 9) Storage Recommendations

- 128GB: Core stack, one compact Wikipedia, one region map, one 3B model.
- 256GB: Multiple ZIM libraries, broader map coverage, two LLM variants.
- 512GB: Extended libraries, multi-region MBTiles, redundancy snapshots, large field datasets.

## 10) Optional Enhancements

- Add WireGuard over Ethernet for secure sync windows between nodes.
- Add nightly backup job to external SSD using `restic`.
- Add UPS HAT and power-loss safe shutdown automation.
- Add second Pi as warm standby and replicate `data/` with scheduled rsync.
- Integrate Whisper.cpp offline STT for voice command layer.

## 11) Operational Checks

```bash
docker compose ps
docker compose logs --tail=100 gateway
docker compose logs --tail=100 asterisk
docker compose logs --tail=100 mesh-bridge
```

If dashboard loads but modules fail, verify AP IP is `192.168.4.1` and all containers are `Up`.

Enable full-profile services later from base mode:

```bash
docker compose --profile full up -d ollama maps
```

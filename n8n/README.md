# n8n Setup Modes

This guide shows what to change in `docker-compose.yaml` to run n8n in either:

- Device IP mode (no tunnel, local network HTTP)
- Cloudflare Tunnel mode (public HTTPS domain)

## File to edit

- `docker-compose.yaml`
- Service: `n8n`
- Section: `environment`

## Mode 1: Device IP (Direct Access)

Use this when you want to open n8n from your device IP (for example from another device on the same LAN).

Set these values:

```yaml
- N8N_HOST=<IP_ADDRESS>
- N8N_PORT=5678
- N8N_PROTOCOL=http
- WEBHOOK_URL=http://<IP_ADDRESS>:5678/
- N8N_EDITOR_BASE_URL=http://<IP_ADDRESS>:5678/
- N8N_PROXY_HOPS=0
- N8N_SECURE_COOKIE=false
```

Open:

- http://<IP_ADDRESS>:5678

Get your IP on macOS:

```bash
ipconfig getifaddr en0 || ipconfig getifaddr en1
```

Docker Compose can expose n8n directly on your IP because of this port mapping in `docker-compose.yaml`:

```yaml
ports:
  - "5678:5678"
```

This publishes container port `5678` on the host, so `http://<IP_ADDRESS>:5678` works.

## Mode 2: Cloudflare Tunnel

Use this when exposing n8n through Cloudflare Tunnel with a domain such as `n8n.example.com`.

Set these values:

```yaml
- N8N_HOST=n8n.example.com
- N8N_PORT=5678
- N8N_PROTOCOL=https
- WEBHOOK_URL=https://n8n.example.com/
- N8N_EDITOR_BASE_URL=https://n8n.example.com/
- N8N_PROXY_HOPS=1
- N8N_SECURE_COOKIE=true
```

Replace `n8n.example.com` with your real domain.

## Cloudflare Tunnel quick settings

In Cloudflare Zero Trust > Tunnels > Public Hostname:

- Hostname: `n8n.example.com`
- Service type: `HTTP`
- URL: `http://localhost:5678`

Example `cloudflared` config:

```yaml
ingress:
  - hostname: n8n.example.com
    service: http://localhost:5678
  - service: http_status:404
```

## Apply changes

From the `n8n` folder:

```bash
docker compose down
docker compose up -d
```

Check status:

```bash
docker compose ps
```

## Notes

- If you use Cloudflare mode, keep `N8N_SECURE_COOKIE=true`.
- If you use device IP mode over plain HTTP, set `N8N_SECURE_COOKIE=false`.
- Do not keep both localhost and Cloudflare values at the same time.

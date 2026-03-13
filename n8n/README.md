# n8n Setup Modes

This guide shows what to change in `docker-compose.yaml` to run n8n in either:

- Localhost mode (no tunnel, local HTTP)
- Cloudflare Tunnel mode (public HTTPS domain)

## File to edit

- `docker-compose.yaml`
- Service: `n8n`
- Section: `environment`

## Mode 1: Localhost

Use this when you are running n8n only on your local machine.

Set these values:

```yaml
- N8N_HOST=localhost
- N8N_PORT=5678
- N8N_PROTOCOL=http
- WEBHOOK_URL=http://localhost:5678/
- N8N_EDITOR_BASE_URL=http://localhost:5678/
- N8N_PROXY_HOPS=1
- N8N_SECURE_COOKIE=false
```

Open:

- http://localhost:5678

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
- If you use localhost mode over plain HTTP, set `N8N_SECURE_COOKIE=false`.
- Do not keep both localhost and Cloudflare values at the same time.

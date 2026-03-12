# Kiwi TCMS

Kiwi TCMS is an open-source test management system designed to help teams manage their testing efforts efficiently. This document provides instructions on how to start, configure, upgrade, and customize Kiwi TCMS using Docker containers.

---

## Prerequisites

- Docker and Docker Compose installed on your system.
- Basic knowledge of Docker container management.

---

## Starting Kiwi TCMS

To start Kiwi TCMS, execute the following commands:

```bash
cd path/to/your-docker-compose-git-repo/
docker compose up -d
```

This will create two containers:

- A web container based on the latest Kiwi TCMS image.
- A database container based on the official MariaDB image for Kiwi TCMS Community Edition or the official PostgreSQL image for Kiwi TCMS Enterprise. For differences, see [Kiwi TCMS Features](https://kiwitcms.org/features/).

Docker Compose will also create two volumes for persistent data storage: `kiwi_db_data` and `kiwi_uploads`.

> **Note:** The Kiwi TCMS container binds to all network addresses on the system. To use it across your organization, distribute the Fully Qualified Domain Name (FQDN) of the system running the Docker container to all associates.

> **Warning:** For Kiwi TCMS Enterprise, the application must be served via a FQDN. Using IP addresses will not work! See [DNS Configuration for Kiwi TCMS Enterprise](https://github.com/kiwitcms/tenants/#dns-configuration) for more information.

---

## Database Credentials Configuration

Database connection credentials can be configured via Docker Secrets or by mounting text files inside the container. You must configure the absolute path to the file containing the actual value as an environment variable inside the running container.

Examples:

- `KIWI_DB_PASSWORD: kiwi` — Password specified as plain text.
- `KIWI_DB_PASSWORD: /run/secret/db_password` — Password read from Docker Secret file.
- `KIWI_DB_PASSWORD: /Kiwi/config/db_password.txt` — Password read from a mounted file inside the container.

> **Warning:** When specifying an absolute path, the file will be opened in text mode with UTF-8 encoding. Trailing newlines and whitespace will be stripped.

> **Warning:** Kiwi TCMS Enterprise supports database configuration via the `DATABASE_URL` environment variable (added in version 11.4). If specified, this overrides the `KIWI_DB_*` variables. Do not use both simultaneously.

> **Important:** Kiwi TCMS does not provide versioned Docker images via Docker Hub. For more information, see [Kiwi TCMS Containers](https://kiwitcms.org/containers/).

---

## Initial Configuration of Running Container

Before accessing Kiwi TCMS via a browser, perform the interactive initial setup:

```bash
docker exec -it kiwi_web /Kiwi/manage.py initial_setup
```

This command will:

- Create the necessary database structure.
- Create a super-user account.
- Adjust internal settings as needed.

Once complete, access your Kiwi TCMS instance at:

- `https://localhost` (Community Edition)
- `https://kiwi-tenants-domain` (Enterprise Edition)

> **Note:** The `-i` option keeps STDIN open, and `-t` allocates a pseudo-TTY. For automated scripts, you may need to remove `-t`. See [docker exec options](https://docs.docker.com/engine/reference/commandline/exec/#options) for details.

---

## Upgrading Kiwi TCMS

To upgrade running Kiwi TCMS containers, execute:

```bash
cd path/containing/docker-compose/
docker compose down
docker compose pull
docker compose up -d
docker exec -it kiwi_web /Kiwi/manage.py upgrade
```

> **Warning:** Always run the upgrade command and ensure it reports no errors. This updates your database schema to match the latest Kiwi TCMS version.

After upgrading, verify all migrations are applied:

```bash
docker exec -it kiwi_web /Kiwi/manage.py showmigrations
```

> **Important:** Version-tagged and multi-architecture container images are available only to Kiwi TCMS subscribers.

> **Note:** Uploads and database data are stored in separate volumes, making upgrades easy. Always back up your data before upgrading.

Kiwi TCMS recommends testing upgrades on a staging server to minimize migration risks. Pay special attention to database changelog entries for each release.

---

## SSL Configuration

By default, Kiwi TCMS is served via HTTPS using a self-signed certificate valid for 10 years with the following properties:

- CN = container-layer-hash-id
- OU = Quality Engineering
- O = Kiwi TCMS
- L = Sofia
- C = BG

The certificate authority file is available at `https://localhost/static/ca.crt`. Distribute this file to all browsers accessing Kiwi TCMS.

To use a different SSL certificate, update the `localhost.key` and `localhost.crt` files located under `/Kiwi/ssl/` or bind-mount your own SSL directory to `/Kiwi/ssl` inside the container.

For more information on generating self-signed certificates, see [sscg GitHub](https://github.com/sgallagher/sscg#full-usage).

> **Warning:** Kiwi TCMS will issue a warning if the connection is not secured by SSL (added in version 10.4).

---

## Reverse Proxy SSL Configuration

If serving Kiwi TCMS behind a reverse proxy handling SSL termination (e.g., Nginx or HAProxy), the browser will see a wildcard SSL certificate for `*.kiwitcms.org`, while the Docker containers use the default self-signed certificate.

### Example Nginx Configuration

```nginx
http {
    ssl_certificate     /etc/nginx/wildcard_kiwitcms_org.crt;
    ssl_certificate_key /etc/nginx/wildcard_kiwitcms_org.key;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;

    server {
        listen 8080;
        server_name public.tenant.kiwitcms.org;

        location / {
            return 301 https://$host$request_uri;
        }
    }

    server {
        server_name public.tenant.kiwitcms.org;
        listen 8443 ssl;

        location / {
            proxy_pass https://tenant_kiwitcms_org_web:8443;
        }
    }
}
```

### Example HAProxy Configuration

```haproxy
frontend front_http
    bind *:8080
    reqadd X-Forwarded-Proto:\ http
    redirect scheme https code 301

frontend front_https
    bind *:8443 ssl crt /etc/haproxy/ssl/
    reqadd X-Forwarded-Proto:\ https

    acl kiwitcms hdr(host) -i public.tenant.kiwitcms.org
    use_backend back_kiwitcms if kiwitcms

backend back_kiwitcms
    http-request set-header X-Forwarded-Port %[dst_port]
    http-request add-header X-Forwarded-Proto https

    rspadd Strict-Transport-Security:\ max-age=15768000
    rspadd X-XSS-Protection:\ 1;\ mode=block

    server kiwi_web tenant_kiwitcms_org_web:8443 ssl verify none
```

---

## HTTP Access

Kiwi TCMS enforces HTTPS connections by redirecting HTTP (port 80) requests to HTTPS (port 443).

> **Warning:** This behavior can no longer be disabled via the `KIWI_DONT_ENFORCE_HTTPS` environment variable (removed in version 12.0).

---

## Customization

You can override default settings provided by `tcms/settings/product.py` by editing your `docker-compose.yml` file.

### Mount a Single Override File

```yaml
volumes:
    - uploads:/Kiwi/uploads
    - ./local_settings.py:/venv/lib64/python3.11/site-packages/tcms/settings/local_settings.py
```

If this file exists, it is imported before any files under `tcms_settings_dir/`.

### Mount Multiple Override Files

```yaml
volumes:
    - uploads:/Kiwi/uploads
    - ./my_settings_dir/email_config.py:/venv/lib64/python3.9/site-packages/tcms_settings_dir/email_config.py
    - ./my_settings_dir/multi_tenant.py:/venv/lib64/python3.9/site-packages/tcms_settings_dir/multi_tenant.py
```

> **Important:** Filenames under `my_settings_dir/` must be valid Python module names and importable. Modules are imported alphabetically. The directory must contain an `__init__.py` file with the following content:

```python
__path__ = __import__('pkgutil').extend_path(__path__, __name__)
```

This enables `tcms_settings_dir` to be treated as a namespace package.

For more information, see Kiwi TCMS configuration settings.

> **Warning:** Some older Docker versions do not support mounting files between host and container, only directories and volumes. This may cause errors when starting the container. Upgrade Docker or copy files into the image as a workaround.

---

## Creating a Customized Docker Image

Modifying the default Dockerfile directly is not recommended as it is under version control and may conflict with updates.

Instead, create a downstream Docker image by providing a `Dockerfile.myorg` that inherits from the official image and adds your changes as separate layers.

Keep this in a separate repository with your build instructions and customized `docker-compose.yml`.

---

## Troubleshooting

Kiwi TCMS container logs HTTPD output to STDOUT.

> **Warning:** To view logs, start containers in the foreground without `-d`:

```bash
docker compose up
```

Or use:

```bash
docker container logs -f --tail 1000 kiwi_web
```

If you encounter a 500 Internal Server Error without a traceback, enable debug mode by setting `DEBUG=True` and restart the container. This will show detailed error information.

When reporting issues, please include relevant tracebacks as plain text.

---

For more information, visit the [Kiwi TCMS website](https://kiwitcms.org/) and [GitHub repository](https://github.com/kiwitcms/kiwitcms).

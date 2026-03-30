# Offline Bundle Usage

This folder contains everything needed to run LAN Messenger without internet.

## What is in this folder

- `prepare-offline.sh`: Prepares all offline assets (run while online)
- `run-offline.sh`: Runs the app in offline mode
- `offline.sh`: Unified helper script (`prepare` and `run`)
- `backend-node_modules.tgz`: Backend dependencies bundle
- `frontend-node_modules.tgz`: Frontend dependencies bundle
- `frontend-dist.tgz`: Built frontend bundle
- `lan-messenger-image.tar`: Prebuilt app Docker image
- `node20-bookworm-slim.tar`: Base Node image for offline Docker fallback
- `offline-manifest.txt`: Generated metadata

## Quick Start

From `local_chat`:

```bash
./offline/offline.sh prepare
./offline/offline.sh run docker
```

Open:

```text
http://<host-lan-ip>:3000
```

## Command Reference

Prepare offline package (online step):

```bash
./offline/offline.sh prepare
```

Run offline with Docker (recommended):

```bash
./offline/offline.sh run docker
```

Run offline with npm (fallback):

```bash
./offline/offline.sh run npm
```

Direct script usage (equivalent):

```bash
./offline/prepare-offline.sh
./offline/run-offline.sh docker
./offline/run-offline.sh npm
```

## Move to Another Offline Machine

Copy these to the target machine:

- project folder `local_chat`
- full `offline/` folder (all files)

Then on target machine:

```bash
cd local_chat
chmod +x offline/*.sh
./offline/offline.sh run docker
```

## Notes

- Docker mode does not rebuild; it uses prebuilt images from `offline/*.tar`.
- npm mode restores dependencies from `*.tgz` if `node_modules` are missing.
- If code or dependencies change, run `./offline/offline.sh prepare` again while online.

export class WsClient {
  constructor({ onMessage, onOpen, onClose }) {
    this.onMessage = onMessage;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.ws = null;
    this.retryMs = 1500;
    this.closedByUser = false;
    this.retryTimer = null;
  }

  connect() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      this.retryMs = 1500;
      this.onOpen?.();
    });

    this.ws.addEventListener('message', (event) => {
      try {
        this.onMessage?.(JSON.parse(event.data));
      } catch {
        // Ignore malformed payloads.
      }
    });

    this.ws.addEventListener('close', () => {
      this.onClose?.();
      if (!this.closedByUser) {
        this.retryTimer = setTimeout(() => this.connect(), this.retryMs);
        this.retryMs = Math.min(this.retryMs * 1.8, 8000);
      }
    });
  }

  reconnectNow() {
    this.closedByUser = false;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
      return;
    }
    this.connect();
  }

  send(action, payload = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ action, ...payload }));
  }

  close() {
    this.closedByUser = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.ws?.close();
  }
}

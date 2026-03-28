import crypto from 'node:crypto';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const URL = 'wss://localhost:3000/ws';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowMs = () => Number(process.hrtime.bigint() / 1000000n);

function randomPin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function randomId() {
  return crypto.randomUUID();
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function connectClient(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const timer = setTimeout(() => reject(new Error(`${label} connect timeout`)), 10000);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve(ws);
    }, { once: true });
    ws.addEventListener('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`${label} connect error: ${e?.message || 'unknown'}`));
    }, { once: true });
  });
}

function sendHello(ws, { userId, username, about, pin, authMode = 'new' }) {
  ws.send(JSON.stringify({
    action: 'hello',
    userId,
    username,
    about,
    avatar: '',
    pin,
    authMode,
    profileUpdate: false
  }));
}

function waitForAction(ws, action, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMsg);
      reject(new Error(`${action} timeout`));
    }, timeoutMs);

    const onMsg = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.action === action) {
          clearTimeout(timer);
          ws.removeEventListener('message', onMsg);
          resolve(data);
          return;
        }
        if (data.action === 'error') {
          clearTimeout(timer);
          ws.removeEventListener('message', onMsg);
          reject(new Error(`error action: ${data.code}`));
        }
      } catch {}
    };

    ws.addEventListener('message', onMsg);
  });
}

function mkPayload(i) {
  return {
    iv: crypto.randomBytes(12).toString('base64'),
    cipher: Buffer.from(`bench-msg-${i}-${'x'.repeat(96)}`).toString('base64'),
    tag: crypto.randomBytes(16).toString('base64')
  };
}

async function main() {
  const sender = await connectClient('sender');
  const receiver = await connectClient('receiver');

  sendHello(sender, {
    userId: randomId(),
    username: 'BenchSender',
    about: 'benchmark sender',
    pin: randomPin(),
    authMode: 'new'
  });

  sendHello(receiver, {
    userId: randomId(),
    username: 'BenchReceiver',
    about: 'benchmark receiver',
    pin: randomPin(),
    authMode: 'new'
  });

  const senderAck = await waitForAction(sender, 'hello-ack');
  const receiverAck = await waitForAction(receiver, 'hello-ack');
  const receiverUserId = receiverAck.userId;

  const TOTAL = 1200;
  const CONCURRENCY = 200;
  const PAGE_LIMIT = 120;

  const sendTimes = new Map();
  const latencies = [];
  let acked = 0;
  let delivered = 0;
  let received = 0;

  sender.addEventListener('message', (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.action === 'direct-message-ack' && data.id) {
        const t0 = sendTimes.get(data.id);
        if (t0 != null) {
          latencies.push(nowMs() - t0);
          sendTimes.delete(data.id);
          acked += 1;
        }
      }
      if (data.action === 'direct-delivered') {
        delivered += 1;
      }
    } catch {}
  });

  receiver.addEventListener('message', (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.action === 'direct-message') {
        received += 1;
      }
    } catch {}
  });

  const ids = Array.from({ length: TOTAL }, () => randomId());
  const tStart = nowMs();
  let sent = 0;
  let inFlight = 0;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('send phase timeout')), 120000);

    const pump = () => {
      while (inFlight < CONCURRENCY && sent < TOTAL) {
        const id = ids[sent];
        sendTimes.set(id, nowMs());
        sender.send(JSON.stringify({
          action: 'direct-message',
          id,
          to: receiverUserId,
          contentType: 'text',
          payload: mkPayload(sent),
          createdAt: Date.now()
        }));
        sent += 1;
        inFlight += 1;
      }
    };

    const tick = setInterval(() => {
      inFlight = Math.max(0, sent - acked);
      pump();
      if (acked >= TOTAL) {
        clearInterval(tick);
        clearTimeout(timeout);
        resolve();
      }
    }, 5);

    pump();
  });

  const tEnd = nowMs();
  const elapsedMs = tEnd - tStart;
  const throughput = TOTAL / (elapsedMs / 1000);

  const waitHistory = (timeoutMs = 20000) => waitForAction(sender, 'history-response', timeoutMs);

  const h1Start = nowMs();
  sender.send(JSON.stringify({ action: 'history-request', peerId: receiverUserId, limit: PAGE_LIMIT }));
  const page1 = await waitHistory();
  const h1Ms = nowMs() - h1Start;

  let page2 = { messages: [], hasMore: false };
  let h2Ms = 0;
  if (Array.isArray(page1.messages) && page1.messages.length > 0) {
    const before = page1.messages[0].created_at || page1.messages[0].createdAt;
    const h2Start = nowMs();
    sender.send(JSON.stringify({ action: 'history-request', peerId: receiverUserId, before, limit: PAGE_LIMIT }));
    page2 = await waitHistory();
    h2Ms = nowMs() - h2Start;
  }

  await sleep(250);

  const sorted = [...latencies].sort((a, b) => a - b);
  const out = {
    benchmark: {
      totalMessages: TOTAL,
      concurrency: CONCURRENCY,
      elapsedMs,
      throughputMsgPerSec: Number(throughput.toFixed(2)),
      acked,
      deliveredEvents: delivered,
      receiverDirectMessages: received
    },
    latencyMs: {
      min: sorted[0] || 0,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      max: sorted[sorted.length - 1] || 0,
      mean: sorted.length ? Number((sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2)) : 0
    },
    historyPaging: {
      pageLimit: PAGE_LIMIT,
      page1: {
        responseMs: h1Ms,
        count: Array.isArray(page1.messages) ? page1.messages.length : 0,
        hasMore: Boolean(page1.hasMore)
      },
      page2: {
        responseMs: h2Ms,
        count: Array.isArray(page2.messages) ? page2.messages.length : 0,
        hasMore: Boolean(page2.hasMore)
      }
    }
  };

  console.log(JSON.stringify(out, null, 2));

  sender.close();
  receiver.close();
}

main().catch((err) => {
  console.error('BENCH_ERR', err?.stack || err);
  process.exit(1);
});

const WebSocket = require('/app/backend/node_modules/ws');
const crypto = require('crypto');

const URL = 'wss://localhost:3000/ws';
const WS_OPTS = { rejectUnauthorized: false };
const nowMs = () => Number(process.hrtime.bigint() / 1000000n);
const randomPin = () => String(Math.floor(100000 + Math.random() * 900000));
const randomId = () => crypto.randomUUID();

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function connectClient(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL, WS_OPTS);
    const timer = setTimeout(() => reject(new Error(label + ' connect timeout')), 10000);
    ws.once('open', () => { clearTimeout(timer); resolve(ws); });
    ws.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

function waitHelloAck(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('hello timeout')), 10000);
    const onMsg = (buf) => {
      try {
        const d = JSON.parse(buf.toString());
        if (d.action === 'hello-ack') {
          clearTimeout(timer);
          ws.off('message', onMsg);
          resolve(d);
        }
      } catch {}
    };
    ws.on('message', onMsg);
  });
}

function mkPayload(i) {
  return {
    iv: crypto.randomBytes(12).toString('base64'),
    cipher: Buffer.from('bulk2-' + i + '-' + 'x'.repeat(96)).toString('base64'),
    tag: crypto.randomBytes(16).toString('base64')
  };
}

async function run() {
  const sender = await connectClient('sender');
  const receiver = await connectClient('receiver');

  sender.send(JSON.stringify({ action: 'hello', userId: randomId(), username: 'BenchSender2', about: 'bench', avatar: '', pin: randomPin(), authMode: 'new', profileUpdate: false }));
  receiver.send(JSON.stringify({ action: 'hello', userId: randomId(), username: 'BenchReceiver2', about: 'bench', avatar: '', pin: randomPin(), authMode: 'new', profileUpdate: false }));

  await waitHelloAck(sender);
  const recvAck = await waitHelloAck(receiver);
  const toUser = recvAck.userId;

  const TOTAL = 220;
  const CONCURRENCY = 55;

  let acked = 0;
  let errors = 0;
  const sendTimes = new Map();
  const latencies = [];

  sender.on('message', (buf) => {
    try {
      const d = JSON.parse(buf.toString());
      if (d.action === 'direct-message-ack') {
        const t0 = sendTimes.get(d.id);
        if (t0 != null) {
          latencies.push(nowMs() - t0);
          sendTimes.delete(d.id);
        }
        acked += 1;
      } else if (d.action === 'error') {
        errors += 1;
      }
    } catch {}
  });

  const ids = Array.from({ length: TOTAL }, () => randomId());
  let sent = 0;
  let inFlight = 0;
  const start = nowMs();

  await new Promise((resolve) => {
    const tick = setInterval(() => {
      inFlight = Math.max(0, sent - acked - errors);
      while (inFlight < CONCURRENCY && sent < TOTAL) {
        const id = ids[sent];
        sendTimes.set(id, nowMs());
        sender.send(JSON.stringify({ action: 'direct-message', id, to: toUser, contentType: 'text', payload: mkPayload(sent), createdAt: Date.now() }));
        sent += 1;
        inFlight += 1;
      }
      if ((acked + errors) >= TOTAL) {
        clearInterval(tick);
        resolve();
      }
    }, 10);
  });

  const end = nowMs();
  const sorted = latencies.sort((a, b) => a - b);

  console.log(JSON.stringify({
    benchmark: {
      totalAttempted: TOTAL,
      concurrency: CONCURRENCY,
      elapsedMs: end - start,
      throughputMsgPerSec: Number(((acked + errors) / ((end - start) / 1000)).toFixed(2)),
      acked,
      errors
    },
    latencyMs: {
      min: sorted[0] || 0,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      max: sorted[sorted.length - 1] || 0,
      mean: sorted.length ? Number((sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2)) : 0
    }
  }, null, 2));

  sender.close();
  receiver.close();
}

run().catch((e) => {
  console.error('BENCH2_ERR', e && e.stack ? e.stack : e);
  process.exit(1);
});

const eventBus = require('../events/eventBus');
const metrics = require('../metrics/metrics');
const security = require('../security/security');
const agents = require('../agents');
const sseClients = require('./clients');

function buildSnapshot() {
  return {
    metrics: metrics.current(),
    security: security.snapshot(),
    agents: agents.snapshot(),
    sseClients: sseClients.count()
  };
}

function handler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 3000\n\n');

  let lastSeq = 0;
  let closed = false;

  const send = (event) => {
    try {
      res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      cleanup();
    }
  };

  const unsubscribe = eventBus.subscribe((event) => {
    if (event.seq <= lastSeq) return;
    lastSeq = event.seq;
    send(event);
  });

  const snapshotEvent = {
    seq: eventBus.seq,
    boot: eventBus.bootId,
    type: 'snapshot',
    ts: new Date().toISOString(),
    data: buildSnapshot()
  };
  lastSeq = snapshotEvent.seq;
  send(snapshotEvent);

  const connectedAt = sseClients.add(res);
  eventBus.publish('sse_connect', { sseClients: connectedAt });

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (err) {
      cleanup();
    }
  }, 15000);

  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    const remaining = sseClients.remove(res);
    eventBus.publish('sse_disconnect', { sseClients: remaining });
    try {
      res.end();
    } catch (err) {
      res.destroy();
    }
  }

  req.on('close', cleanup);
  res.on('close', cleanup);
  req.on('error', cleanup);
  res.on('error', cleanup);
}

module.exports = { handler };

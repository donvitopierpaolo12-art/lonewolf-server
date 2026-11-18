const BASE = 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, headers = {}) {
  return fetch(BASE + path, { headers });
}

async function main() {
  console.log('--- LOAD TEST SSE: 50 client simultanei sotto burst ---');
  const base = await (await get('/api/metrics')).json();
  console.log(`RSS baseline: ${Math.round(base.process.rssBytes / 1048576)}MB · richieste totali: ${base.requests.total}`);

  const controllers = [];
  const streams = [];
  for (let i = 0; i < 50; i++) {
    const c = new AbortController();
    controllers.push(c);
    streams.push(fetch(BASE + '/api/events', { signal: c.signal, headers: { Accept: 'text/event-stream' } }));
  }
  const responses = await Promise.all(streams);
  const allOk = responses.every((r) => r.status === 200);
  console.log('50 connessioni SSE aperte:', allOk ? 'OK' : 'FAIL');

  const readers = responses.map((r) => r.body.getReader());
  const decoders = readers.map(() => new TextDecoder());
  const counters = readers.map(() => 0);
  const done = readers.map(() => false);

  const readTask = (async () => {
    for (let i = 0; i < readers.length; i++) {
      (async () => {
        while (!done[i]) {
          try {
            const { value, done: d } = await readers[i].read();
            if (d) break;
            const text = decoders[i].decode(value, { stream: true });
            counters[i] += text.split('\n\n').length - 1;
          } catch (e) { break; }
        }
      })();
    }
  })();

  await sleep(1500);
  const mid = await (await get('/api/metrics')).json();
  console.log(`RSS durante carico: ${Math.round(mid.process.rssBytes / 1048576)}MB · client SSE: ${mid.sseClients}`);

  const t0 = Date.now();
  const burst = [];
  for (let i = 0; i < 300; i++) burst.push(get('/api/status').then((r) => r.status));
  const statuses = await Promise.all(burst);
  const burstMs = Date.now() - t0;
  const counts = statuses.reduce((m, s) => { m[s] = (m[s] || 0) + 1; return m; }, {});
  console.log(`burst 300 richieste in ${burstMs}ms:`, JSON.stringify(counts));

  const t0b = Date.now();
  const un = await fetch(BASE + '/api/security/unblock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-lonewolf-admin': 'lw-admin-TEST' },
    body: JSON.stringify({ ip: '127.0.0.1' })
  });
  const unMs = Date.now() - t0b;
  const unBody = await un.json();
  console.log(`endpoint admin risulta reattivo anche col blocco attivo → ${un.status} in ${unMs}ms (unblocked=${unBody.unblocked})`);

  const after = await (await get('/api/metrics')).json();
  console.log(`RSS dopo burst: ${Math.round(after.process.rssBytes / 1048576)}MB · heap: ${Math.round(after.process.heapUsedBytes / 1048576)}MB`);

  await sleep(2000);
  controllers.forEach((c) => c.abort());
  await sleep(2500);

  let totalEvents = 0;
  let activeClients = 0;
  counters.forEach((c, i) => { if (c > 1) activeClients += 1; totalEvents += c; });

  const final = await (await get('/api/metrics')).json();
  console.log(`Eventi consegnati: ${totalEvents} (client attivi sul flusso: ${activeClients}/50)`);
  console.log(`RSS finale: ${Math.round(final.process.rssBytes / 1048576)}MB · client SSE residui: ${final.sseClients}`);

  console.log('filtro liveness:', final.sseClients === 0 ? 'PASS (nessuna connessione fantasma)' : 'FAIL');
  process.exit(0);
}

async function expiryTest() {
  const BLOCK = 4000;
  const WINDOW = 8000;
  for (let i = 0; i < 150; i++) await get('/api/status');
  let r = await get('/api/status');
  console.log('durante blocco:', r.status === 429 ? '429 OK' : 'FAIL ' + r.status);

  await sleep(BLOCK + 1500);
  r = await get('/api/status');
  console.log('scaduto il blocco, richieste ancora sopra soglia:', r.status === 429 ? '429 OK (ri-blocco immediato atteso)' : 'INATTESO ' + r.status);

  console.log(`attesa drano finestra (${WINDOW}ms di quiete)...`);
  await sleep(WINDOW + 1000);
  r = await get('/api/status');
  console.log('dopo quiete:', r.status === 200 ? '200 OK (riabilitazione automatica)' : 'FAIL ' + r.status);

  const sec = await (await get('/api/security')).json();
  const expired = sec.events.find((e) => e.type === 'block_expired');
  const reblocked = sec.events.find((e) => e.type === 'security_block');
  console.log('evento block_expired registrato:', expired ? 'OK' : 'NO');
  console.log('contatori: blocchi emessi =', sec.counters.blocksIssued, '· richieste bloccate =', sec.counters.blockedRequests, '· sorgenti attive =', sec.counters.activeBlocks);
  console.log(reblocked ? 'ri-blocco registrato: OK' : 'ri-blocco non registrato (throttle 500ms o assente)');
}

if (process.argv[2] === 'expiry') {
  expiryTest();
} else {
  main();
}

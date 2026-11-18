const BASE = 'http://localhost:3000';
let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, headers = {}) {
  return fetch(BASE + path, { headers, redirect: 'manual' });
}

async function post(path, headers = {}, body) {
  return fetch(BASE + path, { method: 'POST', headers, body, redirect: 'manual' });
}

const ADMIN = { 'Content-Type': 'application/json', 'x-lonewolf-admin': 'lw-admin-TEST' };

async function main() {
  console.log('--- 1. API FONDAMENTALI (regressione Fase 1) ---');
  let res = await get('/api/status');
  let body = await res.json();
  check('GET /api/status -> 200', res.status === 200);
  check('status shape invariata', body.success === true && body.status === 'online' && body.server === 'LONEWOLF SERVER' && typeof body.uptime.human === 'string');

  res = await get('/api/time');
  body = await res.json();
  check('GET /api/time -> 200', res.status === 200 && body.success === true && typeof body.unix === 'number');

  res = await get('/api/inesistente');
  body = await res.json();
  check('404 JSON su API inesistente', res.status === 404 && body.success === false);

  res = await get('/percorso-inesistente');
  const html404 = await res.text();
  check('404 HTML su pagina inesistente', res.status === 404 && html404.includes('404'));

  res = await get('/');
  const dash = await res.text();
  const headerMap = Object.fromEntries([...res.headers.entries()]);
  check('Dashboard servita -> 200', res.status === 200 && dash.includes('CENTRO DI CONTROLLO'));
  check('Helmet attivo (CSP presente)', Boolean(headerMap['content-security-policy']));
  check('Helmet attivo (nosniff)', headerMap['x-content-type-options'] === 'nosniff');
  check('x-powered-by rimosso', !headerMap['x-powered-by']);

  res = await get('/css/style.css');
  check('CSS statico servito', res.status === 200);
  res = await get('/js/dashboard.js');
  check('JS statico servito', res.status === 200);

  console.log('--- 2. METRICHE REALI ---');
  await sleep(2300);
  res = await get('/api/metrics');
  body = await res.json();
  check('GET /api/metrics -> 200', res.status === 200 && body.success === true);
  check('contatore richieste reale > 0', body.requests.total > 0, `total=${body.requests.total}`);
  check('CPU sistema numerica 0-100', typeof body.system.cpuPercent === 'number' && body.system.cpuPercent >= 0 && body.system.cpuPercent <= 100, `${body.system.cpuPercent}%`);
  check('RAM sistema reale', typeof body.system.ramPercent === 'number' && body.system.ramTotalBytes > 0, `${body.system.ramPercent}%`);
  check('memoria Node reale (rss > 0)', body.process.rssBytes > 0, `rss=${Math.round(body.process.rssBytes / 1048576)}MB`);
  check('statistiche API per endpoint', Array.isArray(body.api) && body.api.some((a) => a.endpoint.startsWith('GET /api/')), JSON.stringify(body.api.map((a) => a.endpoint).slice(0, 4)));
  check('uptime presente', typeof body.uptime.human === 'string');

  const totalBefore = body.requests.total;
  await get('/api/status');
  res = await get('/api/metrics');
  body = await res.json();
  check('contatore richieste cresce', body.requests.total > totalBefore, `${totalBefore} -> ${body.requests.total}`);

  console.log('--- 3. SSE /api/events ---');
  const controller = new AbortController();
  const sse = await fetch(BASE + '/api/events', { signal: controller.signal, headers: { Accept: 'text/event-stream' } });
  check('SSE -> 200 text/event-stream', sse.status === 200 && sse.headers.get('content-type').includes('text/event-stream'));

  const reader = sse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const received = [];
  let lastSeq = -1;
  let duplicateFound = false;
  let seqDecreased = false;
  let gotSnapshot = false;
  let gotMetrics = false;
  let metricsCount = 0;

  const readPromise = (async () => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop();
      for (const part of parts) {
        const dataLine = part.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        try {
          const event = JSON.parse(dataLine.slice(6));
          if (event.seq === lastSeq) duplicateFound = true;
          if (event.seq < lastSeq) seqDecreased = true;
          lastSeq = Math.max(lastSeq, event.seq);
          received.push(event);
          if (event.type === 'snapshot') gotSnapshot = true;
          if (event.type === 'metrics') {
            gotMetrics = true;
            metricsCount += 1;
          }
        } catch (e) {}
      }
    }
  })();

  const warmup = get('/api/status');
  await readPromise;
  check('SSE snapshot iniziale ricevuto', gotSnapshot);
  check('SSE aggiornamenti metriche periodici', gotMetrics && metricsCount >= 2, `${metricsCount} tick in ~10s`);

  const lastMetricsEvent = [...received].reverse().find((e) => e.type === 'metrics' || (e.type === 'snapshot' && e.data.metrics));
  const reqsAtStream = lastMetricsEvent
    ? (lastMetricsEvent.type === 'metrics' ? lastMetricsEvent.data.requests.total : lastMetricsEvent.data.metrics.requests.total)
    : 0;
  controller.abort();
  await warmup;
  await sleep(2000);

  res = await get('/api/metrics');
  body = await res.json();
  check('disconnessione SSE rilevata (client=0)', body.sseClients === 0, `sseClients=${body.sseClients}`);
  check('nessun duplicato o regressione di seq', !duplicateFound && !seqDecreased);
  check('dati SSE coerenti con backend', reqsAtStream > 0 && reqsAtStream <= body.requests.total, `stream=${reqsAtStream} <= reale=${body.requests.total}`);

  console.log('--- 4. RICHIESTE ANOMALE ---');
  res = await get('/api/security');
  const secBefore = (await res.json()).counters;

  res = await get('/api/status?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
  check('XSS bloccato -> 400', res.status === 400);
  res = await get('/api/status?file=%2e%2e%2f%2e%2e%2fetc%2fpasswd');
  check('Path traversal bloccato -> 400', res.status === 400);
  res = await get("/api/time?x=1'%20UNION%20SELECT%20*");
  check('SQL injection bloccata -> 400', res.status === 400);

  res = await post('/api/security/unblock', ADMIN, '{json malformato');
  check('JSON malformato -> 400', res.status === 400);

  res = await get('/api/security');
  let sec = await res.json();
  check('eventi sicurezza registrati', sec.counters.suspiciousAttempts > secBefore.suspiciousAttempts, `sospetti=${sec.counters.suspiciousAttempts}`);
  check('anomalie contate', sec.counters.anomaliesDetected > secBefore.anomaliesDetected);
  check('registro eventi popolato', Array.isArray(sec.events) && sec.events.length > 0);
  check('IP mascherati nel registro eventi', sec.events.every((e) => !e.source || e.source.includes('xxx') || e.source.endsWith('…')), JSON.stringify(sec.events.slice(0, 2).map((e) => e.source)));

  console.log('--- 5. RATE LIMITING + BLOCCO TEMPORANEO ---');
  const burstResults = new Map();
  for (let i = 0; i < 200; i++) {
    const r = await get('/api/status');
    burstResults.set(r.status, (burstResults.get(r.status) || 0) + 1);
  }
  check('burst riceve 429 oltre soglia', (burstResults.get(429) || 0) > 0, JSON.stringify([...burstResults]));

  res = await get('/api/status');
  check('sorgente bloccata: richieste rifiutate', res.status === 429);

  console.log('--- 6. ADMIN ENDPOINT PROTETTO ---');
  res = await post('/api/security/unblock', { 'Content-Type': 'application/json' }, JSON.stringify({ ip: '127.0.0.1' }));
  check('unblock senza token -> 401', res.status === 401);

  res = await post('/api/security/unblock', { 'Content-Type': 'application/json', 'x-lonewolf-admin': 'token-sbagliato' }, JSON.stringify({ ip: '127.0.0.1' }));
  check('unblock con token errato -> 401', res.status === 401);

  res = await post('/api/security/unblock', ADMIN, JSON.stringify({ ip: 'not-an-ip' }));
  check('unblock con input non valido -> 400', res.status === 400);

  res = await post('/api/security/unblock', ADMIN, JSON.stringify({ ip: '127.0.0.1' }));
  body = await res.json();
  check('unblock admin -> 200 e sblocca', res.status === 200 && body.success === true && body.unblocked === true, JSON.stringify(body));

  res = await get('/api/status');
  check('dopo sblocco le richieste passano di nuovo', res.status === 200);

  console.log('--- 7. STATO SICUREZZA POST-BLOCCO ---');
  res = await get('/api/security');
  sec = await res.json();
  check('blocchi emessi registrati', sec.counters.blocksIssued > secBefore.blocksIssued, `blocchi=${sec.counters.blocksIssued}`);
  check('richieste bloccate contate', sec.counters.blockedRequests > secBefore.blockedRequests, `bloccate=${sec.counters.blockedRequests}`);
  check('nessuna sorgente più bloccata dopo sblocco', sec.counters.activeBlocks === 0, `attivi=${sec.counters.activeBlocks}`);
  check('protezioni tutte segnalate attive', Object.values(sec.protections).every(Boolean));
  check('limiti configurati esposti', sec.limits.maxRequests > 0 && sec.limits.windowSec > 0, `max=${sec.limits.maxRequests}/${sec.limits.windowSec}s`);

  console.log('--- 8. SSE MULTIPLA E ESTINZIONE CONTEGGI ---');
  const c1 = new AbortController();
  const c2 = new AbortController();
  const s1 = fetch(BASE + '/api/events', { signal: c1.signal });
  const s2 = fetch(BASE + '/api/events', { signal: c2.signal });
  const [r1, r2] = await Promise.all([s1, s2]);
  await sleep(500);
  check('due sessioni SSE simultanee -> 200', r1.status === 200 && r2.status === 200);
  c1.abort();
  c2.abort();
  await sleep(2000);
  res = await get('/api/metrics');
  body = await res.json();
  check('conteggio client torna a 0 dopo chiusura', body.sseClients === 0, `sseClients=${body.sseClients}`);

  console.log('');
  console.log(`RISULTATO: ${passed} PASS, ${failed} FAIL`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('ERRORE TEST:', err);
  process.exit(1);
});

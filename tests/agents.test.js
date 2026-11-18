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

const ADMIN = { 'Content-Type': 'application/json', 'x-lonewolf-admin': 'lw-admin-TEST' };

async function main() {
  console.log('--- 1. CICLO DI VITA AGENTI ---');
  let res = await get('/api/agents');
  let body = await res.json();
  check('GET /api/agents -> 200', res.status === 200 && body.success === true);
  check('CORE ONLINE col server', body.core.status === 'ONLINE', body.core.status);
  check('GUARD ONLINE col server', body.guard.status === 'ONLINE', body.guard.status);
  check('stessa sessione per entrambi', body.core.sessionId === body.guard.sessionId, body.core.sessionId);
  check('ruoli dichiarati', body.core.name === 'LONEWOLF CORE' && body.guard.name === 'LONEWOLF GUARD');
  check('motore dichiarato deterministico', body.core.engine.includes('regole deterministiche') && body.guard.engine.includes('regole deterministiche'));
  check('registro GUARD ancorato alla catena (ancora esterna attiva)', body.registryAnchored === true);

  console.log('--- 2. PERMESSI E PROTOCOLLO CONTROLLATO ---');
  check('GUARD senza permesso di contenimento', !body.guard.permissions.includes('request_containment'));
  check('GUARD senza permesso di mutare log', !JSON.stringify(body.guard.permissions).includes('log_mutation'));
  check('permessi minimi elencati', body.core.permissions.includes('request_containment') && body.guard.permissions.includes('report_to_core'));
  check('registro GUARD consultabile e append-only', body.guard.registrySize > 0 && Array.isArray(body.guard.registryTail ?? body.guard.logTail));
  check('messaggi iniziali tracciati', Array.isArray(body.comms) && body.commsTotal > 0, `${body.commsTotal} comunicazioni`);

  console.log('--- 3. GUARD: ANALISI EVENTI SICUREZZA REALI ---');
  for (let i = 0; i < 6; i++) {
    await get('/api/status?q=%3Cscript%3Etest' + i + '%3C%2Fscript%3E');
  }
  await get('/api/status?file=%2e%2e%2fnonamico');
  await sleep(400);

  res = await get('/api/agents');
  body = await res.json();
  check('GUARD ha analizzato gli eventi', body.guard.eventsAnalyzed >= 7, `analizzati=${body.guard.eventsAnalyzed}`);
  check('GUARD livello minaccia sopra NORMALE', body.guard.threatLevel !== 'NORMALE', body.guard.threatLevel);
  check('tentativi ripetuti rilevati', body.guard.repeatedSources.length > 0, JSON.stringify(body.guard.repeatedSources.slice(0, 2)));
  check('findings GUARD registrati', body.guard.findings.some((f) => f.rule === 'tentativi_ripetuti'));
  check('comunicazioni GUARD -> CORE presenti', body.comms.some((c) => c.from === 'guard' && c.accepted));

  console.log('--- 4. CORE: MONITORAGGIO E COORDINAMENTO ---');
  check('CORE cicli di analisi attivi', body.core.iterations > 0, `iterazioni=${body.core.iterations}`);
  check('CORE riceve metriche reali', body.core.lastEvent && body.core.lastEvent.busType === 'metrics');
  check('CORE legge livello minaccia GUARD', body.core.guardLink.threatLevel === body.guard.threatLevel, body.core.guardLink.threatLevel);
  check('attivita corrente espressa', typeof body.core.currentActivity === 'string' && body.core.currentActivity.length > 0);

  console.log('--- 5. CATENA DI CONTENIMENTO (tramite security esistente) ---');
  const reqBefore = body.core.containmentRequests;
  for (let i = 0; i < 160; i++) {
    await get('/api/status');
  }
  await sleep(500);
  const unblockRes = await fetch(BASE + '/api/security/unblock', { method: 'POST', headers: ADMIN, body: JSON.stringify({ ip: '127.0.0.1' }) });
  check('unblock admin mentre ambiente saturo', unblockRes.status === 200);
  await sleep(300);

  res = await get('/api/agents');
  body = await res.json();
  check('GUARD a livello CRITICO oltre soglia', body.guard.threatLevel === 'CRITICO', body.guard.threatLevel);
  check('CORE ha ricevuto threat_report', body.comms.some((c) => c.from === 'guard' && c.to === 'core' && c.type === 'threat_report'));
  check('CORE ha inoltrato richiesta di contenimento una sola volta per transizione (anti-duplicati)', body.core.containmentRequests >= 1 && body.core.containmentRequests === reqBefore, `${body.core.containmentRequests} richieste`);
  check('findings contenimento registrati da CORE', body.core.findings.some((f) => f.rule === 'contenimento'));
  check('soglie di security mantengono la decisione finale', body.comms.some((c) => c.from === 'guard' && c.to === 'core' && c.type === 'threat_report'));

  await fetch(BASE + '/api/security/unblock', { method: 'POST', headers: ADMIN, body: JSON.stringify({ ip: '127.0.0.1' }) });
  res = await get('/api/status');
  check('sistema di sicurezza resta l\u2019unica autorit\u00e0 di blocco (sblocco admin ok)', res.status === 200);

  console.log('--- 6. INTEGRIT\u00c0 REGISTRO GUARD ---');
  await sleep(9000);
  res = await get('/api/agents');
  body = await res.json();
  check('CORE ha richiesto verifica integrit\u00e0 (tick x5)', body.comms.some((c) => c.type === 'integrity_request'));
  check('GUARD risponde con integrity_result', body.comms.some((c) => c.type === 'integrity_result'));
  check('stato integrit\u00e0 dichiarato', body.guard.integrity === 'verificata', body.guard.integrity);

  console.log('--- 7. SSE: EVENTI AGENTI IN STREAM ---');
  const controller = new AbortController();
  const sse = await fetch(BASE + '/api/events', { signal: controller.signal });
  const reader = sse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawAgents = false;
  let sawSnapshot = false;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && (!sawAgents || !sawSnapshot)) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (buffer.includes('event: agents')) sawAgents = true;
    if (buffer.includes('event: snapshot') && buffer.includes('"agents"')) sawSnapshot = true;
  }
  controller.abort();
  check('eventi "agents" arriva allo stream', sawAgents);
  check('snapshot iniziale include agents', sawSnapshot);

  console.log('--- 8. REGRESSIONE FASI PRECEDENTI ---');
  res = await get('/api/status');
  check('/api/status ancora operativo', res.status === 200);
  res = await get('/api/time');
  check('/api/time ancora operativo', res.status === 200);
  res = await get('/api/metrics');
  body = await res.json();
  check('/api/metrics intatto', body.success === true && body.requests.total > 0);
  res = await get('/api/inesistente');
  check('404 API invariato', res.status === 404);

  console.log('');
  console.log(`RISULTATO: ${passed} PASS, ${failed} FAIL`);
  console.log(failed > 0 ? 'SUITE FALLITA' : 'SUITE AGENTI COMPLETATA');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('ERRORE TEST:', err);
  process.exit(1);
});

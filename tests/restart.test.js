const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lw-restart-'));
const PORT = 3100 + (process.pid % 5000);
const BASE = `http://127.0.0.1:${PORT}`;
let currentChild = null;

const ENV = {
  ...process.env,
  PORT: String(PORT),
  HOST: '127.0.0.1',
  ADMIN_TOKEN: 'lw-admin-TEST',
  DATA_DIR,
  RATE_LIMIT_MAX: '8',
  RATE_WINDOW_MS: '60000',
  BLOCK_DURATION_MS: '600000',
  SUSPICIOUS_THRESHOLD: '50',
  STATE_SAVE_MS: '1000'
};

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) { pass += 1; console.log(`  PASS  ${name}${extra ? ' (' + extra + ')' : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${extra ? ' (' + extra + ')' : ''}`); }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ADMIN_HEADERS = { 'Content-Type': 'application/json', 'x-lonewolf-admin': 'lw-admin-TEST' };

async function adminUnblock() {
  const res = await fetch(`${BASE}/api/security/unblock`, {
    method: 'POST',
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ ip: '127.0.0.1' })
  });
  return res.status;
}

function waitForServer(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = async () => {
      try {
        const res = await fetch(`${BASE}/api/status`);
        if (res) return resolve(true);
      } catch (err) {}
      if (Date.now() - started > timeoutMs) return reject(new Error('server non raggiungibile'));
      setTimeout(poll, 200);
    };
    poll();
  });
}

function startServer() {
  return new Promise(async (resolve) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: ENV,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => { output += d.toString(); });
    await waitForServer();
    currentChild = child;
    resolve({ child, getOutput: () => output });
  });
}

function stopServer(child, signal = 'SIGTERM') {
  return new Promise((resolve) => {
    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => { output += d.toString(); });
    const timeout = setTimeout(() => { child.kill('SIGKILL'); }, 15000);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      resolve({ code, output });
    });
    child.kill(signal);
  });
}

async function burst(n) {
  const statuses = [];
  for (let i = 0; i < n; i++) {
    const res = await fetch(`${BASE}/api/status`);
    statuses.push(res.status);
  }
  return statuses;
}

async function readFirstEvent() {
  const res = await fetch(`${BASE}/api/events`);
  const reader = res.body.getReader();
  let text = '';
  while (text.length < 100) {
    const { value, done } = await reader.read();
    if (done) break;
    text += Buffer.from(value).toString('utf8');
    if (text.includes('data:')) break;
  }
  await reader.cancel().catch(() => {});
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  return line ? JSON.parse(line.slice(6)) : null;
}

async function main() {
  console.log('--- 1. BOOT 1: blocco attivo, metriche reali ---');
  const boot1 = await startServer();
  const statuses1 = await burst(10);
  check('rate limit: 429 durante il burst', statuses1.includes(429), `[${statuses1.join(',')}]`);
  check('admin-unblock raggiungibile con sorgente bloccata', (await adminUnblock()) === 200);
  const sec1 = await (await fetch(`${BASE}/api/security`)).json();
  check('contatore blocchi attivo in boot1', sec1.counters.blocksIssued >= 1, `issued=${sec1.counters.blocksIssued}`);
  const m1 = await (await fetch(`${BASE}/api/metrics`)).json();
  const a1 = await (await fetch(`${BASE}/api/agents`)).json();
  check('registro GUARD attivo in boot1', a1.guard.registrySize >= 1 && a1.registryAnchored === true);
  const e1 = await readFirstEvent();
  check('snapshot SSE contiene bootId', Boolean(e1 && e1.boot), `boot=${e1 && e1.boot ? e1.boot.slice(0, 8) : 'assente'}`);
  await burst(10);
  const blockedProbe1 = await fetch(`${BASE}/api/security`);
  check('blocco ri-attivo prima dell arresto (429)', blockedProbe1.status === 429);

  console.log('--- 2. ARRESTO CONTROLLATO (SIGTERM) ---');
  const stop1 = await stopServer(boot1.child);
  check('exit code 0 su SIGTERM', stop1.code === 0, `code=${stop1.code}`);
  check('chiusura ordinata loggata', stop1.output.includes('Server chiuso correttamente.'));

  console.log('--- 3. BOOT 2: RIPRISTINO STATO ---');
  const boot2 = await startServer();
  const blockedRes = await fetch(`${BASE}/api/status`);
  check('sorgente ancora bloccata dopo il riavvio (429)', blockedRes.status === 429);
  const blockedBody = await blockedRes.json();
  check('retryAfterMs ripristinato coerente', blockedBody.retryAfterMs > 0 && blockedBody.retryAfterMs <= 600000, `retryAfterMs=${blockedBody.retryAfterMs}`);
  check('admin-unblock in boot2', (await adminUnblock()) === 200);
  const sec2 = await (await fetch(`${BASE}/api/security`)).json();
  check('contatori cumulativi ripristinati', sec2.counters.blocksIssued > sec1.counters.blocksIssued, `boot1=${sec1.counters.blocksIssued} -> boot2=${sec2.counters.blocksIssued}`);
  const m2 = await (await fetch(`${BASE}/api/metrics`)).json();
  check('contatore richieste ripristinato', m2.requests.total >= m1.requests.total, `boot1=${m1.requests.total} -> boot2=${m2.requests.total}`);
  const a2 = await (await fetch(`${BASE}/api/agents`)).json();
  check('catena GUARD proseguita oltre il riavvio', a2.guard.registrySize > a1.guard.registrySize, `${a1.guard.registrySize} -> ${a2.guard.registrySize}`);
  check('ancora esterna valida dopo il riavvio', a2.registryAnchored === true);
  check('integrità GUARD verificata', a2.guard.integrity === 'verificata');
  const e2 = await readFirstEvent();
  check('bootId diverso tra i due avvii', Boolean(e2 && e2.boot && e1 && e1.boot && e2.boot !== e1.boot));
  check('nessun IP non mascherato nelle API', !JSON.stringify(sec2).includes('127.0.0.1') && !JSON.stringify(a2).includes('127.0.0.1'));

  console.log('--- 4. CHIUSURA E NUOVO AVVIO (SIGINT) ---');
  const stop2 = await stopServer(boot2.child, 'SIGINT');
  check('exit code 0 su SIGINT', stop2.code === 0, `code=${stop2.code}`);
  check('file di stato leggibile dopo SIGINT', typeof fs.readFileSync(path.join(DATA_DIR, 'state.json'), 'utf8') === 'string');
  const boot3 = await startServer();
  const a3 = await (await fetch(`${BASE}/api/agents`)).json();
  check('catena GUARD valida al terzo avvio', a3.registryAnchored === true && a3.guard.registrySize > a2.guard.registrySize, `-> ${a3.guard.registrySize}`);
  const stop3 = await stopServer(boot3.child);
  check('riavvii multipli senza degrado', stop3.code === 0);

  console.log(`\nRISULTATO RESTART: ${pass} PASS, ${fail} FAIL`);
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('ERRORE SUITE RESTART:', err);
  if (currentChild) currentChild.kill('SIGKILL');
  process.exit(1);
});

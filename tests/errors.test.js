const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORT = 3600 + (process.pid % 5000);
const ADMIN_HEADERS = { 'Content-Type': 'application/json', 'x-lonewolf-admin': 'lw-admin-TEST' };
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'lw-errors-'));

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) { pass += 1; console.log(`  PASS  ${name}${extra ? ' (' + extra + ')' : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${extra ? ' (' + extra + ')' : ''}`); }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function serverEnv(dataDir, extra = {}) {
  return {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    ADMIN_TOKEN: 'lw-admin-TEST',
    DATA_DIR: dataDir,
    SUSPICIOUS_THRESHOLD: '50',
    ...extra
  };
}

function startServer(dataDir, extra = {}) {
  return new Promise(async (resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: serverEnv(dataDir, extra),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => { output += d.toString(); });
    child.exitedWith = undefined;
    child.on('exit', (code) => { child.exitedWith = code; });
    const started = Date.now();
    const poll = async () => {
      if (child.exitedWith !== undefined) {
        return reject(new Error(`il server è terminato in anticipo (code=${child.exitedWith})\n${output}`));
      }
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/api/status`);
        if (res) return resolve({ child, output: () => output });
      } catch (err) {}
      if (Date.now() - started > 15000) {
        return reject(new Error(`server non raggiungibile\n${output}`));
      }
      setTimeout(poll, 200);
    };
    poll();
  });
}

function stopServer(child, signal = 'SIGTERM') {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
    child.kill(signal);
  });
}

function runScript(code, dataDir, port = PORT) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', code], {
      cwd: ROOT,
      env: serverEnv(dataDir, { PORT: String(port) }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => { output += d.toString(); });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('exit', (exitCode) => {
      clearTimeout(timeout);
      resolve({ code: exitCode, output });
    });
  });
}

function makeDir(name) {
  const dir = path.join(TMP_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function freshState(dataDir) {
  const server = await startServer(dataDir);
  await stopServer(server.child);
  return {
    state: JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8')),
    anchor: JSON.parse(fs.readFileSync(path.join(dataDir, 'anchor.json'), 'utf8'))
  };
}

async function scenarioCorruption() {
  console.log('--- 1. STATO CORROTTO (checksum non valido) ---');
  const dir = makeDir('corrupt');
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ checksum: 'x'.repeat(64), payload: '{"format":1}' }));
  const server = await startServer(dir);
  const sec = await (await fetch(`http://127.0.0.1:${PORT}/api/security`)).json();
  check('server operativo nonostante lo stato corrotto', sec.success === true);
  check('evento persist_corrupt registrato', sec.events.some((e) => e.type === 'persist_corrupt'));
  const files = fs.readdirSync(dir);
  check('copia corrotta conservata', files.some((f) => f.startsWith('state.json.corrupt-')), files.join(','));
  const code = await stopServer(server.child);
  check('chiusura ordinata', code === 0);
  const filesAfter = fs.readdirSync(dir);
  check('nessuna sovrascrittura della copia corrotta', filesAfter.some((f) => f.startsWith('state.json.corrupt-')));
}

async function scenarioIncomplete() {
  console.log('--- 2. SALVATAGGIO INCOMPLETO (solo state.json.tmp) ---');
  const dir = makeDir('incomplete-basic');
  const payload = JSON.stringify({
    format: 1,
    savedAt: new Date().toISOString(),
    bootId: 'boot-incompleto',
    security: { counters: { blockedRequests: 3, suspiciousAttempts: 9, anomaliesDetected: 2, blocksIssued: 1 }, blocked: [], log: [] },
    metrics: { totalRequests: 42, statusCodes: [[200, 40], [429, 2]], routes: [] },
    core: { containmentRequests: 0, findings: [], hotspotLog: [] },
    guard: { registry: [], threatLevel: 'NORMALE' }
  });
  fs.writeFileSync(path.join(dir, 'state.json.tmp'), JSON.stringify({ checksum: crypto.createHash('sha256').update(payload).digest('hex'), payload }));
  const server = await startServer(dir);
  const sec = await (await fetch(`http://127.0.0.1:${PORT}/api/security`)).json();
  check('contatori recuperati dal file temporaneo', sec.counters.blocksIssued === 1 && sec.counters.suspiciousAttempts === 9, JSON.stringify(sec.counters));
  check('nessuna classificazione come manomissione', !sec.events.some((e) => e.type === 'persist_tamper'));
  check('evento persist_incomplete registrato', sec.events.some((e) => e.type === 'persist_incomplete'));
  const metrics = await (await fetch(`http://127.0.0.1:${PORT}/api/metrics`)).json();
  check('metriche ripristinate dal temporaneo', metrics.requests.total >= 42, `total=${metrics.requests.total}`);
  await stopServer(server.child);
}

async function scenarioStaleAnchor() {
  console.log('--- 3. INTERRUZIONE TRA LE DUE SCRITTURE (ancora precedente ma presente nella catena) ---');
  const dir = makeDir('incomplete-anchor');
  const saved = await freshState(dir);
  const registry = JSON.parse(saved.state.payload).guard.registry;
  check('prefisso: catena presente', Array.isArray(registry) && registry.length > 0);
  const oldest = registry[registry.length - 1];
  fs.writeFileSync(path.join(dir, 'anchor.json'), JSON.stringify({
    seq: oldest.seq,
    hash: oldest.hash,
    stateChecksum: crypto.createHash('sha256').update('stato-precedente-mai-scritto').digest('hex'),
    savedAt: new Date(Date.now() - 60000).toISOString()
  }));
  const server = await startServer(dir);
  const agents = await (await fetch(`http://127.0.0.1:${PORT}/api/agents`)).json();
  check('ancora disallineata classificata come interruzione', agents.guard.integrity !== 'COMPROMESSA: registro sospetto conservato in sola lettura', agents.guard.integrity);
  check('catena continuata con ancora ripristinata', agents.registryAnchored === true);
  const sec = await (await fetch(`http://127.0.0.1:${PORT}/api/security`)).json();
  check('evento persist_incomplete presente', sec.events.some((e) => e.type === 'persist_incomplete'));
  check('nessun evento persist_tamper', !sec.events.some((e) => e.type === 'persist_tamper'));
  await stopServer(server.child);
}

async function scenarioTamper() {
  console.log('--- 4. POSSIBILE MANOMISSIONE (ancora congruente ma vertice assente dalla catena) ---');
  const dir = makeDir('tamper');
  const saved = await freshState(dir);
  const registry = JSON.parse(saved.state.payload).guard.registry;
  const head = registry[0];
  fs.writeFileSync(path.join(dir, 'anchor.json'), JSON.stringify({
    seq: head.seq + 2,
    hash: crypto.createHash('sha256').update('vertice-mai-esistito').digest('hex'),
    stateChecksum: saved.state.checksum,
    savedAt: new Date().toISOString()
  }));
  const server = await startServer(dir);
  const agents = await (await fetch(`http://127.0.0.1:${PORT}/api/agents`)).json();
  check('registro marcato COMPROMESSA', agents.guard.integrity.includes('COMPROMESSA'), agents.guard.integrity);
  check('ancora non più valida', agents.registryAnchored === false);
  check('voci sospette conservate (append-only)', agents.guard.registrySize === registry.length, `${agents.guard.registrySize} voci`);
  const sec = await (await fetch(`http://127.0.0.1:${PORT}/api/security`)).json();
  check('evento persist_tamper registrato', sec.events.some((e) => e.type === 'persist_tamper'));
  check('copia di prova conservata', fs.readdirSync(dir).some((f) => f.startsWith('state.json.suspect-')));
  await fetch(`http://127.0.0.1:${PORT}/api/status?q=%3Cscript%3E`);
  await sleep(300);
  const agents2 = await (await fetch(`http://127.0.0.1:${PORT}/api/agents`)).json();
  check('registro sospetto NON esteso né sovrascritto', agents2.guard.registrySize === registry.length, `${agents2.guard.registrySize} voci`);
  await stopServer(server.child);
}

async function scenarioFilesystem() {
  console.log('--- 5. FILESYSTEM NON DISPONIBILE ---');
  const dir = makeDir('fs-broken');
  const filePath = path.join(dir, 'occupato');
  fs.writeFileSync(filePath, 'questo file occupa il posto della directory');
  const server = await startServer(filePath);
  const sec = await (await fetch(`http://127.0.0.1:${PORT}/api/security`)).json();
  check('server operativo senza persistenza', sec.success === true);
  check('evento persist_error registrato', sec.events.some((e) => e.type === 'persist_error'));
  const agents = await (await fetch(`http://127.0.0.1:${PORT}/api/agents`)).json();
  check('agenti ONLINE anche senza persistenza', agents.core.status === 'ONLINE' && agents.guard.status === 'ONLINE');
  const code = await stopServer(server.child);
  check('chiusura ordinata senza persistenza', code === 0);
}

async function scenarioPortInUse() {
  console.log('--- 6. PORTA GIÀ IN USA (EADDRINUSE) ---');
  const dir = makeDir('porta');
  const first = await startServer(dir);
  const second = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: serverEnv(dir),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  second.stdout.on('data', (d) => { output += d.toString(); });
  second.stderr.on('data', (d) => { output += d.toString(); });
  const exitCode = await new Promise((resolve) => {
    const timeout = setTimeout(() => { second.kill('SIGKILL'); }, 10000);
    second.on('exit', (code) => { clearTimeout(timeout); resolve(code); });
  });
  check('seconda istanza esce immediatamente', exitCode === 1, `code=${exitCode}`);
  check('messaggio chiaro sulla porta occupata', output.includes('già in uso'));
  await stopServer(first.child);
}

async function scenarioFatalErrors() {
  console.log('--- 7. ERRORI FATALI SIMULATI (uncaughtException / unhandledRejection) ---');
  const dir = makeDir('fatale-eccezione');
  const res1 = await runScript("require('./server'); setTimeout(() => { throw new Error('eccezione simulata dal test'); }, 600);", dir);
  check('exit code 1 su uncaughtException', res1.code === 1, `code=${res1.code}`);
  check('errore dichiarato e isolato', res1.output.includes('[FATALE] uncaughtException'));
  check('chiusura controllata comunque avvenuta', res1.output.includes('Chiusura del server'));
  check('stato salvato prima dell uscita', fs.existsSync(path.join(dir, 'state.json')));

  const dir2 = makeDir('fatale-rifiuto');
  const res2 = await runScript("require('./server'); setTimeout(() => { Promise.reject(new Error('rifiuto simulato dal test')); }, 600);", dir2);
  check('exit code 1 su unhandledRejection', res2.code === 1, `code=${res2.code}`);
  check('rifiuto dichiarato e isolato', res2.output.includes('[FATALE] unhandledRejection'));
  check('stato salvato prima dell uscita anche su rifiuto', fs.existsSync(path.join(dir2, 'state.json')));
}

async function main() {
  await scenarioCorruption();
  await scenarioIncomplete();
  await scenarioStaleAnchor();
  await scenarioTamper();
  await scenarioFilesystem();
  await scenarioPortInUse();
  await scenarioFatalErrors();
  console.log(`\nRISULTATO ERRORI: ${pass} PASS, ${fail} FAIL`);
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('ERRORE SUITE ERRORI:', err);
  process.exit(1);
});

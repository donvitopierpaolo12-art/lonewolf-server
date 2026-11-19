const app = require('./src/app');
const config = require('./src/config');
const metrics = require('./src/metrics/metrics');
const security = require('./src/security/security');
const agents = require('./src/agents');
const persist = require('./src/persist/stateStore');
const sseClients = require('./src/sse/clients');

const persisted = persist.load();
if (persisted.data) {
  security.restore(persisted.data.security);
  metrics.restore(persisted.data.metrics);
  agents.restore(persisted.data, persisted.verdict);
}
persisted.findings.forEach((finding) => security.noteSystemEvent(finding.type, finding.detail));

const server = app.listen(config.port, config.host, () => {
  console.log('========================================');
  console.log('  LONEWOLF SERVER');
  console.log('  Stato     : ONLINE');
  console.log(`  URL       : http://localhost:${config.port}`);
  console.log(`  Avviato   : ${new Date().toLocaleString('it-IT')}`);
  console.log(`  Stato salvato: ${persisted.data ? `ripristinato (${persisted.verdict})` : 'nessuno: avvio pulito'}`);
  console.log('========================================');
});

metrics.start();
security.startCleanup();
agents.start();
agents.startPublisher();
persist.start();

let shuttingDown = false;

function shutdown(signal, options = {}) {
  const exitCode = options.exitCode || 0;
  if (shuttingDown) {
    process.exit(exitCode);
    return;
  }
  shuttingDown = true;
  console.log(`\n[${signal}]${options.reason ? ` (${options.reason})` : ''} Chiusura del server in corso...`);
  try { agents.stop(); } catch (err) { console.error(`[ARRESTO] agenti: ${err.message}`); }
  try { agents.stopPublisher(); } catch (err) { console.error(`[ARRESTO] publisher: ${err.message}`); }
  try { metrics.stop(); } catch (err) { console.error(`[ARRESTO] metriche: ${err.message}`); }
  try { sseClients.closeAll(); } catch (err) { console.error(`[ARRESTO] SSE: ${err.message}`); }
  try { persist.saveNow(); } catch (err) { console.error(`[ARRESTO] persistenza: ${err.message}`); }
  try { persist.stop(); } catch (err) { console.error(`[ARRESTO] timer persistenza: ${err.message}`); }
  server.close(() => {
    console.log('Server chiuso correttamente.');
    process.exit(exitCode);
  });
  setTimeout(() => process.exit(exitCode), config.persist.shutdownTimeoutMs).unref();
}

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`[ERRORE] Porta ${config.port} già in uso: impossibile avviare il server.`);
    process.exit(1);
  }
  console.error(`[ERRORE] Server HTTP: ${err && err.message ? err.message : err}`);
  process.exit(2);
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error(`[FATALE] uncaughtException: ${err && err.message ? err.message : err}`);
  shutdown('uncaughtException', { exitCode: 1, reason: 'eccezione non gestita' });
});
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error(`[FATALE] unhandledRejection: ${message}`);
  shutdown('unhandledRejection', { exitCode: 1, reason: 'rifiuto non gestito' });
});

module.exports = server;

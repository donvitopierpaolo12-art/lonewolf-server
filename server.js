const app = require('./src/app');
const config = require('./src/config');
const metrics = require('./src/metrics/metrics');
const security = require('./src/security/security');

const server = app.listen(config.port, config.host, () => {
  console.log('========================================');
  console.log('  LONEWOLF SERVER');
  console.log('========================================');
  console.log('  Stato     : ONLINE');
  console.log(`  URL       : http://localhost:${config.port}`);
  console.log(`  Avviato   : ${new Date().toLocaleString('it-IT')}`);
  console.log('========================================');
});

metrics.start();
security.startCleanup();

const shutdown = (signal) => {
  console.log(`\n[${signal}] Chiusura del server in corso...`);
  metrics.stop();
  server.close(() => {
    console.log('Server chiuso correttamente.');
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = server;

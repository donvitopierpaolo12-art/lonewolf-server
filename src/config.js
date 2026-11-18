const config = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  startedAt: new Date().toISOString()
};

module.exports = config;

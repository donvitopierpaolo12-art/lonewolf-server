const metrics = require('../metrics/metrics');

function middleware(req, res, next) {
  const startAt = process.hrtime.bigint();

  res.on('finish', () => {
    let route;
    if (req.route) {
      route = `${req.baseUrl || ''}${req.route.path}`;
    } else if (req.originalUrl.startsWith('/api')) {
      route = req.originalUrl.split('?')[0];
    } else {
      route = 'static';
    }

    const durationMs = Number(process.hrtime.bigint() - startAt) / 1e6;
    metrics.trackRequest(route, req.method, res.statusCode, durationMs);
  });

  next();
}

module.exports = { middleware };

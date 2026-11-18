const path = require('path');

function notFoundHandler(req, res) {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({
      success: false,
      error: 'Endpoint API non trovato',
      path: req.originalUrl
    });
  }

  res.status(404).sendFile('404.html', {
    root: path.join(__dirname, '..', '..', 'public')
  });
}

function errorHandler(err, req, res, next) {
  console.error('[ERRORE]', err.message);

  if (res.headersSent) {
    return next(err);
  }

  const isApi = req.path.startsWith('/api') ||
    (req.accepts(['html', 'json']) === 'json');

  if (isApi) {
    return res.status(err.status || 500).json({
      success: false,
      error: err.status === 400 ? err.message : 'Errore interno del server'
    });
  }

  res.status(err.status || 500).sendFile('404.html', {
    root: path.join(__dirname, '..', '..', 'public')
  });
}

module.exports = { notFoundHandler, errorHandler };

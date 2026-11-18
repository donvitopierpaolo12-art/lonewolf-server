const path = require('path');
const security = require('../security/security');

function notFoundHandler(req, res) {
  security.noteNotFound(req);

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
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    security.noteInvalidPayload(req);
    return res.status(400).json({
      success: false,
      error: 'Payload non valido o JSON malformato'
    });
  }

  if (err.type === 'entity.too.large') {
    security.noteInvalidPayload(req);
    return res.status(413).json({
      success: false,
      error: 'Payload troppo grande'
    });
  }

  console.error('[ERRORE]', err.message);

  if (res.headersSent) {
    return next(err);
  }

  const isApi = req.path.startsWith('/api') ||
    (req.accepts(['html', 'json']) === 'json');

  if (isApi) {
    return res.status(err.status || 500).json({
      success: false,
      error: 'Errore interno del server'
    });
  }

  res.status(err.status || 500).sendFile('404.html', {
    root: path.join(__dirname, '..', '..', 'public')
  });
}

module.exports = { notFoundHandler, errorHandler };

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const apiRouter = require('./routes/api');
const security = require('./security/security');
const tracker = require('./middleware/requestTracker');
const { notFoundHandler, errorHandler } = require('./middleware/errors');

const app = express();

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", 'data:']
    }
  }
}));

app.use(express.json({ limit: '100kb' }));

app.use(security.guard);
app.use(tracker.middleware);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use('/api', apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

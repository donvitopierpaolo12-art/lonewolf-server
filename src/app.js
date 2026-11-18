const path = require('path');
const express = require('express');
const apiRouter = require('./routes/api');
const { notFoundHandler, errorHandler } = require('./middleware/errors');

const app = express();

app.disable('x-powered-by');
app.use(express.json());

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', apiRouter);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

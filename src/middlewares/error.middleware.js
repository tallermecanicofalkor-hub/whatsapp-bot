function errorMiddleware(err, req, res, next) {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({
    error: err.message || 'Error interno',
  });
}

module.exports = errorMiddleware;

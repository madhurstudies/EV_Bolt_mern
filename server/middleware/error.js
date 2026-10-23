export class HttpError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors; // optional {field: message}
  }
}

// Express 5 forwards rejected async handlers here automatically.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message, ...(err.errors && { errors: err.errors }) });
  }
  if (err.name === 'ValidationError') return res.status(400).json({ message: 'Invalid data', errors: Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message])) });
  if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid id' });
  if (err.code === 11000) return res.status(409).json({ message: 'Already exists' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Malformed JSON' });
  console.error(err);
  res.status(500).json({ message: 'Something went wrong' });
}

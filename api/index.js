// Handler untuk Vercel serverless, menggunakan app Express yang sudah ada
const app = require('../server');
const ready = app.ready || Promise.resolve();

module.exports = async (req, res) => {
  await ready;
  return app(req, res);
};

// Serverzeit, damit die Spieluhr auf allen Geräten gleich läuft
module.exports = (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ now: Date.now() }));
};

// Servidor local que imita o roteamento da Vercel (npm run dev). Em produção a Vercel usa /api e /public diretamente.
require('./lib/tz');
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const page = require('./api/page'), health = require('./api/health'), rpc = require('./api/rpc/[fn].js');
const MIME = { '.js': 'text/javascript', '.png': 'image/png', '.css': 'text/css', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

function adaptar(req, res, query, bodyStr) {
  req.query = query; req.body = bodyStr;
  res.status = c => { res.statusCode = c; return res; };
  res.send = b => { res.end(b); return res; };
  res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
}
http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  let corpo = '';
  req.on('data', d => (corpo += d));
  req.on('end', async () => {
    try {
      if (u.pathname === '/' ) { adaptar(req, res, u.query, corpo); return page(req, res); }
      if (u.pathname === '/api/health') { adaptar(req, res, u.query, corpo); return health(req, res); }
      const m = u.pathname.match(/^\/api\/rpc\/([^/]+)$/);
      if (m) { adaptar(req, res, { ...u.query, fn: decodeURIComponent(m[1]) }, corpo); return rpc(req, res); }
      const f = path.join(__dirname, 'public', path.normalize(u.pathname).replace(/^(\.\.[/\\])+/, ''));
      if (f.startsWith(path.join(__dirname, 'public')) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream'); return res.end(fs.readFileSync(f));
      }
      res.statusCode = 404; res.end('Não encontrado');
    } catch (e) { console.error(e); res.statusCode = 500; res.end('erro'); }
  });
}).listen(process.env.PORT || 3000, () => console.log('Natus em http://localhost:' + (process.env.PORT || 3000)));

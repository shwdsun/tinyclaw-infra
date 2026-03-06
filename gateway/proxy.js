const http = require('http');

function forward(req, res, upstream) {
    const url = new URL(upstream);
    const opts = {
        hostname: url.hostname,
        port: url.port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: url.host },
    };

    const proxyReq = http.request(opts, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });

    proxyReq.on('error', () => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad gateway' }));
    });

    req.pipe(proxyReq);
}

module.exports = { forward };

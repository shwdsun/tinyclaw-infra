const http = require('http');

const API_KEY = process.env.API_KEY;
const UPSTREAM = process.env.UPSTREAM || 'http://localhost:3777';
const PORT = parseInt(process.env.PROXY_PORT || '8080', 10);

if (!API_KEY) {
    console.error('FATAL: API_KEY environment variable is required');
    process.exit(1);
}

const upstreamUrl = new URL(UPSTREAM);

const server = http.createServer((req, res) => {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${API_KEY}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
    }

    const opts = {
        hostname: upstreamUrl.hostname,
        port: upstreamUrl.port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: upstreamUrl.host },
    };

    const proxyReq = http.request(opts, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });

    proxyReq.on('error', () => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad Gateway' }));
    });

    req.pipe(proxyReq);
});

server.listen(PORT, () => {
    console.log(`Auth proxy listening on :${PORT}, upstream: ${UPSTREAM}`);
});

const http = require('http');
const { forward } = require('./proxy');
const tasks = require('./tasks');
const metrics = require('./metrics');

const API_KEY = process.env.API_KEY;
const UPSTREAM = process.env.UPSTREAM || 'http://localhost:3777';
const PORT = parseInt(process.env.PORT || '8080', 10);

if (!API_KEY) {
    console.error('API_KEY required');
    process.exit(1);
}

const server = http.createServer(async (req, res) => {
    if (req.url === '/health') return json(res, 200, { status: 'ok' });

    if (req.url === '/metrics') {
        const gauges = {
            gateway_tasks_pending: tasks.stats().pending,
            gateway_tasks_claimed: tasks.stats().claimed,
        };
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(metrics.dump(gauges));
    }

    if (req.headers.authorization !== `Bearer ${API_KEY}`) {
        metrics.inc('gateway_requests_total', { status: '401' });
        return json(res, 401, { error: 'unauthorized' });
    }

    if (req.url.startsWith('/api/tasks')) {
        await routeTasks(req, res);
        metrics.inc('gateway_requests_total', { path: 'tasks', status: String(res.statusCode) });
    } else {
        forward(req, res, UPSTREAM);
        metrics.inc('gateway_requests_total', { path: 'proxy' });
    }
});

async function routeTasks(req, res) {
    const { pathname, searchParams } = new URL(req.url, 'http://n');

    if (pathname === '/api/tasks' && req.method === 'POST') {
        const data = await readBody(req);
        if (!data.agent || !data.message) {
            return json(res, 400, { error: 'agent and message required' });
        }
        const task = tasks.create(data.agent, data.message, data.metadata);
        metrics.inc('gateway_tasks_created_total', { agent: data.agent });
        return json(res, 201, task);
    }

    if (pathname === '/api/tasks/claim' && req.method === 'POST') {
        const data = await readBody(req);
        if (!data.agent) return json(res, 400, { error: 'agent required' });
        const task = tasks.claim(data.agent);
        if (!task) return json(res, 204);
        metrics.inc('gateway_tasks_claimed_total', { agent: data.agent });
        return json(res, 200, task);
    }

    const match = pathname.match(/^\/api\/tasks\/([^/]+)/);
    const id = match?.[1];

    if (id && pathname.endsWith('/result') && req.method === 'POST') {
        const data = await readBody(req);
        const task = data.error
            ? tasks.fail(id, data.error)
            : tasks.complete(id, data.result);
        if (!task) return json(res, 404, { error: 'task not found or not claimed' });
        metrics.inc('gateway_tasks_resolved_total', { agent: task.agent, status: task.status });
        return json(res, 200, task);
    }

    if (id && req.method === 'GET') {
        const task = tasks.get(id);
        return task ? json(res, 200, task) : json(res, 404, { error: 'not found' });
    }

    if (pathname === '/api/tasks' && req.method === 'GET') {
        return json(res, 200, tasks.list(searchParams.get('status')));
    }

    json(res, 404, { error: 'not found' });
}

function readBody(req) {
    return new Promise((resolve) => {
        let raw = '';
        req.on('data', (chunk) => raw += chunk);
        req.on('end', () => {
            try { resolve(JSON.parse(raw)); }
            catch { resolve({}); }
        });
    });
}

function json(res, status, body) {
    if (status === 204) { res.writeHead(204); return res.end(); }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

setInterval(() => tasks.prune(), 600_000);

server.listen(PORT, () => console.log(`gateway :${PORT} → ${UPSTREAM}`));

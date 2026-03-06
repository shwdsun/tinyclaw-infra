const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const GATEWAY = process.env.GATEWAY_URL || 'http://gateway:8080';
const API_KEY = process.env.API_KEY;
const AGENT = process.env.AGENT_ID;
const PROVIDER = process.env.PROVIDER || 'anthropic';
const MODEL = process.env.MODEL || '';
const WORKSPACE = process.env.WORKSPACE || '/workspace';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '3000', 10);
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '9100', 10);

if (!API_KEY || !AGENT) {
    console.error('API_KEY and AGENT_ID required');
    process.exit(1);
}

const providers = {
    anthropic: {
        cmd: 'claude',
        args: (model, msg) => {
            const a = ['--dangerously-skip-permissions'];
            if (model) a.push('--model', model);
            a.push('-p', msg);
            return a;
        },
        parse: (out) => out,
    },
    openai: {
        cmd: 'codex',
        args: (model, msg) => {
            const a = ['exec'];
            if (model) a.push('--model', model);
            a.push('--skip-git-repo-check',
                '--dangerously-bypass-approvals-and-sandbox',
                '--json', msg);
            return a;
        },
        parse: (out) => {
            let text = '';
            for (const line of out.trim().split('\n')) {
                try {
                    const obj = JSON.parse(line);
                    if (obj.type === 'item.completed' &&
                        obj.item?.type === 'agent_message') {
                        text = obj.item.text;
                    }
                } catch {}
            }
            return text || out;
        },
    },
    opencode: {
        cmd: 'opencode',
        args: (model, msg) => {
            const a = ['run', '--format', 'json'];
            if (model) a.push('--model', model);
            a.push(msg);
            return a;
        },
        parse: (out) => {
            let text = '';
            for (const line of out.trim().split('\n')) {
                try {
                    const obj = JSON.parse(line);
                    if (obj.type === 'text' && obj.part?.text) {
                        text = obj.part.text;
                    }
                } catch {}
            }
            return text || out;
        },
    },
};

function invoke(message) {
    const provider = providers[PROVIDER];
    if (!provider) return Promise.reject(new Error(`unknown provider: ${PROVIDER}`));

    const args = provider.args(MODEL, message);

    return new Promise((resolve, reject) => {
        const child = spawn(provider.cmd, args, {
            cwd: WORKSPACE,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => stdout += d);
        child.stderr.on('data', (d) => stderr += d);

        child.on('close', (code) => {
            if (code === 0) {
                resolve(provider.parse(stdout));
            } else {
                reject(new Error(stderr.trim() || `exit code ${code}`));
            }
        });
        child.on('error', reject);
    });
}

function request(method, path, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, GATEWAY);
        const transport = url.protocol === 'https:' ? https : http;

        const req = transport.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
            },
        }, (res) => {
            if (res.statusCode === 204) return resolve(null);
            let data = '';
            res.on('data', (d) => data += d);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve(data); }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

let busy = false;
let completed = 0;
let failed = 0;

async function poll() {
    const task = await request('POST', '/api/tasks/claim', { agent: AGENT });
    if (!task) return;

    busy = true;
    console.log(`task ${task.id}: ${task.message.substring(0, 80)}...`);

    try {
        const result = await invoke(task.message);
        await request('POST', `/api/tasks/${task.id}/result`, { result });
        completed++;
        console.log(`task ${task.id}: done`);
    } catch (err) {
        await request('POST', `/api/tasks/${task.id}/result`, { error: err.message });
        failed++;
        console.error(`task ${task.id}: ${err.message}`);
    } finally {
        busy = false;
    }
}

async function loop() {
    for (;;) {
        try { await poll(); }
        catch (err) { console.error(`poll: ${err.message}`); }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }
}

const health = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            agent: AGENT,
            provider: PROVIDER,
            status: busy ? 'busy' : 'idle',
        }));
        return;
    }

    if (req.url === '/metrics') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end([
            '# TYPE worker_tasks_total counter',
            `worker_tasks_total{agent="${AGENT}",status="completed"} ${completed}`,
            `worker_tasks_total{agent="${AGENT}",status="failed"} ${failed}`,
            '# TYPE worker_busy gauge',
            `worker_busy{agent="${AGENT}"} ${busy ? 1 : 0}`,
        ].join('\n') + '\n');
        return;
    }

    res.writeHead(404);
    res.end();
});

health.listen(HEALTH_PORT, () => {
    console.log(`worker agent=${AGENT} provider=${PROVIDER} health=:${HEALTH_PORT}`);
    console.log(`polling ${GATEWAY} every ${POLL_INTERVAL}ms`);
    loop();
});

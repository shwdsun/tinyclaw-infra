const store = new Map();
let seq = 0;

function create(agent, message, metadata) {
    const id = String(++seq);
    const task = {
        id,
        agent,
        message,
        metadata: metadata || null,
        status: 'pending',
        result: null,
        error: null,
        created: Date.now(),
        claimed: null,
        completed: null,
    };
    store.set(id, task);
    return task;
}

function claim(agent) {
    for (const task of store.values()) {
        if (task.status === 'pending' && task.agent === agent) {
            task.status = 'claimed';
            task.claimed = Date.now();
            return task;
        }
    }
    return null;
}

function complete(id, result) {
    const task = store.get(id);
    if (!task || task.status !== 'claimed') return null;
    task.status = 'completed';
    task.result = result;
    task.completed = Date.now();
    return task;
}

function fail(id, error) {
    const task = store.get(id);
    if (!task || task.status !== 'claimed') return null;
    task.status = 'failed';
    task.error = error;
    task.completed = Date.now();
    return task;
}

function get(id) {
    return store.get(id) || null;
}

function list(statusFilter) {
    const result = [];
    for (const task of store.values()) {
        if (!statusFilter || task.status === statusFilter) result.push(task);
    }
    return result;
}

function stats() {
    let pending = 0, claimed = 0, completed = 0, failed = 0;
    for (const task of store.values()) {
        switch (task.status) {
            case 'pending':   pending++;   break;
            case 'claimed':   claimed++;   break;
            case 'completed': completed++; break;
            case 'failed':    failed++;    break;
        }
    }
    return { pending, claimed, completed, failed, total: store.size };
}

function prune(maxAge = 3600_000, staleThreshold = 600_000) {
    const now = Date.now();
    for (const [id, task] of store) {
        if ((task.status === 'completed' || task.status === 'failed') &&
            now - task.completed > maxAge) {
            store.delete(id);
            continue;
        }
        if (task.status === 'claimed' && now - task.claimed > staleThreshold) {
            task.status = 'pending';
            task.claimed = null;
        }
    }
}

module.exports = { create, claim, complete, fail, get, list, stats, prune };

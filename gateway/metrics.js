const counters = new Map();

function inc(name, labels) {
    const key = fmt(name, labels);
    counters.set(key, (counters.get(key) || 0) + 1);
}

function fmt(name, labels) {
    if (!labels || !Object.keys(labels).length) return name;
    const pairs = Object.entries(labels).sort()
        .map(([k, v]) => `${k}="${v}"`);
    return `${name}{${pairs.join(',')}}`;
}

function dump(gauges) {
    const lines = [];

    const groups = {};
    for (const [key, val] of counters) {
        const name = key.split('{')[0];
        if (!groups[name]) groups[name] = [];
        groups[name].push(`${key} ${val}`);
    }
    for (const [name, entries] of Object.entries(groups)) {
        lines.push(`# TYPE ${name} counter`);
        lines.push(...entries);
    }

    if (gauges) {
        for (const [name, val] of Object.entries(gauges)) {
            lines.push(`# TYPE ${name} gauge`);
            lines.push(`${name} ${val}`);
        }
    }

    return lines.join('\n') + '\n';
}

module.exports = { inc, dump };

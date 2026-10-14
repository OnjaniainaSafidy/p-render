const express = require('express');
const os = require('os');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 1. FONCTIONS UTILITAIRES
// ==========================================

function readNumber(path) {
    try {
        const value = fs.readFileSync(path, 'utf8').trim();

        if (value === 'max') return null;

        const number = Number(value);

        return Number.isFinite(number) && number >= 0
            ? number
            : null;
    } catch {
        return null;
    }
}

function readText(path) {
    try {
        return fs.readFileSync(path, 'utf8').trim();
    } catch {
        return null;
    }
}

function toMB(bytes) {
    return bytes === null || bytes === undefined
        ? null
        : Number((bytes / 1024 ** 2).toFixed(2));
}

function toGB(bytes) {
    return bytes === null || bytes === undefined
        ? null
        : Number((bytes / 1024 ** 3).toFixed(2));
}

function getContainerMemory() {
    const hostTotal = os.totalmem();

    // Linux cgroups v2
    let limit = readNumber('/sys/fs/cgroup/memory.max');
    let used = readNumber('/sys/fs/cgroup/memory.current');

    // Linux cgroups v1
    if (limit === null) {
        limit = readNumber(
            '/sys/fs/cgroup/memory/memory.limit_in_bytes'
        );

        used = readNumber(
            '/sys/fs/cgroup/memory/memory.usage_in_bytes'
        );
    }

    // Raha tsy misy fetra azo fantarina
    if (limit === null || limit <= 0 || limit > hostTotal) {
        return {
            totalBytes: hostTotal,
            usedBytes: null,
            source: 'operating_system'
        };
    }

    return {
        totalBytes: limit,
        usedBytes: used,
        source: 'container_limit'
    };
}

// ==========================================
// 2. MESURE DU CPU
// ==========================================

// CPU an'ny processus Node.js
let previousProcessCPU = process.cpuUsage();
let previousProcessTime = process.hrtime.bigint();

function getProcessCPU() {
    const currentCPU = process.cpuUsage();
    const currentTime = process.hrtime.bigint();

    const elapsed =
        Number(currentTime - previousProcessTime) / 1000;

    const consumed =
        (currentCPU.user - previousProcessCPU.user) +
        (currentCPU.system - previousProcessCPU.system);

    previousProcessCPU = currentCPU;
    previousProcessTime = currentTime;

    if (elapsed <= 0) return 0;

    return Number(((consumed / elapsed) * 100).toFixed(2));
}

// CPU global hitan'ny système d'exploitation
function getSystemCPU() {
    const cpus = os.cpus();

    let total = 0;
    let idle = 0;

    for (const cpu of cpus) {
        const times = cpu.times;

        total +=
            times.user +
            times.nice +
            times.sys +
            times.irq +
            times.idle;

        idle += times.idle;
    }

    return { total, idle };
}

let previousSystemCPU = getSystemCPU();

function calculateSystemCPU() {
    const current = getSystemCPU();

    const totalDifference =
        current.total - previousSystemCPU.total;

    const idleDifference =
        current.idle - previousSystemCPU.idle;

    previousSystemCPU = current;

    if (totalDifference <= 0) return null;

    const usage =
        ((totalDifference - idleDifference) / totalDifference) * 100;

    return Number(Math.max(0, Math.min(100, usage)).toFixed(2));
}

// ==========================================
// 3. INFORMATIONS DU DISQUE
// ==========================================

function getDiskStats() {
    try {
        const stats = fs.statfsSync('/');

        const totalBytes = stats.blocks * stats.bsize;
        const freeBytes = stats.bavail * stats.bsize;
        const usedBytes = totalBytes - stats.bfree * stats.bsize;

        return {
            totalBytes,
            usedBytes,
            freeBytes,
            source: 'root_filesystem'
        };
    } catch {
        return {
            totalBytes: null,
            usedBytes: null,
            freeBytes: null,
            source: 'unavailable'
        };
    }
}

// ==========================================
// 4. CPU QUOTA DU CONTAINER, RAHA MISY
// ==========================================

function getContainerCPUInfo() {
    const cpuMax = readText('/sys/fs/cgroup/cpu.max');

    if (cpuMax) {
        const values = cpuMax.split(/\s+/);
        const quota = Number(values[0]);
        const period = Number(values[1]);

        if (
            values[0] !== 'max' &&
            Number.isFinite(quota) &&
            Number.isFinite(period) &&
            quota > 0 &&
            period > 0
        ) {
            return {
                quotaCores: Number((quota / period).toFixed(2)),
                source: 'container_cpu_quota'
            };
        }
    }

    return {
        quotaCores: null,
        source: 'not_available'
    };
}

// ==========================================
// 5. API HEALTH
// ==========================================

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Process is live',
        timestamp: new Date().toISOString()
    });
});

// ==========================================
// 6. API STATISTIQUES
// ==========================================

app.get('/stats', (req, res) => {
    const memory = process.memoryUsage();
    const containerMemory = getContainerMemory();
    const disk = getDiskStats();

    const processCPU = getProcessCPU();
    const systemCPU = calculateSystemCPU();
    const containerCPU = getContainerCPUInfo();

    const diskPercent =
        disk.totalBytes > 0
            ? Number(
                ((disk.usedBytes / disk.totalBytes) * 100).toFixed(2)
            )
            : null;

    res.json({
        timestamp: new Date().toISOString(),

        health: {
            status: 'ok',
            message: 'Process is live'
        },

        container: {
            totalRAM_GB: toGB(containerMemory.totalBytes),
            usedRAM_GB: toGB(containerMemory.usedBytes),
            memorySource: containerMemory.source
        },

        process: {
            ramRSS_MB: toMB(memory.rss),
            heapUsed_MB: toMB(memory.heapUsed),
            heapTotal_MB: toMB(memory.heapTotal),
            externalMemory_MB: toMB(memory.external),
            cpuUsagePercent: processCPU
        },

        cpu: {
            logicalCores: os.availableParallelism(),
            systemUsagePercent: systemCPU,
            containerQuotaCores: containerCPU.quotaCores,
            quotaSource: containerCPU.source
        },

        disk: {
            total_GB: toGB(disk.totalBytes),
            used_GB: toGB(disk.usedBytes),
            free_GB: toGB(disk.freeBytes),
            usedPercent: diskPercent,
            source: disk.source
        }
    });
});

// ==========================================
// 7. DASHBOARD HTML
// ==========================================

app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <title>Server Monitoring Dashboard</title>

    <style>
        :root {
            --background: #0b1120;
            --panel: #151e30;
            --border: #26344b;
            --text: #eef4ff;
            --muted: #91a1ba;
            --cyan: #38bdf8;
            --green: #34d399;
            --purple: #a78bfa;
            --orange: #fb923c;
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            padding: 30px 18px;
            background:
                radial-gradient(ellipse at top left, #172747, transparent 45%),
                var(--background);
            color: var(--text);
            font-family: Arial, Helvetica, sans-serif;
            min-height: 100vh;
        }

        .container {
            max-width: 1100px;
            margin: auto;
        }

        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 18px;
            margin-bottom: 30px;
            animation: appear 0.7s ease both;
        }

        h1 {
            font-size: clamp(23px, 4vw, 34px);
            margin: 0 0 9px;
            letter-spacing: -0.7px;
        }

        .subtitle {
            color: var(--muted);
            margin: 0;
            font-size: 14px;
        }

        .status {
            display: inline-flex;
            align-items: center;
            gap: 9px;
            padding: 11px 16px;
            border: 1px solid #225c4d;
            border-radius: 30px;
            background: #12342e;
            color: var(--green);
            font-size: 13px;
            font-weight: bold;
        }

        .status-dot {
            width: 9px;
            height: 9px;
            background: var(--green);
            border-radius: 50%;
            animation: pulse 1.6s infinite;
        }

        .status.offline {
            color: #fca5a5;
            background: #421d2a;
            border-color: #713044;
        }

        .status.offline .status-dot {
            background: #f87171;
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 20px;
        }

        .card {
            background: rgba(21, 30, 48, 0.94);
            border: 1px solid var(--border);
            border-radius: 17px;
            padding: 23px;
            box-shadow: 0 12px 35px rgba(0, 0, 0, 0.16);
            animation: appear 0.7s ease both;
            transition:
                transform 0.25s ease,
                border-color 0.25s ease,
                box-shadow 0.25s ease;
        }

        .card:hover {
            transform: translateY(-4px);
            border-color: #3e587b;
            box-shadow: 0 18px 40px rgba(0, 0, 0, 0.25);
        }

        .card:nth-child(2) {
            animation-delay: 0.1s;
        }

        .card:nth-child(3) {
            animation-delay: 0.2s;
        }

        .card:nth-child(4) {
            animation-delay: 0.3s;
        }

        .card-title {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 20px;
        }

        .icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 37px;
            height: 37px;
            border-radius: 11px;
            background: #1d304b;
            font-size: 20px;
        }

        .metric {
            margin: 17px 0;
        }

        .metric-header {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            align-items: center;
            margin-bottom: 9px;
            font-size: 13px;
        }

        .label {
            color: var(--muted);
        }

        .value {
            font-weight: bold;
            overflow-wrap: anywhere;
            text-align: right;
        }

        .big-value {
            font-size: 28px;
            font-weight: bold;
            letter-spacing: -0.7px;
            margin: 8px 0;
        }

        .small-note {
            color: var(--muted);
            font-size: 12px;
            line-height: 1.6;
            margin-top: 12px;
        }

        .bar {
            height: 8px;
            border-radius: 10px;
            overflow: hidden;
            background: #26344b;
        }

        .bar-fill {
            width: 0;
            height: 100%;
            border-radius: 10px;
            transition: width 0.8s ease;
        }

        .ram-fill {
            background: linear-gradient(90deg, #38bdf8, #818cf8);
        }

        .cpu-fill {
            background: linear-gradient(90deg, #a78bfa, #ec4899);
        }

        .disk-fill {
            background: linear-gradient(90deg, #fb923c, #facc15);
        }

        .table-card {
            margin-top: 22px;
            animation: appear 0.8s ease both;
        }

        .table-wrap {
            overflow-x: auto;
        }

        table {
            border-collapse: collapse;
            width: 100%;
            min-width: 420px;
            font-size: 14px;
        }

        th, td {
            padding: 15px 12px;
            text-align: left;
            border-bottom: 1px solid var(--border);
        }

        th {
            color: var(--muted);
            font-weight: normal;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.6px;
        }

        td:last-child {
            font-weight: bold;
            overflow-wrap: anywhere;
        }

        tbody tr {
            transition: background 0.2s ease;
        }

        tbody tr:hover {
            background: rgba(56, 189, 248, 0.05);
        }

        .footer {
            display: flex;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 10px;
            color: var(--muted);
            font-size: 12px;
            margin: 25px 0 10px;
        }

        .error-message {
            color: #fca5a5;
            font-size: 13px;
            margin-top: 15px;
        }

        @keyframes appear {
            from {
                opacity: 0;
                transform: translateY(14px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        @keyframes pulse {
            0%, 100% {
                box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.45);
            }
            50% {
                box-shadow: 0 0 0 7px rgba(52, 211, 153, 0);
            }
        }

        @media (max-width: 700px) {
            body {
                padding: 22px 12px;
            }

            .grid {
                grid-template-columns: 1fr;
            }

            .card {
                padding: 19px;
            }
        }

        @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after {
                animation-duration: 0.01ms !important;
                transition-duration: 0.01ms !important;
            }
        }
    </style>
</head>

<body>
    <main class="container">

        <header>
            <div>
                <h1>Server Monitoring</h1>
                <p class="subtitle">
                    Real-time system and process statistics
                </p>
            </div>

            <div class="status" id="status">
                <span class="status-dot"></span>
                <span id="statusText">CONNECTING...</span>
            </div>
        </header>

        <section class="grid">

            <!-- RAM -->
            <article class="card">
                <div class="card-title">
                    <span class="icon">🧠</span>
                    Memory
                </div>

                <p class="label">Total instance RAM</p>
                <div class="big-value" id="ramTotal">--</div>

                <div class="metric">
                    <div class="metric-header">
                        <span class="label">RAM utilisée</span>
                        <span class="value" id="ramUsed">--</span>
                    </div>
                    <div class="bar">
                        <div class="bar-fill ram-fill" id="ramBar"></div>
                    </div>
                </div>

                <div class="metric">
                    <div class="metric-header">
                        <span class="label">Process RAM (RSS)</span>
                        <span class="value" id="processRAM">--</span>
                    </div>
                </div>

                <div class="metric">
                    <div class="metric-header">
                        <span class="label">Heap utilisé</span>
                        <span class="value" id="heapUsed">--</span>
                    </div>
                </div>

                <p class="small-note" id="memoryNote">
                    En attente des données...
                </p>
            </article>

            <!-- CPU -->
            <article class="card">
                <div class="card-title">
                    <span class="icon">⚙️</span>
                    CPU
                </div>

                <p class="label">Process CPU usage</p>
                <div class="big-value" id="processCPU">--</div>

                <div class="metric">
                    <div class="metric-header">
                        <span class="label">CPU système</span>
                        <span class="value" id="systemCPU">--</span>
                    </div>
                    <div class="bar">
                        <div class="bar-fill cpu-fill" id="cpuBar"></div>
                    </div>
                </div>

                <div class="metric">
                    <div class="metric-header">
                        <span class="label">Cœurs logiques</span>
                        <span class="value" id="cpuCores">--</span>
                    </div>
                </div>

                <div class="metric">
                    <div class="metric-header">
                        <span class="label">Container CPU quota</span>
                        <span class="value" id="cpuQuota">--</span>
                    </div>
                </div>

                <p class="small-note">
                    Le CPU du processus peut dépasser 100 % sur plusieurs
                    cœurs. Le CPU système dépend des données visibles par l'OS.
                </p>
            </article>

            <!-- DISK -->
            <article class="card">
                <div class="card-title">
                    <span class="icon">💾</span>
                    Disk Storage
                </div>

                <p class="label">Espace total</p>
                <div class="big-value" id="diskTotal">--</div>

                <div class="metric">
                    <div class="metric-header">
                        <span class="label">Espace utilisé</span>
                        <span class="value" id="diskUsed">--</span>
                    </div>
                    <div class="bar">
                        <div class="bar-fill disk-fill" id="diskBar"></div>
                    </div>
                </div>

                <div class="metric">
                    <div class="metric-header">
                        <span class="label">Espace libre</span>
                        <span class="value" id="diskFree">--</span>
                    </div>
                </div>

                <p class="small-note" id="diskNote">
                    Informations du système de fichiers racine.
                </p>
            </article>

            <!-- PROCESS -->
            <article class="card">
                <div class="card-title">
                    <span class="icon">📡</span>
                    Process Information
                </div>

                <div class="metric">
                    <div class="metric-header">
                        <span class="label">Processus</span>
                        <span class="value">Node.js</span>
                    </div>
                </div>

                <div class="metric">
                    <div class="metric-header">
                        <span class="label">Heap total</span>
                        <span class="value" id="heapTotal">--</span>
                    </div>
                </div>

                <div class="metric">
                    <div class="metric-header">
                        <span class="label">Mémoire externe</span>
                        <span class="value" id="externalMemory">--</span>
                    </div>
                </div>

                <div class="metric">
                    <div class="metric-header">
                        <span class="label">Dernière mise à jour</span>
                        <span class="value" id="lastUpdate">--</span>
                    </div>
                </div>

                <p class="small-note">
                    Les données sont actualisées automatiquement toutes
                    les 3 secondes.
                </p>
            </article>

        </section>

        <!-- TABLEAU -->
        <section class="card table-card">
            <div class="card-title">
                <span class="icon">📊</span>
                Detailed Statistics
            </div>

            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Catégorie</th>
                            <th>Mesure</th>
                            <th>Valeur</th>
                        </tr>
                    </thead>

                    <tbody>
                        <tr>
                            <td>Memory</td>
                            <td>RAM totale instance</td>
                            <td id="tableRamTotal">--</td>
                        </tr>

                        <tr>
                            <td>Memory</td>
                            <td>RAM utilisée instance</td>
                            <td id="tableRamUsed">--</td>
                        </tr>

                        <tr>
                            <td>Process</td>
                            <td>RAM RSS</td>
                            <td id="tableProcessRAM">--</td>
                        </tr>

                        <tr>
                            <td>Process</td>
                            <td>Heap utilisé</td>
                            <td id="tableHeap">--</td>
                        </tr>

                        <tr>
                            <td>CPU</td>
                            <td>CPU processus</td>
                            <td id="tableProcessCPU">--</td>
                        </tr>

                        <tr>
                            <td>CPU</td>
                            <td>CPU système</td>
                            <td id="tableSystemCPU">--</td>
                        </tr>

                        <tr>
                            <td>CPU</td>
                            <td>Cœurs logiques</td>
                            <td id="tableCores">--</td>
                        </tr>

                        <tr>
                            <td>Disk</td>
                            <td>Espace total</td>
                            <td id="tableDiskTotal">--</td>
                        </tr>

                        <tr>
                            <td>Disk</td>
                            <td>Espace utilisé</td>
                            <td id="tableDiskUsed">--</td>
                        </tr>

                        <tr>
                            <td>Disk</td>
                            <td>Espace libre</td>
                            <td id="tableDiskFree">--</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <p class="error-message" id="errorMessage"></p>
        </section>

        <footer class="footer">
            <span>Server Monitoring Dashboard</span>
            <span>Auto-refresh: 3 seconds</span>
        </footer>

    </main>

    <script>
        const $ = (id) => document.getElementById(id);

        function formatValue(value, unit = '') {
            if (value === null || value === undefined) {
                return 'N/A';
            }

            return value + unit;
        }

        function setText(id, value) {
            $(id).textContent = value;
        }

        function setBar(id, percent) {
            const bar = $(id);

            if (percent === null || percent === undefined) {
                bar.style.width = '0%';
                return;
            }

            const safePercent = Math.max(0, Math.min(100, percent));

            bar.style.width = safePercent + '%';
        }

        async function updateDashboard() {
            try {
                const responses = await Promise.all([
                    fetch('/health', { cache: 'no-store' }),
                    fetch('/stats', { cache: 'no-store' })
                ]);

                if (!responses[0].ok || !responses[1].ok) {
                    throw new Error('Le serveur a retourné une erreur.');
                }

                const health = await responses[0].json();
                const data = await responses[1].json();

                // Health status
                $('status').classList.remove('offline');

                setText(
                    'statusText',
                    health.status === 'ok' ? 'SERVER LIVE' : 'CHECK STATUS'
                );

                const container = data.container;
                const process = data.process;
                const cpu = data.cpu;
                const disk = data.disk;

                // RAM instance
                setText(
                    'ramTotal',
                    formatValue(container.totalRAM_GB, ' GB')
                );

                setText(
                    'ramUsed',
                    formatValue(container.usedRAM_GB, ' GB')
                );

                setText(
                    'processRAM',
                    formatValue(process.ramRSS_MB, ' MB')
                );

                setText(
                    'heapUsed',
                    formatValue(process.heapUsed_MB, ' MB')
                );

                setText(
                    'heapTotal',
                    formatValue(process.heapTotal_MB, ' MB')
                );

                setText(
                    'externalMemory',
                    formatValue(process.externalMemory_MB, ' MB')
                );

                const ramPercent =
                    container.totalRAM_GB > 0 &&
                    container.usedRAM_GB !== null
                        ? (container.usedRAM_GB /
                           container.totalRAM_GB) * 100
                        : null;

                setBar('ramBar', ramPercent);

                setText(
                    'memoryNote',
                    container.memorySource === 'container_limit'
                        ? 'RAM mesurée selon la limite du container.'
                        : 'RAM totale visible par le système. La RAM utilisée par le container est indisponible.'
                );

                // CPU
                setText(
                    'processCPU',
                    formatValue(process.cpuUsagePercent, ' %')
                );

                setText(
                    'systemCPU',
                    formatValue(cpu.systemUsagePercent, ' %')
                );

                setText(
                    'cpuCores',
                    formatValue(cpu.logicalCores)
                );

                setText(
                    'cpuQuota',
                    cpu.containerQuotaCores === null
                        ? 'N/A'
                        : cpu.containerQuotaCores + ' cores'
                );

                setBar('cpuBar', cpu.systemUsagePercent);

                // Disk
                setText(
                    'diskTotal',
                    formatValue(disk.total_GB, ' GB')
                );

                setText(
                    'diskUsed',
                    formatValue(disk.used_GB, ' GB')
                );

                setText(
                    'diskFree',
                    formatValue(disk.free_GB, ' GB')
                );

                setBar('diskBar', disk.usedPercent);

                setText(
                    'diskNote',
                    disk.source === 'root_filesystem'
                        ? 'Mesure du système de fichiers racine (/), pas nécessairement du quota disque du container.'
                        : 'Informations du disque indisponibles.'
                );

                // Tableau détaillé
                const rows = {
                    tableRamTotal: formatValue(container.totalRAM_GB, ' GB'),
                    tableRamUsed: formatValue(container.usedRAM_GB, ' GB'),
                    tableProcessRAM: formatValue(process.ramRSS_MB, ' MB'),
                    tableHeap: formatValue(process.heapUsed_MB, ' MB'),
                    tableProcessCPU: formatValue(process.cpuUsagePercent, ' %'),
                    tableSystemCPU: formatValue(cpu.systemUsagePercent, ' %'),
                    tableCores: formatValue(cpu.logicalCores),
                    tableDiskTotal: formatValue(disk.total_GB, ' GB'),
                    tableDiskUsed: formatValue(disk.used_GB, ' GB'),
                    tableDiskFree: formatValue(disk.free_GB, ' GB')
                };

                for (const [id, value] of Object.entries(rows)) {
                    setText(id, value);
                }

                setText(
                    'lastUpdate',
                    new Date().toLocaleTimeString('fr-FR')
                );

                setText('errorMessage', '');

            } catch (error) {
                $('status').classList.add('offline');
                setText('statusText', 'SERVER OFFLINE');

                setText(
                    'errorMessage',
                    'Impossible de récupérer les statistiques. Vérifiez que le serveur fonctionne.'
                );

                console.error('Dashboard error:', error);
            }
        }

        // Première actualisation
        updateDashboard();

        // Actualisation automatique toutes les 3 secondes
        setInterval(updateDashboard, 3000);
    </script>
</body>
</html>`);
});

// ==========================================
// 8. DEMARRAGE DU SERVEUR
// ==========================================

app.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log('Server Monitoring Dashboard');
    console.log('Server running on port ' + PORT);
    console.log('Dashboard : /');
    console.log('Health    : /health');
    console.log('Stats     : /stats');
    console.log('=================================');
});
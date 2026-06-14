import { Chart, registerables } from 'chart.js';
import { WebviewRequest, WebviewResponse, FileSummary, DayEntry, HourBlock, ProjectSummary } from '../types';

// Register all Chart.js components
Chart.register(...registerables);

// VS Code API handle
declare function acquireVsCodeApi(): {
    postMessage(message: any): void;
    getState(): any;
    setState(state: any): void;
};

const vscode = acquireVsCodeApi();

// Chart instances
let weeklyChart: Chart | null = null;
let filesChart: Chart | null = null;
let timelineChart: Chart | null = null;
let lineChangesChart: Chart | null = null;
let projectsChart: Chart | null = null;

// Current date
let currentDate = formatDate(new Date());

// --- Initialization ---

function init() {
    const datePicker = document.getElementById('datePicker') as HTMLInputElement;
    datePicker.value = currentDate;
    datePicker.addEventListener('change', (e) => {
        currentDate = (e.target as HTMLInputElement).value;
        loadAllData();
    });

    // Listen for messages from the extension host
    window.addEventListener('message', (event) => {
        const message = event.data as WebviewResponse;
        handleResponse(message);
    });

    // Load initial data
    loadAllData();
}

function loadAllData() {
    sendMessage({ type: 'getDailySummary', date: currentDate });
    sendMessage({ type: 'getWeeklyOverview' });
    sendMessage({ type: 'getFileBreakdown', date: currentDate, limit: 10 });
    sendMessage({ type: 'getTimeline', date: currentDate });
    sendMessage({ type: 'getLineChanges', date: currentDate, limit: 10 });
    sendMessage({ type: 'getProjectBreakdown', startDate: currentDate, endDate: currentDate });
}

function sendMessage(message: WebviewRequest) {
    vscode.postMessage(message);
}

// --- Response Handlers ---

function handleResponse(message: WebviewResponse) {
    switch (message.type) {
        case 'dailySummary':
            updateSummaryCards(message.data.totalMs, message.data.files);
            break;
        case 'weeklyOverview':
            renderWeeklyChart(message.data);
            break;
        case 'fileBreakdown':
            renderFilesChart(message.data);
            break;
        case 'timeline':
            renderTimelineChart(message.data);
            break;
        case 'lineChanges':
            renderLineChangesChart(message.data);
            break;
        case 'projectBreakdown':
            renderProjectsChart(message.data);
            break;
    }
}

// --- Summary Cards ---

function updateSummaryCards(totalMs: number, files: FileSummary[]) {
    const totalTimeEl = document.getElementById('totalTime')!;
    const fileCountEl = document.getElementById('fileCount')!;
    const linesChangedEl = document.getElementById('linesChanged')!;

    totalTimeEl.textContent = formatDuration(totalMs);
    fileCountEl.textContent = String(files.length);

    const totalAdded = files.reduce((sum, f) => sum + f.linesAdded, 0);
    const totalDeleted = files.reduce((sum, f) => sum + f.linesDeleted, 0);
    linesChangedEl.textContent = `+${totalAdded} / -${totalDeleted}`;
}

// --- Charts ---

function renderWeeklyChart(data: DayEntry[]) {
    const canvas = document.getElementById('weeklyChart') as HTMLCanvasElement;
    if (weeklyChart) weeklyChart.destroy();

    const labels = data.map(d => {
        const date = new Date(d.date + 'T00:00:00');
        return date.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
    });
    const values = data.map(d => d.totalMs / 3600_000); // hours

    weeklyChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Hours',
                data: values,
                backgroundColor: 'rgba(79, 140, 255, 0.7)',
                borderColor: 'rgba(79, 140, 255, 1)',
                borderWidth: 1,
                borderRadius: 4,
            }],
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => formatDuration(data[ctx.dataIndex].totalMs),
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Hours' },
                }
            }
        }
    });
}

function renderFilesChart(data: FileSummary[]) {
    const canvas = document.getElementById('filesChart') as HTMLCanvasElement;
    if (filesChart) filesChart.destroy();

    const labels = data.map(f => f.fileName);
    const values = data.map(f => f.totalMs / 60_000); // minutes

    filesChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Minutes',
                data: values,
                backgroundColor: 'rgba(79, 200, 140, 0.7)',
                borderColor: 'rgba(79, 200, 140, 1)',
                borderWidth: 1,
                borderRadius: 4,
            }],
        },
        options: {
            responsive: true,
            indexAxis: 'y',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => formatDuration(data[ctx.dataIndex].totalMs),
                        afterLabel: (ctx) => {
                            const f = data[ctx.dataIndex];
                            return `Lines: +${f.linesAdded} / -${f.linesDeleted}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    title: { display: true, text: 'Minutes' },
                }
            }
        }
    });
}

function renderTimelineChart(data: HourBlock[]) {
    const canvas = document.getElementById('timelineChart') as HTMLCanvasElement;
    if (timelineChart) timelineChart.destroy();

    // Build datasets: one per unique file (top files only)
    const allFiles = new Map<string, number[]>();
    for (const block of data) {
        for (const file of block.files) {
            if (!allFiles.has(file.fileName)) {
                allFiles.set(file.fileName, new Array(24).fill(0));
            }
            allFiles.get(file.fileName)![block.hour] = file.durationMs / 60_000;
        }
    }

    const colors = [
        'rgba(79, 140, 255, 0.7)',
        'rgba(255, 140, 79, 0.7)',
        'rgba(79, 200, 140, 0.7)',
        'rgba(200, 79, 200, 0.7)',
        'rgba(255, 200, 79, 0.7)',
    ];

    const datasets = Array.from(allFiles.entries()).slice(0, 5).map(([name, hours], idx) => ({
        label: name,
        data: hours,
        backgroundColor: colors[idx % colors.length],
        borderWidth: 0,
        borderRadius: 2,
    }));

    const labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);

    timelineChart = new Chart(canvas, {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' },
            },
            scales: {
                x: { stacked: true },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    title: { display: true, text: 'Minutes' },
                }
            }
        }
    });
}

function renderLineChangesChart(data: FileSummary[]) {
    const canvas = document.getElementById('lineChangesChart') as HTMLCanvasElement;
    if (lineChangesChart) lineChangesChart.destroy();

    const labels = data.map(f => f.fileName);

    lineChangesChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Lines Added',
                    data: data.map(f => f.linesAdded),
                    backgroundColor: 'rgba(79, 200, 79, 0.7)',
                    borderColor: 'rgba(79, 200, 79, 1)',
                    borderWidth: 1,
                    borderRadius: 4,
                },
                {
                    label: 'Lines Deleted',
                    data: data.map(f => f.linesDeleted),
                    backgroundColor: 'rgba(255, 99, 99, 0.7)',
                    borderColor: 'rgba(255, 99, 99, 1)',
                    borderWidth: 1,
                    borderRadius: 4,
                },
            ],
        },
        options: {
            responsive: true,
            indexAxis: 'y',
            plugins: {
                legend: { position: 'bottom' },
            },
            scales: {
                x: {
                    beginAtZero: true,
                    title: { display: true, text: 'Lines' },
                }
            }
        }
    });
}

function renderProjectsChart(data: ProjectSummary[]) {
    const canvas = document.getElementById('projectsChart') as HTMLCanvasElement;
    if (projectsChart) projectsChart.destroy();

    if (data.length === 0) {
        projectsChart = null;
        return;
    }

    const labels = data.map(p => `${p.projectName} (${p.remoteType}${p.machineName ? ' @ ' + p.machineName : ''})`);
    const values = data.map(p => p.totalMs / 60_000);
    const colors = generateColors(data.length);

    projectsChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderWidth: 2,
            }],
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'right' },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const p = data[ctx.dataIndex];
                            return ` ${formatDuration(p.totalMs)}`;
                        }
                    }
                }
            }
        }
    });
}

// --- Utilities ---

function formatDuration(ms: number): string {
    const totalMin = Math.floor(ms / 60_000);
    const hours = Math.floor(totalMin / 60);
    const minutes = totalMin % 60;
    if (hours === 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
}

function formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function generateColors(count: number): string[] {
    const baseColors = [
        'rgba(79, 140, 255, 0.7)',
        'rgba(255, 140, 79, 0.7)',
        'rgba(79, 200, 140, 0.7)',
        'rgba(200, 79, 200, 0.7)',
        'rgba(255, 200, 79, 0.7)',
        'rgba(79, 200, 255, 0.7)',
        'rgba(255, 79, 140, 0.7)',
        'rgba(140, 255, 79, 0.7)',
    ];
    const colors: string[] = [];
    for (let i = 0; i < count; i++) {
        colors.push(baseColors[i % baseColors.length]);
    }
    return colors;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

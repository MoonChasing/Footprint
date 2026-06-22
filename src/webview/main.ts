import { Chart, registerables } from 'chart.js';
import { WebviewRequest, WebviewResponse, FileSummary, DayEntry, HourBlock, ProjectSummary, LanguageSummary, RemoteType } from '../types';
import { formatDateUtc8, dayRangeUtc8, weekRangeUtc8, monthRangeUtc8, daysAgoUtc8 } from '../utils/tz';

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
let overviewChart: Chart | null = null;
let filesChart: Chart | null = null;
let timelineChart: Chart | null = null;
let lineChangesChart: Chart | null = null;
let projectsChart: Chart | null = null;
let languagesChart: Chart | null = null;

// --- Range state ---
//
// Time-range selection used by every chart on this page. We default to "today"
// (preserves the prior behavior). A single trigger button opens a popover that
// hosts both preset shortcuts and a custom date-range input. The trigger's
// label always reflects the current selection so the entry point doubles as
// a status indicator.
type Preset = 'today' | 'thisWeek' | 'thisMonth' | 'last7' | 'last30';
type Range = { startDate: string; endDate: string };

let currentRange: Range = computePresetRange('today');
let currentPreset: Preset | null = 'today';

function computePresetRange(preset: Preset): Range {
    switch (preset) {
        case 'today': {
            const today = formatDateUtc8();
            return { startDate: today, endDate: today };
        }
        case 'thisWeek':
            return weekRangeUtc8();
        case 'thisMonth':
            return monthRangeUtc8();
        case 'last7':
            return { startDate: daysAgoUtc8(6), endDate: formatDateUtc8() };
        case 'last30':
            return { startDate: daysAgoUtc8(29), endDate: formatDateUtc8() };
    }
}

const PRESET_LABELS: Record<Preset, string> = {
    today: '今天',
    thisWeek: '本周',
    thisMonth: '本月',
    last7: '近 7 天',
    last30: '近 30 天',
};

/** Detect whether a range matches a known preset; null = custom. */
function matchPreset(range: Range): Preset | null {
    const presets: Preset[] = ['today', 'thisWeek', 'thisMonth', 'last7', 'last30'];
    for (const p of presets) {
        const r = computePresetRange(p);
        if (r.startDate === range.startDate && r.endDate === range.endDate) return p;
    }
    return null;
}

/** Render the trigger button's label so it summarizes the current range. */
function renderTriggerLabel(triggerLabel: HTMLElement) {
    if (currentPreset) {
        // For "today" the range is one day and the label suffix would just
        // repeat the same date twice — keep it short.
        if (currentPreset === 'today') {
            triggerLabel.textContent = `${PRESET_LABELS.today}  ·  ${currentRange.startDate}`;
        } else {
            triggerLabel.textContent = `${PRESET_LABELS[currentPreset]}  ·  ${currentRange.startDate} — ${currentRange.endDate}`;
        }
    } else {
        triggerLabel.textContent = `自定义  ·  ${currentRange.startDate} — ${currentRange.endDate}`;
    }
}

// --- Initialization ---

function init() {
    const trigger = document.getElementById('rangeTrigger') as HTMLButtonElement;
    const triggerLabel = document.getElementById('rangeTriggerLabel') as HTMLSpanElement;
    const popover = document.getElementById('rangePopover') as HTMLDivElement;
    const presetButtons = popover.querySelectorAll<HTMLButtonElement>('.range-preset');
    const rangeStart = document.getElementById('rangeStart') as HTMLInputElement;
    const rangeEnd = document.getElementById('rangeEnd') as HTMLInputElement;
    const applyBtn = document.getElementById('rangeApply') as HTMLButtonElement;

    // --- Popover open/close ---

    function openPopover() {
        popover.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        // Seed the custom-range inputs with whatever's currently active so the
        // user has a starting point if they want to tweak.
        rangeStart.value = currentRange.startDate;
        rangeEnd.value = currentRange.endDate;
        syncActivePreset();
    }

    function closePopover() {
        popover.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
    }

    function syncActivePreset() {
        presetButtons.forEach(b => {
            b.classList.toggle('active', b.dataset.preset === currentPreset);
        });
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (popover.hidden) openPopover(); else closePopover();
    });

    // Close on outside click — clicking inside the popover should NOT close it.
    document.addEventListener('click', (e) => {
        if (popover.hidden) return;
        if (e.target instanceof Node && (popover.contains(e.target) || trigger.contains(e.target))) return;
        closePopover();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !popover.hidden) closePopover();
    });

    // --- Preset clicks: apply immediately and close the popover ---

    presetButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.dataset.preset as Preset;
            currentPreset = preset;
            currentRange = computePresetRange(preset);
            syncActivePreset();
            renderTriggerLabel(triggerLabel);
            closePopover();
            loadAllData();
        });
    });

    // --- Custom-range Apply: explicit confirmation, not on every input change.
    // This avoids triggering two queries when the user edits both inputs. ---

    applyBtn.addEventListener('click', () => {
        if (!rangeStart.value || !rangeEnd.value) return;
        let s = rangeStart.value, e = rangeEnd.value;
        if (s > e) [s, e] = [e, s];
        currentRange = { startDate: s, endDate: e };
        currentPreset = matchPreset(currentRange);
        syncActivePreset();
        renderTriggerLabel(triggerLabel);
        closePopover();
        loadAllData();
    });

    // Initial label
    renderTriggerLabel(triggerLabel);

    // Listen for messages from the extension host
    window.addEventListener('message', (event) => {
        const message = event.data as WebviewResponse;
        handleResponse(message);
    });

    // Load initial data
    loadAllData();
}

function loadAllData() {
    const { startDate, endDate } = currentRange;
    sendMessage({ type: 'getDailySummary', startDate, endDate });
    sendMessage({ type: 'getDailyOverview', startDate, endDate });
    sendMessage({ type: 'getFileBreakdown', startDate, endDate, limit: 10 });
    sendMessage({ type: 'getTimeline', startDate, endDate });
    sendMessage({ type: 'getLineChanges', startDate, endDate, limit: 10 });
    sendMessage({ type: 'getProjectBreakdown', startDate, endDate });
    sendMessage({ type: 'getLanguageBreakdown', startDate, endDate });
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
        case 'dailyOverview':
            renderOverviewChart(message.data, message.bucket);
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
        case 'languageBreakdown':
            renderLanguagesChart(message.data);
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

/**
 * Render the time-overview bar chart.
 *
 * Backend bucketing (in queries.ts:getDailyOverview):
 * - bucket='day' → one bar per UTC+8 day, label = "Mon Jun 22"
 * - bucket='week' → one bar per ISO week, label = "Week of Jun 22"
 *
 * The H2 title above the canvas is also rewritten to match.
 */
function renderOverviewChart(data: DayEntry[], bucket: 'day' | 'week') {
    const canvas = document.getElementById('overviewChart') as HTMLCanvasElement;
    if (overviewChart) overviewChart.destroy();

    // Rewrite the section heading to match the bucket granularity.
    const heading = canvas.previousElementSibling;
    if (heading && heading.tagName === 'H2') {
        heading.textContent = bucket === 'day' ? 'By Day' : 'By Week';
    }

    const labels = data.map(d => {
        const { start } = dayRangeUtc8(d.date);
        const date = new Date(start);
        if (bucket === 'day') {
            return date.toLocaleDateString('en', {
                weekday: 'short', month: 'short', day: 'numeric',
                timeZone: 'Asia/Shanghai',
            });
        }
        return 'Week of ' + date.toLocaleDateString('en', {
            month: 'short', day: 'numeric',
            timeZone: 'Asia/Shanghai',
        });
    });
    const values = data.map(d => d.totalMs / 3600_000); // hours

    overviewChart = new Chart(canvas, {
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
                            const parts = [`Lines: +${f.linesAdded} / -${f.linesDeleted}`];
                            if (f.languageId) parts.push(`Lang: ${f.languageId}`);
                            return parts.join('\n');
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

    // Only show the basename (e.g. "ad.h"), not the full path
    const labels = data.map(f => {
        const name = f.fileName || f.filePath || '';
        const sep = name.lastIndexOf('/') >= 0 ? '/' : '\\';
        return name.split(sep).pop() || name;
    });

    // Custom plugin to draw value labels on bars
    const dataLabelsPlugin = {
        id: 'lineChangesDataLabels',
        afterDatasetsDraw(chart: Chart) {
            const ctx = chart.ctx;
            chart.data.datasets.forEach((dataset, dsIndex) => {
                const meta = chart.getDatasetMeta(dsIndex);
                meta.data.forEach((bar, index) => {
                    const value = dataset.data[index] as number;
                    if (value === 0) return;
                    ctx.save();
                    ctx.fillStyle = getComputedStyle(canvas).color || '#ccc';
                    ctx.font = '11px sans-serif';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    const x = (bar as any).x + 4;
                    const y = (bar as any).y;
                    ctx.fillText(String(value), x, y);
                    ctx.restore();
                });
            });
        }
    };

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
        },
        plugins: [dataLabelsPlugin as any],
    });
}

/**
 * Build a compact, informative label for the Projects doughnut legend.
 *
 * Local rows just show the project name. Remote rows append a short
 * "(tag: host)" segment where host is derived from remoteHost — NOT
 * machineName, which is the local extension-host machine and would be
 * misleading for remote rows.
 */
const REMOTE_TAGS: Record<Exclude<RemoteType, 'local'>, string> = {
    'ssh-remote': 'ssh',
    'wsl': 'wsl',
    'dev-container': 'devc',
    'codespaces': 'cs',
};

function buildProjectLabel(p: ProjectSummary): string {
    if (p.remoteType === 'local') return p.projectName;

    const tag = REMOTE_TAGS[p.remoteType];
    let host = p.remoteHost ?? '';

    // SSH hosts often come in as "user@server" — the user part is noise in a legend.
    if (p.remoteType === 'ssh-remote' && host) {
        const at = host.lastIndexOf('@');
        if (at >= 0) host = host.slice(at + 1);
        host = host.replace(/:\d+$/, '');
    }

    // Doughnut legend gets crowded fast; cap the host segment.
    const MAX = 32;
    if (host.length > MAX) host = host.slice(0, MAX - 1) + '…';

    return host
        ? `${p.projectName} (${tag}: ${host})`
        : `${p.projectName} (${tag})`;
}

function renderProjectsChart(data: ProjectSummary[]) {
    const canvas = document.getElementById('projectsChart') as HTMLCanvasElement;
    if (projectsChart) projectsChart.destroy();
    if (data.length === 0) {
        projectsChart = null;
        return;
    }

    const labels = data.map(buildProjectLabel);
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
                            const where = p.remoteType === 'local'
                                ? 'local'
                                : `${p.remoteType}${p.remoteHost ? ' → ' + p.remoteHost : ''}`;
                            return ` ${formatDuration(p.totalMs)}  •  ${where}`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Render the Languages doughnut chart.
 * Buckets sessions by their VSCode languageId (cpp / typescript / python / ...).
 * Sessions whose languageId is null (binary files, unknown extensions) collapse
 * into an "(unknown)" slice.
 */
function renderLanguagesChart(data: LanguageSummary[]) {
    const canvas = document.getElementById('languagesChart') as HTMLCanvasElement;
    if (languagesChart) languagesChart.destroy();
    if (data.length === 0) {
        languagesChart = null;
        return;
    }

    const labels = data.map(l => l.languageId ?? '(unknown)');
    const values = data.map(l => l.totalMs / 60_000);
    const colors = generateColors(data.length);

    languagesChart = new Chart(canvas, {
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
                            const l = data[ctx.dataIndex];
                            const files = l.fileCount === 1 ? '1 file' : `${l.fileCount} files`;
                            return ` ${formatDuration(l.totalMs)}  •  ${files}`;
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

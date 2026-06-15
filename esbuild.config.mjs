import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Bundle 1: Extension host (Node.js)
const extensionOptions = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: !production,
    minify: production,
    treeShaking: true,
};

// Bundle 2: Webview (browser)
const webviewOptions = {
    entryPoints: ['src/webview/main.ts'],
    bundle: true,
    outfile: 'dist/webview/main.js',
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    sourcemap: !production,
    minify: production,
};

async function build() {
    // Ensure output directories exist
    mkdirSync('dist/webview', { recursive: true });

    if (watch) {
        const extCtx = await esbuild.context(extensionOptions);
        const webCtx = await esbuild.context(webviewOptions);
        await Promise.all([extCtx.watch(), webCtx.watch()]);
        console.log('[watch] Build started...');
    } else {
        await Promise.all([
            esbuild.build(extensionOptions),
            esbuild.build(webviewOptions),
        ]);
        console.log('[build] Done.');
    }

    // Copy webview assets (HTML and CSS)
    mkdirSync('dist/webview', { recursive: true });
    try {
        copyFileSync('src/webview/index.html', 'dist/webview/index.html');
        copyFileSync('src/webview/styles.css', 'dist/webview/styles.css');
    } catch (e) {
        // Assets may not exist yet during initial scaffold
    }

    // Copy sql.js WASM binary to dist/
    try {
        copyFileSync('node_modules/sql.js/dist/sql-wasm.wasm', 'dist/sql-wasm.wasm');
        console.log('[build] Copied sql-wasm.wasm to dist/');
    } catch (e) {
        console.warn('[build] Warning: Could not copy sql-wasm.wasm:', e);
    }
}

build().catch((e) => {
    console.error(e);
    process.exit(1);
});

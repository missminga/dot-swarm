import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist/panel', { recursive: true });
await build({ entryPoints: ['panel/main.tsx'], bundle: true, minify: true, format: 'esm', outdir: 'dist/panel', target: 'es2022' });
await copyFile('panel/index.html', 'dist/panel/index.html');
await copyFile('src/client.js', 'dist/client.js');

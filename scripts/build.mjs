import { mkdir, rm, copyFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { publicConfig } from './public-config.mjs';
const config = publicConfig(process.env); // Validate before touching build output.
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
for (const file of ['index.html','styles.css','date-utils.js','waterdrop-utils.js','recurring-utils.js','app.js','finance-utils.js','backup-utils.js','backup-storage.js','backup-boot.js','sw.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png']) await copyFile(file, `dist/${file}`);
await build({ entryPoints: ['cloud/ui.mjs'], outfile: 'dist/cloud-foundation.js', bundle: true, format: 'iife', platform: 'browser', target: ['es2020'], minify: true, sourcemap: false, legalComments: 'eof' });
await writeFile('dist/cloud-config.json', JSON.stringify(config));
console.log(`Static build ready: Supabase ${config.enabled ? 'configured' : 'disabled; local ledger available'}.`);

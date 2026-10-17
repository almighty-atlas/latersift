import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
const entries = {};
async function collect(dir, prefix = '') {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = prefix + e.name;
    if (e.isDirectory()) await collect(`${dir}/${e.name}`, `${path}/`);
    else entries[path] = new Uint8Array(await readFile(`${dir}/${e.name}`));
  }
}
await collect('dist');
const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (manifest.version !== pkg.version)
  throw new Error('Manifest- und Paketversion stimmen nicht überein.');
const output = `artifacts/latersift-${manifest.version}-unsigned.xpi`;
await mkdir('artifacts', { recursive: true });
await writeFile(output, zipSync(entries));
console.log(output);

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
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/latersift-0.1.0-unsigned.xpi', zipSync(entries));
console.log('artifacts/latersift-0.1.0-unsigned.xpi');

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
// Wot 1.14.0 ships dayjs/index.d.ts but omits the locale declaration it references.
// Restore the upstream Day.js declaration, without editing or suppressing its types.
const wot = JSON.parse(await readFile('node_modules/wot-design-uni/package.json', 'utf8'));
const path = 'node_modules/wot-design-uni/dayjs/locale/index.d.ts';
let missing = false;
try {
  await access(path);
} catch {
  missing = true;
}
if (missing) {
  if (wot.version !== '1.14.0')
    throw new Error('Reverify the Wot locale packaging repair for this version');
  const upstream = await readFile('node_modules/dayjs/locale/index.d.ts', 'utf8');
  const type = await readFile('node_modules/dayjs/locale/types.d.ts', 'utf8');
  await mkdir('node_modules/wot-design-uni/dayjs/locale', { recursive: true });
  await writeFile(path, upstream);
  await writeFile('node_modules/wot-design-uni/dayjs/locale/types.d.ts', type);
}
// Keep the runtime compatible with uni-app's Vue 3.2 renderer. Correct the
// legacy declaration's unconstrained index for current TypeScript.
const pinia = JSON.parse(await readFile('node_modules/pinia/package.json', 'utf8'));
if (pinia.version === '2.0.36') {
  const declaration = 'node_modules/pinia/dist/pinia.d.ts';
  const source = await readFile(declaration, 'utf8');
  const before = '[key in Keys]: () => Store<string, S, G, {}>[key];';
  const after =
    '[key in Keys]: () => key extends keyof Store<string, S, G, {}> ? Store<string, S, G, {}>[key] : never;';
  if (source.includes(before)) await writeFile(declaration, source.replace(before, after));
  else if (!source.includes(after))
    throw new Error('Reverify the Pinia mapped-state declaration repair');
}

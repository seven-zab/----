import { readFile, writeFile, mkdir } from 'node:fs/promises';
const root = JSON.parse(await readFile('package.json', 'utf8'));
const release = JSON.parse(await readFile('contracts/generated/release.json', 'utf8'));
for (const name of Object.keys({ ...release.targets, ...release.workers })) {
  await mkdir(`cloudfunctions/${name}`, { recursive: true });
  await writeFile(
    `cloudfunctions/${name}/package.json`,
    JSON.stringify(
      {
        name,
        version: '2.0.0',
        private: true,
        main: 'index.js',
        engines: { node: '>=16.13' },
        dependencies: { 'wx-server-sdk': root.dependencies['wx-server-sdk'] },
        overrides: root.overrides ?? {},
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    `cloudfunctions/${name}/index.js`,
    "exports.main = async (event, context) => require('./runtime.cjs').main(event, context);\n",
  );
}
console.log(
  `Prepared ${
    Object.keys({ ...release.targets, ...release.workers }).length
  } function manifests; run standard lock installation per directory.`,
);

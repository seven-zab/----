import { readFile, mkdir, writeFile } from 'node:fs/promises';
const specification = await readFile('docs/architecture/implementation.md', 'utf8');
const cases = [];
const ids = new Set();
for (const line of specification.split(/\r?\n/)) {
  const columns = line
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());
  if (!/^[A-Z]+-\d{2}$/.test(columns[0] ?? '')) continue;
  if (ids.has(columns[0])) throw new Error(`Duplicate acceptance ID: ${columns[0]}`);
  ids.add(columns[0]);
  cases.push([
    columns[0],
    columns[1],
    columns[2],
    '真实测试云/真机（按用例）',
    '未执行',
    '',
    '',
    '',
  ]);
}
if (cases.length < 80)
  throw new Error('Acceptance extraction incomplete; inspect specification tables');
const escape = (value) => `"${String(value).replaceAll('"', '""')}"`;
const content =
  '\ufeff' +
  [
    [
      '用例编号',
      '场景',
      '预期结果',
      '执行环境',
      '实测结果',
      '证据路径或请求编号',
      '缺陷编号或阻塞原因',
      '测试人及时间',
    ],
    ...cases,
  ]
    .map((row) => row.map(escape).join(','))
    .join('\r\n') +
  '\r\n';
const path = 'docs/testing/acceptance-template.csv';
if (process.argv.includes('--check')) {
  const template = await readFile(path, 'utf8');
  // Git can check out the same CSV with either LF or CRLF line endings.
  if (template.replaceAll('\r\n', '\n') !== content.replaceAll('\r\n', '\n'))
    throw new Error('Acceptance template differs from frozen specification');
} else {
  await mkdir('docs/testing', { recursive: true });
  await writeFile(path, content);
}
console.log(
  `${cases.length} acceptance cases ${
    process.argv.includes('--check') ? 'checked' : 'generated'
  }; no test result recorded.`,
);

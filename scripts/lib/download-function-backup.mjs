import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// The IDE can report download success without producing any files. Each retry
// uses a fresh destination so a partial directory cannot be accepted as success.
export async function downloadFunctionBackup(root, name, download, read = readFile) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const directory = join(root, attempt ? `${name}-retry-${attempt}` : name);
    await download(directory);
    try {
      const entry = await read(join(directory, 'index.js'));
      if (entry.length === 0) throw new Error(`Empty backup entry: ${name}`);
      return { directory, entry };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (attempt === 2) throw new Error(`No downloaded backup entry after 3 attempts: ${name}`);
    }
  }
  throw new Error('Unreachable backup state');
}

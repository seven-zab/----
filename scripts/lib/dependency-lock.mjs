import { createHash } from 'node:crypto';

export const dependencyArtifactHash = (manifestBytes, lockBytes) =>
  createHash('sha256').update(manifestBytes).update('\0').update(lockBytes).digest('hex');

// Root audits cannot see stale independent cloud locks. Keep the SDK's wire
// serializer and UTF-8 decoder aligned with the reviewed root lock at every gate.
export function assertSdkSerializationParity(reference, lock, label = 'function') {
  for (const name of ['protobufjs', '@protobufjs/utf8']) {
    const expected = reference.packages?.[`node_modules/${name}`]?.version;
    const entries = Object.entries(lock.packages ?? {}).filter(
      ([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`),
    );
    if (!expected || !entries.length || entries.some(([, entry]) => entry.version !== expected))
      throw new Error(
        `SDK serialization dependency differs from reviewed root (${label}): ${name}`,
      );
  }
}

// npm ci may regenerate an out-of-date lock instead of rejecting changed overrides.
// Check exact global overrides before packaging independently installed functions.
export function assertDependencyLock(manifest, lock, label = 'package') {
  const fail = (reason) => {
    throw new Error(`Unsafe dependency lock (${label}): ${reason}`);
  };
  if (lock?.lockfileVersion !== 3 || !lock.packages?.['']) fail('lockfile v3 required');
  const canonical = (value) => JSON.stringify(Object.entries(value ?? {}).sort());
  if (canonical(lock.packages[''].dependencies) !== canonical(manifest.dependencies))
    fail('direct dependencies do not match manifest');
  if (canonical(lock.packages[''].devDependencies) !== canonical(manifest.devDependencies))
    fail('development dependencies do not match manifest');
  const pins = Object.entries(manifest.overrides ?? {}).filter(
    ([name, version]) =>
      /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u.test(name) &&
      typeof version === 'string' &&
      /^\d+\.\d+\.\d+$/u.test(version),
  );
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (entry.link || /^(?:file:|link:)/u.test(entry.resolved ?? ''))
      fail('local or linked dependency');
    for (const [name, version] of pins) {
      if (
        (path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`)) &&
        entry.version !== version
      )
        fail(`${path} must resolve to pinned ${version}`);
    }
  }
}

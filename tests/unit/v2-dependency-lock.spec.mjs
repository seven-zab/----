// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  assertDependencyLock,
  assertSdkSerializationParity,
  dependencyArtifactHash,
} from '../../scripts/lib/dependency-lock.mjs';

const manifest = {
  dependencies: { 'wx-server-sdk': '4.0.2' },
  overrides: { axios: '0.34.0', 'jpeg-js': '0.4.4' },
};
const fixture = () => ({
  lockfileVersion: 3,
  packages: {
    '': { dependencies: { ...manifest.dependencies } },
    'node_modules/axios': { version: '0.34.0' },
    'node_modules/nested/node_modules/jpeg-js': { version: '0.4.4' },
  },
});
describe('deployable dependency lock safety', () => {
  it('binds deployment evidence to both the manifest and lock bytes', () => {
    const hash = dependencyArtifactHash('manifest', 'lock');
    expect(hash).toHaveLength(64);
    expect(dependencyArtifactHash('manifest-changed', 'lock')).not.toBe(hash);
    expect(dependencyArtifactHash('manifest', 'lock-changed')).not.toBe(hash);
    expect(dependencyArtifactHash('manifest', 'lock')).toBe(hash);
  });
  it('blocks a stale SDK HTTP dependency despite unchanged direct SDK version', () => {
    const lock = fixture();
    lock.packages['node_modules/axios'].version = '0.27.2';
    expect(() => assertDependencyLock(manifest, lock)).toThrow('axios must resolve');
  });
  it('checks nested copies so a safe hoisted decoder cannot hide a vulnerable copy', () => {
    const lock = fixture();
    lock.packages['node_modules/jpeg-js'] = { version: '0.4.4' };
    lock.packages['node_modules/nested/node_modules/jpeg-js'].version = '0.3.7';
    expect(() => assertDependencyLock(manifest, lock)).toThrow('jpeg-js must resolve');
  });
  it('rejects changed direct dependencies and local runtime dependencies', () => {
    const changed = fixture();
    changed.packages[''].dependencies['wx-server-sdk'] = '2.5.3';
    expect(() => assertDependencyLock(manifest, changed)).toThrow('direct dependencies');
    const linked = fixture();
    linked.packages['node_modules/axios'].resolved = 'file:../private';
    expect(() => assertDependencyLock(manifest, linked)).toThrow('local or linked');
  });
  it('accepts matching pins, scoped packages and semantically unordered direct dependencies', () => {
    const lock = fixture();
    lock.packages['node_modules/nested/node_modules/@example/safe'] = { version: '1.2.3' };
    const withScope = {
      ...manifest,
      overrides: { ...manifest.overrides, '@example/safe': '1.2.3' },
    };
    expect(() => assertDependencyLock(withScope, lock)).not.toThrow();
    lock.packages['node_modules/nested/node_modules/@example/safe'].version = '1.2.2';
    expect(() => assertDependencyLock(withScope, lock)).toThrow('@example/safe must resolve');
  });
  it('rejects stale independent serializers even when the root lock is already repaired', () => {
    const reference = {
      packages: {
        'node_modules/protobufjs': { version: '7.6.6' },
        'node_modules/@protobufjs/utf8': { version: '1.1.2' },
      },
    };
    const lock = JSON.parse(JSON.stringify(reference));
    expect(() => assertSdkSerializationParity(reference, lock)).not.toThrow();
    lock.packages['node_modules/protobufjs'].version = '7.5.4';
    expect(() => assertSdkSerializationParity(reference, lock, 'statsService')).toThrow(
      'statsService',
    );
    lock.packages['node_modules/protobufjs'].version = '7.6.6';
    lock.packages['node_modules/nested/node_modules/@protobufjs/utf8'] = { version: '1.1.0' };
    expect(() => assertSdkSerializationParity(reference, lock)).toThrow('@protobufjs/utf8');
  });
  it('requires a complete serializer reference and both independent runtime dependencies', () => {
    const reference = {
      packages: {
        'node_modules/protobufjs': { version: '7.6.6' },
        'node_modules/@protobufjs/utf8': { version: '1.1.2' },
      },
    };
    expect(() => assertSdkSerializationParity({}, reference)).toThrow('protobufjs');
    const missing = JSON.parse(JSON.stringify(reference));
    delete missing.packages['node_modules/@protobufjs/utf8'];
    expect(() => assertSdkSerializationParity(reference, missing)).toThrow('@protobufjs/utf8');
  });
});

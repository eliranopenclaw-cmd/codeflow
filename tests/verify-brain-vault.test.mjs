import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { resolveBrainVaultPath, LEGACY_BRAIN_VAULT } from './verify-brain-vault.mjs';

const REPO_LOCAL_VAULT = fileURLToPath(new URL('../../vault', import.meta.url));

test('resolveBrainVaultPath prefers explicit env var', () => {
  assert.equal(
    resolveBrainVaultPath({ env: { BRAIN_VAULT: '/tmp/custom-vault' }, exists: () => true }),
    '/tmp/custom-vault',
  );
});

test('resolveBrainVaultPath falls back to repo-local vault before legacy external default', () => {
  assert.equal(
    resolveBrainVaultPath({ env: {}, exists: (candidate) => candidate === REPO_LOCAL_VAULT }),
    REPO_LOCAL_VAULT,
  );
});

test('resolveBrainVaultPath keeps the legacy default when no repo-local vault exists', () => {
  assert.equal(
    resolveBrainVaultPath({ env: {}, exists: () => false }),
    LEGACY_BRAIN_VAULT,
  );
});

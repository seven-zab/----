/** Local operator guard; cloud authentication and business authorization remain separate. */
export function assertIndependentTestTarget(targetEnvId, designatedTestEnvId, knownEnvironment) {
  if (!designatedTestEnvId || targetEnvId !== designatedTestEnvId) {
    throw new Error('Only an explicitly designated test environment is supported');
  }
  if (knownEnvironment !== null && knownEnvironment !== undefined) {
    if (
      typeof knownEnvironment !== 'object' ||
      Array.isArray(knownEnvironment) ||
      typeof knownEnvironment.env_id !== 'string'
    ) {
      throw new Error('Invalid local environment protection record; refusing cloud writes');
    }
    if (
      knownEnvironment.env_id === targetEnvId &&
      (knownEnvironment.allow_test_writes === false ||
        (knownEnvironment.test_environment_confirmed !== true &&
          (knownEnvironment.preserve_data === true ||
            knownEnvironment.environment_usage === 'existing_data')))
    ) {
      throw new Error(
        'This environment has not been authorized for test writes; its existing data must be preserved',
      );
    }
  }
}

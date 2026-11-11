export function apiTimeoutPlan(envId, targets, configs) {
  const changes = [];
  if (configs.length !== Object.keys(targets).length)
    throw new Error('Incomplete API configuration audit');
  const seen = new Set();
  for (const [service, name] of Object.entries(targets)) {
    if (!/^[A-Za-z]+Service$/u.test(service) || name !== `yzxz_v2_${service}` || seen.has(name))
      throw new Error('Only existing versioned API functions are allowed');
    seen.add(name);
    const config = configs.find((c) => c.FunctionName === name);
    if (
      !config ||
      config.Namespace !== envId ||
      config.Status !== 'Active' ||
      !Number.isSafeInteger(config.Timeout) ||
      config.Timeout < 1 ||
      config.Timeout > 900
    )
      throw new Error('API configuration target or state is not verified');
    if (config.Timeout < 30)
      changes.push({
        service,
        FunctionName: name,
        Namespace: envId,
        previous_timeout: config.Timeout,
        Timeout: 30,
      });
  }
  return { env_id: envId, changes, database_writes: false, workers_changed: false };
}
export const timeoutPayload = (change) => ({
  FunctionName: change.FunctionName,
  Namespace: change.Namespace,
  Timeout: change.Timeout,
});

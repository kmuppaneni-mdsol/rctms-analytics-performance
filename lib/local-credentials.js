export function loginCredentials(values) {
  const keys = ['ANALYTICS_USERNAME', 'ANALYTICS_PASSWORD'];
  for (const key of keys) {
    if (typeof values[key] !== 'string' || values[key].trim().length === 0) {
      throw new Error(`Set a non-empty ${key} in the local .env file.`);
    }
  }
  return Object.fromEntries(keys.map((key) => [key, values[key]]));
}

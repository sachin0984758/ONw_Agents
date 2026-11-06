const SENSITIVE_ENV_NAME = /(?:^|_)(?:API[_-]?KEY|ACCESS[_-]?KEY|CLIENT[_-]?SECRET|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?|PRIVATE[_-]?KEY|AUTHORIZATION|AUTH[_-]?TOKEN|ASKPASS|SSH_AUTH_SOCK|(?:DATABASE|DB|REDIS|POSTGRES|MYSQL)[_-]?URL|CONNECTION_STRING)(?:_|$)/i

/** Remove common credential-like names from ambient child-process environments. */
export function filterSensitiveEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !SENSITIVE_ENV_NAME.test(name)))
}

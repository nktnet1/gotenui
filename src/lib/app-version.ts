const fullCommitSha = /^[a-f\d]{40}$/i

/** Vercel provides this at build time. Do not expose unrelated server variables. */
export function vercelCommitSha(environment: {
  VERCEL?: string
  VERCEL_GIT_COMMIT_SHA?: string
}): string {
  const sha = environment.VERCEL_GIT_COMMIT_SHA
  return environment.VERCEL === '1' && sha && fullCommitSha.test(sha) ? sha.toLowerCase() : ''
}

/** Show the deployed revision on Vercel, otherwise the package release version. */
export function appVersionLabel(version: string, commitSha?: string): string {
  return commitSha && fullCommitSha.test(commitSha)
    ? `commit-${commitSha.slice(0, 7).toLowerCase()}`
    : `v${version}`
}

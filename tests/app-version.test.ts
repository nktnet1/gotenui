import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { appVersionLabel, vercelCommitSha } from '#/lib/app-version'

const commit = '0123456789abcdef0123456789abcdef01234567'

describe('deployment version label', () => {
  it('uses the full Vercel deployment SHA only when running on Vercel', () => {
    assert.equal(vercelCommitSha({ VERCEL: '1', VERCEL_GIT_COMMIT_SHA: commit }), commit)
    assert.equal(vercelCommitSha({ VERCEL_GIT_COMMIT_SHA: commit }), '')
    assert.equal(vercelCommitSha({ VERCEL: '0', VERCEL_GIT_COMMIT_SHA: commit }), '')
  })

  it('does not display malformed or incomplete Git hashes', () => {
    for (const invalid of ['', '1234567', 'x'.repeat(40), `${commit}extra`]) {
      assert.equal(vercelCommitSha({ VERCEL: '1', VERCEL_GIT_COMMIT_SHA: invalid }), '')
      assert.equal(appVersionLabel('0.1.2', invalid), 'v0.1.2')
    }
  })

  it('shows the first seven hexadecimal characters for Vercel builds', () => {
    assert.equal(appVersionLabel('0.1.2', commit), '0123456')
    assert.equal(appVersionLabel('0.1.2', commit.toUpperCase()), '0123456')
  })

  it('preserves package version on non-Vercel builds', () => {
    assert.equal(appVersionLabel('0.1.2', ''), 'v0.1.2')
    assert.equal(appVersionLabel('0.1.2'), 'v0.1.2')
  })
})

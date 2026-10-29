// SemVer release tags omit build metadata, since Docker image tags cannot contain '+'.
const core = '(0|[1-9][0-9]*)'
const identifier = '(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)'
const releaseTag = new RegExp(
  `^v${core}\\.${core}\\.${core}(?:-(${identifier}(?:\\.${identifier})*))?$`,
)

export function validateReleaseTag(tag: string, packageVersion: string) {
  const match = releaseTag.exec(tag)
  if (!match || tag.length > 129) {
    throw new Error(`Invalid release tag: ${tag}. Use vMAJOR.MINOR.PATCH[-prerelease].`)
  }
  const version = tag.slice(1)
  if (version !== packageVersion) {
    throw new Error(`Release tag ${tag} does not match package.json version ${packageVersion}.`)
  }
  return { version, prerelease: match[4] !== undefined }
}

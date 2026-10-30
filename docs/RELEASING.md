# Releasing Gotenui

Gotenui publishes a **Docker container** to GitHub Packages (GitHub Container Registry, `ghcr.io`), not an npm package. `package.json` is deliberately marked `private`.

## Create a release

1. Update `package.json`'s `version` to the intended SemVer version, such as `0.1.2` or `0.2.0-rc.1`. Do not reuse an existing release version.
2. Add a Markdown file named `changelogs/v<version>.md`, such as `changelogs/v0.1.2.md`. Follow the existing changelog convention of `## Changes` followed by a bullet list of user-facing changes. **The tag validation fails before CI and container publishing if the matching changelog is missing, empty or contains no description of the changes.** The filename determines the version, so no specific heading is enforced and existing Markdown formatting is preserved in the GitHub Release. Commit the version and changelog together, open a pull request and merge into the default branch after CI passes.
3. On the updated default branch, create and push an annotated tag matching that version exactly:

   ```sh
   git switch main
   git pull --ff-only
   git tag -a v0.1.2 -m 'Gotenui v0.1.2'
   git push origin v0.1.2
   ```

4. The **Release** GitHub Actions workflow verifies the tag, changelog and default-branch ancestry, then calls the existing full CI workflow. **Both quality and Gotenberg Docker integration jobs must pass** before publishing begins.
5. After CI, Actions publishes a multi-platform Docker image (`linux/amd64` and `linux/arm64`) to GHCR, then creates an **unpublished draft GitHub Release**. The release body comes from `changelogs/v<version>.md`, followed by the immutable image digest. No automatically generated notes are added. If the image publish fails, no draft release is created.
6. Review and edit the draft release in GitHub's **Releases** page, then select **Publish release** when ready. The GHCR image is already pushed at step 5 and may be available to users with package access before the GitHub Release is published.

Use `vMAJOR.MINOR.PATCH` for stable releases, or `vMAJOR.MINOR.PATCH-rc.1` (or similar SemVer prerelease identifiers) for prereleases. Build metadata (`+something`) is not supported in release tags because Docker tag names cannot contain `+`. Prereleases remain marked as prereleases after you publish the draft.

## Resulting image tags

Replace `OWNER/REPO` with the GitHub repository's owner and name (lowercase):

| Git tag       | GHCR tags                                     | GitHub Release draft                |
| ------------- | --------------------------------------------- | ----------------------------------- |
| `v0.1.2`      | `ghcr.io/owner/repo:0.1.2`, `:0.1`, `:latest` | Stable                              |
| `v0.2.0-rc.1` | `ghcr.io/owner/repo:0.2.0-rc.1`               | Prerelease (does not move `latest`) |

Use the versioned tag in production, or pin the `sha256:` digest recorded in the GitHub Release draft for an immutable deployment. `:latest` and minor-version aliases are mutable and should not be used when repeatable deployments are required.

Example:

```sh
docker pull ghcr.io/owner/repo:0.1.2
```

A published Gotenui image contains the web application **only**. It still needs a reachable Gotenberg backend. Gotenui's `PUBLIC_` defaults are compiled into the published image (the workflow uses Dockerfile defaults); if you need different browser defaults, build a custom image with the required build arguments instead of setting them only at runtime. See [Deployment](DEPLOYMENT.md) for the backend allowlist and runtime configuration.

## Repository setup and permissions

- GitHub Actions must be enabled, and repository rulesets should restrict creation and modification of `v*` tags to authorised maintainers. Tags must point to a commit already merged into the default branch.
- Publishing uses the built-in `GITHUB_TOKEN` with `packages: write`; creating the GitHub Release uses `contents: write`. No personal access token or third-party registry credentials are needed for a newly linked package.
- GHCR packages are **private by default**. To allow public pulls, change the package's visibility in GitHub Packages settings. For an existing unlinked GHCR package with the same name, grant this repository access under the package's **Manage Actions access** settings.
- Re-running a release workflow may repush the same image tags. Do not move or reuse Git release tags; protect them with a repository ruleset. An existing GitHub Release, including a manually edited draft, is left unchanged on a rerun.

## GHCR architecture labels

GitHub Packages may display an `unknown/unknown` entry in addition to `linux/amd64` and `linux/arm64`. This entry contains BuildKit's build provenance and SBOM attestations, not a third runnable image. See [Docker's attestation storage documentation](https://docs.docker.com/build/metadata/attestations/attestation-storage/) for how these entries are represented. The release workflow deliberately retains `provenance: mode=max` and `sbom: true` for build transparency. Disabling both would hide the extra entry but remove that metadata.

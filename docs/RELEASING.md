# Releasing Gotenui

Gotenui publishes a **Docker container** to GitHub Packages (GitHub Container Registry, `ghcr.io`), not an npm package. `package.json` is deliberately marked `private`.

## Create a release

1. Update `package.json`'s `version` to the intended SemVer version, such as `0.1.1` or `0.2.0-rc.1`. Commit this change, open a pull request and merge it into the default branch after CI passes. Do not reuse an existing release version.
2. On the updated default branch, create and push an annotated tag matching that version exactly:

   ```sh
   git switch main
   git pull --ff-only
   git tag -a v0.1.1 -m 'Gotenui v0.1.1'
   git push origin v0.1.1
   ```

3. The **Release** GitHub Actions workflow checks that the tag matches `package.json` and that its commit belongs to the default branch, then calls the existing full CI workflow. **Both quality and Gotenberg Docker integration jobs must pass** before publishing begins.
4. After CI, Actions publishes a multi-platform Docker image (`linux/amd64` and `linux/arm64`) to GHCR, then publishes a GitHub Release with generated release notes and the immutable image digest. If the image publish fails, no GitHub Release is created.

Use `vMAJOR.MINOR.PATCH` for stable releases, or `vMAJOR.MINOR.PATCH-rc.1` (or similar SemVer prerelease identifiers) for prereleases. Build metadata (`+something`) is not supported in release tags because Docker tag names cannot contain `+`.

## Resulting image tags

Replace `OWNER/REPO` with the GitHub repository's owner and name (lowercase):

| Git tag       | GHCR tags                                     | GitHub Release                      |
| ------------- | --------------------------------------------- | ----------------------------------- |
| `v0.1.1`      | `ghcr.io/owner/repo:0.1.1`, `:0.1`, `:latest` | Stable                              |
| `v0.2.0-rc.1` | `ghcr.io/owner/repo:0.2.0-rc.1`               | Prerelease (does not move `latest`) |

Use the versioned tag in production, or pin the `sha256:` digest recorded in the GitHub Release for an immutable deployment. `:latest` and minor-version aliases are mutable and should not be used when repeatable deployments are required.

Example:

```sh
docker pull ghcr.io/owner/repo:0.1.1
```

A published Gotenui image contains the web application **only**. It still needs a reachable Gotenberg backend. Gotenui's `PUBLIC_` defaults are compiled into the published image (the workflow uses Dockerfile defaults); if you need different browser defaults, build a custom image with the required build arguments instead of setting them only at runtime. See [Deployment](DEPLOYMENT.md) for the backend allowlist and runtime configuration.

## Repository setup and permissions

- GitHub Actions must be enabled, and repository rulesets should restrict creation and modification of `v*` tags to authorised maintainers. Tags must point to a commit already merged into the default branch.
- Publishing uses the built-in `GITHUB_TOKEN` with `packages: write`; creating the GitHub Release uses `contents: write`. No personal access token or third-party registry credentials are needed for a newly linked package.
- GHCR packages are **private by default**. To allow public pulls, change the package's visibility in GitHub Packages settings. For an existing unlinked GHCR package with the same name, grant this repository access under the package's **Manage Actions access** settings.
- Re-running a release workflow may repush the same image tags. Do not move or reuse Git release tags; protect them with a repository ruleset. An existing GitHub Release is left unchanged on a rerun.

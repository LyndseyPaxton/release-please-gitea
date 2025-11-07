# Gitea Release Planning

The Gitea integration now includes a `GiteaReleasePlanner` that mirrors the
core release-please workflow without relying on GitHub-specific APIs. The
planner uses the `GiteaClient` to inspect commit history, calculate semantic
version bumps, build changelog entries, and prepare file updates that can be
committed to a release branch before opening a pull request.

## High-level flow

1. Read the repository metadata to determine the default branch and HTML URL.
2. Fetch the latest tag (if one exists) to establish the current release
   version and to stop parsing commits once the tag's commit is encountered.
3. List commits from the default branch and parse them as Conventional Commits.
4. Determine the next semantic version using the default versioning strategy.
5. Generate a changelog entry with the same templates used by release-please.
6. Fetch and update `CHANGELOG.md`, returning the new file content ready to be
   pushed to a release branch.
7. Produce a release pull request title and body that follow the standard
   release-please conventions.

The planner focuses on delivering a vertical slice for Gitea users. It can be
extended to drive additional updaters or to customise branch names, tags, and
changelog behaviour through the exposed `ReleasePlanOptions`.

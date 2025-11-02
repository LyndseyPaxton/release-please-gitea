# Kick-off Prompt for Gitea-Compatible Release Automation

You are an experienced TypeScript developer adapting the `release-please` GitHub Action into a Gitea-compatible automation. The existing codebase lives in `release-please-gitea` (forked from `googleapis/release-please`) and already handles semantic versioning, changelog generation, and release PR workflows by parsing Conventional Commit history.

## Goals

1. Implement an action (or CLI wrapper) that works against the Gitea API while preserving release-please’s core behaviors:
   - Inspect commit history for Conventional Commits to derive SemVer bumps and release notes.
   - Maintain continuously updated "release PRs" that stage version/changelog updates until merged.
   - Upon merge, update changelog files, bump version metadata, and prepare the tag/release data expected by downstream tooling.
2. Remove or isolate GitHub-only features so the resulting action is lean and focused on Gitea compatibility.
3. Provide clear configuration and documentation for Gitea users (e.g., repository tokens, API endpoints, default branch detection).

## Deliverables

- Refactored TypeScript modules in `src/` encapsulating Gitea-specific API clients while reusing existing commit parsing and changelog generation logic where possible.
- Automated tests mirroring current coverage to ensure semantic versioning and changelog output remain consistent.
- Documentation updates (e.g., README sections or new docs page) describing how to configure and run the Gitea-compatible action, including required permissions and workflow examples.

## Constraints

- Preserve the Conventional Commits parsing rules and release PR semantics already described in the project documentation.
- Favor small, composable modules to keep the Gitea integration maintainable.
- Write code in TypeScript, matching the project’s existing tooling (tsconfig, lint, tests).

## Getting Started

1. Audit `src/` to identify GitHub-specific integrations; design a Gitea service layer that mirrors the needed API calls (listing commits, opening PRs, updating files, tagging releases).
2. Sketch integration tests that mock the Gitea API surface you’ll rely on.
3. Draft documentation explaining setup in a Gitea instance (self-hosted or cloud) and how to trigger releases automatically.

Focus on delivering a minimal, end-to-end vertical slice first (detect commits → compute version → open release PR) before broadening support to advanced features.

# Using release-please-gitea in a Gitea Actions workflow

The bundled Gitea action wraps the release planner so you do not need to wire up
scripts manually. It installs the dependencies it needs, computes the next
semantic version and changelog entry from Conventional Commits, updates the
repository checkout, and opens (or updates) a release pull request against your
chosen branch.

## Prerequisites

- Gitea 1.19+ with [Actions](https://docs.gitea.com/usage/actions/overview)
  enabled and a runner registered for your instance.
- A personal access token stored as a secret (for example `GITEA_TOKEN`) with
  permission to read repository metadata, push branches, and open pull
  requests.
- Node.js 18 or newer available on the runner.

## Step 1 – Reference the bundled action

Add the action to your workflow. Pass the PAT via the `token` input and, if
you're running on a self-hosted instance, provide the server URL. This example
mirrors the common GitHub usage and exposes the computed release outputs for
follow-up jobs:

```yaml
name: release-please

on:
  push:
    branches:
      - main
      - release/**

jobs:
  release-please:
    runs-on: docker
    outputs:
      release_version: ${{ steps.release-please-gitea.outputs.version }}
      tag_name: ${{ steps.release-please-gitea.outputs.tag }}
      major: ${{ steps.release-please-gitea.outputs.major }}
      minor: ${{ steps.release-please-gitea.outputs.minor }}
      patch: ${{ steps.release-please-gitea.outputs.patch }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Run release-please-gitea
        id: release-please-gitea
        uses: LyndseyPaxton/release-please-gitea@v0
        with:
          token: "${{ secrets.GITEA_TOKEN }}"
          server-url: https://gitea.example.com
```

The action honours optional inputs to customise components, tag formatting, and
changelog behaviour. See [`action.yml`](../action.yml) for the complete list of
supported inputs.

Action outputs you can reference in downstream steps include:

- `skipped` / `reason` – indicate when no release PR was needed.
- `version`, `major`, `minor`, `patch` – semantic version computed from commits.
- `tag` – tag that will be created when the release PR merges.
- `head-branch` – release branch used for the PR.
- `pull-request-title`, `pull-request-body`, `pull-request-url`,
  `pull-request-number` – details for the release PR that was opened (or
  detected).

## Step 2 – Full workflow example

A full workflow typically installs dependencies for your project (if required)
and then runs the action to maintain the release PR. Save the file below as
`.gitea/workflows/release-please.yml`:

```yaml
name: release-please

on:
  push:
    branches:
      - main

env:
  GITEA_SERVER_URL: https://gitea.example.com
  GITEA_REPOSITORY_OWNER: "${{ gitea.repository_owner }}"
  GITEA_REPOSITORY_NAME: "${{ gitea.repository_name }}"
  GITEA_REF_NAME: "${{ gitea.ref_name }}"

jobs:
  release-pr:
    runs-on: docker
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Use Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install dependencies
        run: npm ci
      - name: Build project
        run: npm run build --if-present
      - name: Plan release PR
        uses: LyndseyPaxton/release-please-gitea@v0
        with:
          token: "${{ secrets.GITEA_TOKEN }}"
          server-url: https://gitea.example.com
          git-author-name: release-please[bot]
          git-author-email: release-please@example.com
```

Behind the scenes the action compiles `release-please`, applies the planner's
file updates to the checked-out repository, creates or refreshes the release
branch, pushes it back to the origin remote, and opens a pull request with the
calculated version and changelog. If no Conventional Commits are found, it
exposes a `skipped=true` output so you can gate subsequent steps. Use the
recorded outputs to trigger follow-up automation (for example, building release
artifacts only when a new version is proposed).【F:src/gitea/action.ts†L241-L314】

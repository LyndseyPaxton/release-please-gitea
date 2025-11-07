# Using release-please-gitea in a Gitea Actions workflow

The new Gitea client and release planner let you recreate release-please's
semantic versioning and changelog automation inside a self-hosted Gitea
instance. The example below shows how to turn a push to `main` into an updated
release branch and pull request by wiring the exported `GiteaClient` and
`GiteaReleasePlanner` into a workflow job.

## Prerequisites

- Gitea 1.19+ with [Actions](https://docs.gitea.com/usage/actions/overview)
  enabled and a runner registered for your instance.
- A personal access token stored as a secret (for example `GITEA_TOKEN`) with
  permission to read repository metadata, push branches, and open pull
  requests.
- Node.js 18 or newer available on the runner.

## Step 1 – Add a release planning script

Create `scripts/gitea-release-plan.mjs` in your repository. The script uses the
exported `GiteaClient` and `GiteaReleasePlanner` to calculate the next release
plan, writes the updated files to the working tree, commits them, and finally
opens (or updates) a pull request.

```js
#!/usr/bin/env node
import {promises as fs} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import process from 'node:process';
import {GiteaClient, GiteaReleasePlanner} from 'release-please/build/src/gitea/index.js';

const exec = promisify(execFile);

async function main() {
  const owner = process.env.GITEA_REPOSITORY_OWNER;
  const repo = process.env.GITEA_REPOSITORY_NAME;
  const token = process.env.GITEA_TOKEN;
  const serverUrl = process.env.GITEA_SERVER_URL ?? 'https://gitea.example.com';
  const defaultBranch = process.env.GITEA_REF_NAME ?? 'main';

  if (!owner || !repo || !token) {
    throw new Error('Missing required repository context or token environment variables.');
  }

  const client = await GiteaClient.create({
    owner,
    repo,
    token,
    baseUrl: `${serverUrl.replace(/\/$/, '')}/api/v1/`,
    defaultBranch,
  });
  const planner = new GiteaReleasePlanner(client);
  const plan = await planner.buildReleasePlan({targetBranch: defaultBranch});

  // Apply planned file updates to the local checkout so we can create a commit.
  for (const update of plan.updates) {
    const filePath = path.join(process.cwd(), update.path);
    const content = Buffer.from(update.content, 'base64').toString('utf8');
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, content, 'utf8');
    await exec('git', ['add', update.path]);
  }

  // Create or update the release branch with the generated commit.
  await exec('git', ['config', 'user.name', process.env.GIT_AUTHOR_NAME ?? 'release-please']);
  await exec('git', ['config', 'user.email', process.env.GIT_AUTHOR_EMAIL ?? 'release-please@example.com']);
  await exec('git', ['checkout', '-B', plan.headBranchName]);
  try {
    await exec('git', ['commit', '-m', plan.pullRequestTitle]);
  } catch (err) {
    if (err?.code === 1) {
      console.log('No release changes detected; skipping PR creation.');
      return;
    }
    throw err;
  }
  await exec('git', [
    'push',
    '--force-with-lease',
    'origin',
    `${plan.headBranchName}:${plan.headBranchName}`,
  ]);

  await client.createPullRequest({
    title: plan.pullRequestTitle,
    body: plan.pullRequestBody,
    head: plan.headBranchName,
    base: defaultBranch,
  });
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
```

The planner exposes the semantic version, changelog entry, PR title, PR body,
and base64-encoded file updates computed from Conventional Commits
(`GiteaReleasePlanner.buildReleasePlan`).【F:src/gitea/release-plan.ts†L39-L145】【F:src/gitea/release-plan.ts†L276-L308】

## Step 2 – Define the workflow

Save the workflow at `.gitea/workflows/release-please.yml` so it runs when
changes land on your default branch.

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
      - name: Build release-please
        run: npm run compile
      - name: Plan release PR
        env:
          GITEA_TOKEN: "${{ secrets.GITEA_TOKEN }}"
          GIT_AUTHOR_NAME: release-please[bot]
          GIT_AUTHOR_EMAIL: release-please@example.com
        run: node scripts/gitea-release-plan.mjs
```

The build step (`npm run compile`) emits the compiled modules that the script
imports from `build/src/gitea`.【F:package.json†L9-L24】 Ensure your runner has the
`GITEA_TOKEN` secret with push and PR permissions. The workflow uses the default
branch name (`main`) but you can adjust the trigger and `targetBranch` in the
script for monorepos or release branches.

## Step 3 – Customize as needed

- Pass extra `ReleasePlanOptions` when calling `buildReleasePlan` to control tag
  prefixes, changelog sections, or initial versions (`component`,
  `includeVInTag`, etc.).【F:src/gitea/release-plan.ts†L43-L87】
- Use the planned metadata (`plan.version`, `plan.currentTag`) to create a tag
  or release using `client.createTag` / `client.createRelease` after the pull
  request merges. The client exposes wrappers around the REST endpoints so you
  do not need to hand-roll fetch calls.【F:src/gitea/client.ts†L188-L322】
- Swap out the checkout/commit steps if you prefer using the Gitea REST API to
  update files directly (`GiteaClient.updateFile`) instead of invoking `git`
  commands.【F:src/gitea/client.ts†L229-L274】

With these pieces in place your Gitea instance will continuously stage release
pull requests based on Conventional Commits, mirroring the core release-please
experience.

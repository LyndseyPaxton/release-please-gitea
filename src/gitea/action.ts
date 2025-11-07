// Copyright 2024
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import path from 'node:path';
import process from 'node:process';
import {promises as fs} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

import {GiteaClient, GiteaReleasePlanner, ReleasePlanOptions} from './index';
import {GiteaAPIError} from './errors';

const exec = promisify(execFile);

const DEFAULT_SERVER_URL = 'https://gitea.com';

interface RepositoryContext {
  readonly owner: string;
  readonly repo: string;
}

interface ActionInputs {
  readonly token: string;
  readonly serverUrl: string;
  readonly repository: RepositoryContext;
  readonly defaultBranch?: string;
  readonly targetBranch?: string;
  readonly component?: string;
  readonly includeComponentInTag?: boolean;
  readonly includeVInTag?: boolean;
  readonly tagSeparator?: string;
  readonly pullRequestTitlePattern?: string;
  readonly pullRequestHeader?: string;
  readonly pullRequestFooter?: string;
  readonly changelogPath?: string;
  readonly changelogHost?: string;
  readonly initialVersion?: string;
  readonly bumpMinorPreMajor?: boolean;
  readonly bumpPatchForMinorPreMajor?: boolean;
  readonly gitAuthorName?: string;
  readonly gitAuthorEmail?: string;
  readonly pushRemote: string;
}

function readInput(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = `INPUT_${name.replace(/ /g, '_').replace(/-/g, '_').toUpperCase()}`;
  const value = env[key];
  if (value && value.trim() !== '') {
    return value.trim();
  }
  return undefined;
}

function readBooleanInput(
  name: string,
  env: NodeJS.ProcessEnv = process.env
): boolean | undefined {
  const raw = readInput(name, env);
  if (raw === undefined) {
    return undefined;
  }
  if (/^(true|1)$/i.test(raw)) {
    return true;
  }
  if (/^(false|0)$/i.test(raw)) {
    return false;
  }
  throw new Error(`Invalid boolean value for input ${name}: ${raw}`);
}

function parseRepository(value: string): RepositoryContext {
  const segments = value.split('/');
  if (segments.length !== 2 || !segments[0] || !segments[1]) {
    throw new Error(`Invalid repository input: ${value}`);
  }
  return {owner: segments[0], repo: segments[1]};
}

function resolveRepository(env: NodeJS.ProcessEnv = process.env): RepositoryContext {
  const repoInput = readInput('repository', env);
  if (repoInput) {
    return parseRepository(repoInput);
  }
  const owner = env.GITEA_REPOSITORY_OWNER ?? env.GITHUB_REPOSITORY_OWNER;
  const repo = env.GITEA_REPOSITORY_NAME ?? env.GITHUB_REPOSITORY_NAME;
  if (owner && repo) {
    return {owner, repo};
  }
  const combined = env.GITEA_REPOSITORY ?? env.GITHUB_REPOSITORY;
  if (combined) {
    return parseRepository(combined);
  }
  throw new Error('Repository context is not available. Provide the repository input.');
}

export function normalizeApiBaseUrl(serverUrl: string): string {
  const trimmed = serverUrl.trim().replace(/\/+$/, '');
  if (trimmed === '') {
    throw new Error('Server URL cannot be empty.');
  }
  if (/\/api\/v\d+(\/.*)?$/i.test(trimmed)) {
    return `${trimmed}/`;
  }
  if (/\/api$/i.test(trimmed)) {
    return `${trimmed}/v1/`;
  }
  return `${trimmed}/api/v1/`;
}

async function appendOutput(name: string, value: string): Promise<void> {
  const filePath = process.env.GITHUB_OUTPUT;
  const line = `${name}=${value.replace(/\r?\n/g, '%0A')}`;
  if (filePath) {
    await fs.appendFile(filePath, `${line}\n`);
  } else {
    console.log(`::set-output name=${name}::${value}`);
  }
}

function resolveActionInputs(env: NodeJS.ProcessEnv = process.env): ActionInputs {
  const token = readInput('token', env) ?? env.GITEA_TOKEN;
  if (!token) {
    throw new Error('A token input or GITEA_TOKEN environment variable is required.');
  }
  const serverUrl = readInput('server-url', env) ?? env.GITEA_SERVER_URL ?? DEFAULT_SERVER_URL;
  const repository = resolveRepository(env);
  const defaultBranch = readInput('default-branch', env) ?? env.GITEA_REF_NAME ?? env.GITHUB_REF_NAME;
  const targetBranch = readInput('target-branch', env);
  const component = readInput('component', env);
  const includeComponentInTag = readBooleanInput('include-component-in-tag', env);
  const includeVInTag = readBooleanInput('include-v-in-tag', env);
  const tagSeparator = readInput('tag-separator', env);
  const pullRequestTitlePattern = readInput('pull-request-title-pattern', env);
  const pullRequestHeader = readInput('pull-request-header', env);
  const pullRequestFooter = readInput('pull-request-footer', env);
  const changelogPath = readInput('changelog-path', env);
  const changelogHost = readInput('changelog-host', env);
  const initialVersion = readInput('initial-version', env);
  const bumpMinorPreMajor = readBooleanInput('bump-minor-pre-major', env);
  const bumpPatchForMinorPreMajor = readBooleanInput('bump-patch-for-minor-pre-major', env);
  const gitAuthorName = readInput('git-author-name', env) ?? env.GIT_AUTHOR_NAME;
  const gitAuthorEmail = readInput('git-author-email', env) ?? env.GIT_AUTHOR_EMAIL;
  const pushRemote = readInput('push-remote', env) ?? 'origin';

  return {
    token,
    serverUrl,
    repository,
    defaultBranch,
    targetBranch,
    component,
    includeComponentInTag,
    includeVInTag,
    tagSeparator,
    pullRequestTitlePattern,
    pullRequestHeader,
    pullRequestFooter,
    changelogPath,
    changelogHost,
    initialVersion,
    bumpMinorPreMajor,
    bumpPatchForMinorPreMajor,
    gitAuthorName,
    gitAuthorEmail,
    pushRemote,
  };
}

async function runGit(args: string[], cwd: string): Promise<{stdout: string; stderr: string}> {
  const {stdout, stderr} = await exec('git', args, {cwd});
  return {stdout: stdout ?? '', stderr: stderr ?? ''};
}

async function ensureGitIdentity(
  cwd: string,
  name: string | undefined,
  email: string | undefined
): Promise<void> {
  const resolvedName = name ?? 'release-please[bot]';
  const resolvedEmail = email ?? 'release-please@example.com';
  await runGit(['config', 'user.name', resolvedName], cwd);
  await runGit(['config', 'user.email', resolvedEmail], cwd);
}

async function applyPlannedUpdates(
  cwd: string,
  updates: {path: string; content: string}[]
): Promise<void> {
  for (const update of updates) {
    const filePath = path.join(cwd, update.path);
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    const decoded = Buffer.from(update.content, 'base64');
    await fs.writeFile(filePath, decoded);
    await runGit(['add', update.path], cwd);
  }
}

async function hasWorkingTreeChanges(cwd: string): Promise<boolean> {
  const {stdout} = await runGit(['status', '--porcelain'], cwd);
  return stdout.trim().length > 0;
}

function buildReleaseOptions(inputs: ActionInputs, targetBranch?: string): ReleasePlanOptions {
  return {
    ...(targetBranch ? {targetBranch} : {}),
    ...(inputs.component ? {component: inputs.component} : {}),
    ...(inputs.includeComponentInTag !== undefined
      ? {includeComponentInTag: inputs.includeComponentInTag}
      : {}),
    ...(inputs.includeVInTag !== undefined ? {includeVInTag: inputs.includeVInTag} : {}),
    ...(inputs.tagSeparator ? {tagSeparator: inputs.tagSeparator} : {}),
    ...(inputs.pullRequestTitlePattern
      ? {pullRequestTitlePattern: inputs.pullRequestTitlePattern}
      : {}),
    ...(inputs.pullRequestHeader ? {pullRequestHeader: inputs.pullRequestHeader} : {}),
    ...(inputs.pullRequestFooter ? {pullRequestFooter: inputs.pullRequestFooter} : {}),
    ...(inputs.changelogPath ? {changelogPath: inputs.changelogPath} : {}),
    ...(inputs.changelogHost ? {changelogHost: inputs.changelogHost} : {}),
    ...(inputs.initialVersion ? {initialVersion: inputs.initialVersion} : {}),
    ...(inputs.bumpMinorPreMajor !== undefined
      ? {bumpMinorPreMajor: inputs.bumpMinorPreMajor}
      : {}),
    ...(inputs.bumpPatchForMinorPreMajor !== undefined
      ? {bumpPatchForMinorPreMajor: inputs.bumpPatchForMinorPreMajor}
      : {}),
  };
}

async function runAction(): Promise<void> {
  const inputs = resolveActionInputs();
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const apiBaseUrl = normalizeApiBaseUrl(inputs.serverUrl);

  const client = await GiteaClient.create({
    owner: inputs.repository.owner,
    repo: inputs.repository.repo,
    token: inputs.token,
    baseUrl: apiBaseUrl,
    defaultBranch: inputs.defaultBranch,
  });

  const targetBranch = inputs.targetBranch ?? client.repository.defaultBranch;
  const releasePlanner = new GiteaReleasePlanner(client);
  const plan = await releasePlanner.buildReleasePlan(
    buildReleaseOptions(inputs, targetBranch)
  );

  console.log(`Planning release ${plan.currentTag} from ${targetBranch}`);

  await ensureGitIdentity(workspace, inputs.gitAuthorName, inputs.gitAuthorEmail);

  await applyPlannedUpdates(workspace, plan.updates);

  if (!(await hasWorkingTreeChanges(workspace))) {
    console.log('No release changes detected; skipping pull request creation.');
    await appendOutput('skipped', 'true');
    await appendOutput('reason', 'no_changes');
    return;
  }

  await runGit(['checkout', '-B', plan.headBranchName], workspace);
  await runGit(['commit', '-m', plan.pullRequestTitle], workspace);
  await runGit(
    ['push', '--force-with-lease', inputs.pushRemote, `${plan.headBranchName}:${plan.headBranchName}`],
    workspace
  );

  let pullRequestUrl: string | undefined;
  let pullRequestNumber: number | undefined;

  try {
    const pr = await client.createPullRequest({
      title: plan.pullRequestTitle,
      body: plan.pullRequestBody,
      head: plan.headBranchName,
      base: targetBranch,
    });
    pullRequestUrl = pr.htmlUrl;
    pullRequestNumber = pr.number;
    console.log(`Opened pull request #${pr.number}: ${pr.htmlUrl}`);
  } catch (err) {
    if (err instanceof GiteaAPIError && err.status === 409) {
      console.log('A pull request already exists for this branch; skipping creation.');
    } else {
      throw err;
    }
  }

  await appendOutput('skipped', 'false');
  await appendOutput('version', plan.version.toString());
  await appendOutput('tag', plan.currentTag);
  await appendOutput('head-branch', plan.headBranchName);
  await appendOutput('pull-request-title', plan.pullRequestTitle);
  await appendOutput('pull-request-body', plan.pullRequestBody);
  if (pullRequestUrl) {
    await appendOutput('pull-request-url', pullRequestUrl);
  }
  if (pullRequestNumber !== undefined) {
    await appendOutput('pull-request-number', pullRequestNumber.toString());
  }
}

if (require.main === module) {
  runAction().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}


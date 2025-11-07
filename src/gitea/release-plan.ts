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

import {GiteaClient} from './client';
import {Logger, logger as defaultLogger} from '../util/logger';
import {ConventionalCommit, Commit, parseConventionalCommits} from '../commit';
import {DefaultVersioningStrategy} from '../versioning-strategies/default';
import {Version} from '../version';
import {TagName} from '../util/tag-name';
import {DefaultChangelogNotes} from '../changelog-notes/default';
import {ChangelogSection} from '../changelog-notes';
import {Changelog} from '../updaters/changelog';
import {PullRequestTitle} from '../util/pull-request-title';
import {PullRequestBody} from '../util/pull-request-body';
import {BranchName} from '../util/branch-name';
import {GiteaTagSummary} from './types';

export interface ReleasePlanOptions {
  readonly targetBranch?: string;
  readonly component?: string;
  readonly includeComponentInTag?: boolean;
  readonly includeVInTag?: boolean;
  readonly tagSeparator?: string;
  readonly bumpMinorPreMajor?: boolean;
  readonly bumpPatchForMinorPreMajor?: boolean;
  readonly changelogPath?: string;
  readonly changelogHost?: string;
  readonly changelogSections?: ChangelogSection[];
  readonly pullRequestTitlePattern?: string;
  readonly pullRequestHeader?: string;
  readonly pullRequestFooter?: string;
  readonly initialVersion?: string;
}

export interface PlannedFileUpdate {
  readonly path: string;
  readonly content: string;
  readonly sha?: string;
  readonly message: string;
}

export interface ReleasePlan {
  readonly version: Version;
  readonly previousTag?: string;
  readonly currentTag: string;
  readonly changelogEntry: string;
  readonly pullRequestTitle: string;
  readonly pullRequestBody: string;
  readonly headBranchName: string;
  readonly updates: PlannedFileUpdate[];
  readonly commits: ConventionalCommit[];
}

interface PlannedTagContext {
  readonly previousTag?: {
    readonly tag: TagName;
    readonly commitSha?: string;
    readonly rawName: string;
  };
  readonly component?: string;
  readonly includeV: boolean;
  readonly separator?: string;
}

export class GiteaReleasePlanner {
  private readonly client: GiteaClient;
  private readonly logger: Logger;

  constructor(client: GiteaClient, logger: Logger = defaultLogger) {
    this.client = client;
    this.logger = logger;
  }

  async buildReleasePlan(options: ReleasePlanOptions = {}): Promise<ReleasePlan> {
    const targetBranch = options.targetBranch ?? this.client.repository.defaultBranch;
    const tagContext = await this.resolveTagContext(options);
    const commits = await this.fetchConventionalCommits(targetBranch, tagContext);

    if (commits.length === 0) {
      throw new Error('No conventional commits found to generate a release plan.');
    }

    const currentVersion = tagContext.previousTag
      ? tagContext.previousTag.tag.version
      : Version.parse(options.initialVersion ?? '0.0.0');
    const versioningStrategy = new DefaultVersioningStrategy({
      bumpMinorPreMajor: options.bumpMinorPreMajor,
      bumpPatchForMinorPreMajor: options.bumpPatchForMinorPreMajor,
      logger: this.logger,
    });
    const nextVersion = versioningStrategy.bump(currentVersion, commits);

    const pullRequestTitle = PullRequestTitle.ofTargetBranchVersion(
      targetBranch,
      nextVersion,
      options.pullRequestTitlePattern
    ).toString();

    const nextTag = this.buildNextTag(nextVersion, tagContext);

    const changelogEntry = await this.buildChangelogEntry(
      commits,
      tagContext,
      nextTag,
      targetBranch,
      options
    );

    const updates = await this.buildFileUpdates(
      changelogEntry,
      nextVersion,
      targetBranch,
      options,
      pullRequestTitle
    );

    const pullRequestBody = new PullRequestBody(
      [
        {
          version: nextVersion,
          notes: changelogEntry,
        },
      ],
      {
        header: options.pullRequestHeader,
        footer: options.pullRequestFooter,
        useComponents: false,
      }
    ).toString();

    const headBranchName = (options.component
      ? BranchName.ofComponentTargetBranch(options.component, targetBranch)
      : BranchName.ofTargetBranch(targetBranch)
    ).toString();

    return {
      version: nextVersion,
      previousTag: tagContext.previousTag?.tag.toString(),
      currentTag: nextTag.toString(),
      changelogEntry,
      pullRequestTitle,
      pullRequestBody,
      headBranchName,
      updates,
      commits,
    };
  }

  private async resolveTagContext(
    options: ReleasePlanOptions
  ): Promise<PlannedTagContext> {
    const tags = await this.client.listTags({limit: 1});
    const previousTag = this.extractPreviousTag(tags, options);
    return {
      previousTag,
      component:
        options.includeComponentInTag === false
          ? undefined
          : options.component ?? previousTag?.tag.component,
      includeV: options.includeVInTag ?? previousTag?.tag.includeV ?? true,
      separator: options.tagSeparator ?? previousTag?.tag.separator,
    };
  }

  private extractPreviousTag(
    tags: GiteaTagSummary[],
    options: ReleasePlanOptions
  ): PlannedTagContext['previousTag'] {
    if (tags.length === 0) {
      this.logger.info('No existing tags found; treating release as initial.');
      return undefined;
    }
    const parsed = TagName.parse(tags[0].name);
    if (!parsed) {
      this.logger.warn(`Unable to parse latest tag: ${tags[0].name}`);
      return undefined;
    }
    if (options.component && parsed.component && parsed.component !== options.component) {
      this.logger.debug(
        `Latest tag ${tags[0].name} does not belong to component ${options.component}`
      );
      return undefined;
    }
    return {
      tag: parsed,
      commitSha: tags[0].commit?.sha,
      rawName: tags[0].name,
    };
  }

  private buildNextTag(
    nextVersion: Version,
    context: PlannedTagContext
  ): TagName {
    return new TagName(
      nextVersion,
      context.component,
      context.separator,
      context.includeV
    );
  }

  private async fetchConventionalCommits(
    targetBranch: string,
    tagContext: PlannedTagContext
  ): Promise<ConventionalCommit[]> {
    const commitResponse = await this.client.listCommits({
      sha: targetBranch,
      limit: 100,
    });
    const commits: Commit[] = [];
    for (const commit of commitResponse) {
      if (
        tagContext.previousTag?.commitSha &&
        commit.sha === tagContext.previousTag.commitSha
      ) {
        break;
      }
      commits.push({
        sha: commit.sha,
        message: commit.message,
      });
    }
    return parseConventionalCommits(commits, this.logger);
  }

  private async buildChangelogEntry(
    commits: ConventionalCommit[],
    tagContext: PlannedTagContext,
    nextTag: TagName,
    targetBranch: string,
    options: ReleasePlanOptions
  ): Promise<string> {
    const notesBuilder = new DefaultChangelogNotes();
    const host = this.resolveChangelogHost(options);
    return notesBuilder.buildNotes(commits, {
      host,
      owner: this.client.repository.owner,
      repository: this.client.repository.repo,
      version: nextTag.version.toString(),
      previousTag: tagContext.previousTag?.tag.toString(),
      currentTag: nextTag.toString(),
      targetBranch,
      changelogSections: options.changelogSections,
    });
  }

  private resolveChangelogHost(options: ReleasePlanOptions): string | undefined {
    if (options.changelogHost) {
      return options.changelogHost;
    }
    const metadata = this.client.repositoryMetadata;
    if (!metadata?.htmlUrl) {
      return undefined;
    }
    try {
      const url = new URL(metadata.htmlUrl);
      return `${url.protocol}//${url.host}`;
    } catch (e) {
      this.logger.debug('Failed to derive changelog host from repository URL', e);
      return undefined;
    }
  }

  private async buildFileUpdates(
    changelogEntry: string,
    nextVersion: Version,
    targetBranch: string,
    options: ReleasePlanOptions,
    pullRequestTitle: string
  ): Promise<PlannedFileUpdate[]> {
    const changelogPath = options.changelogPath ?? 'CHANGELOG.md';
    const existingChangelog = await this.client.getFileContents({
      filePath: changelogPath,
      ref: targetBranch,
    });
    const changelogUpdater = new Changelog({
      version: nextVersion,
      changelogEntry,
    });
    const encoding =
      existingChangelog?.encoding && Buffer.isEncoding(existingChangelog.encoding)
        ? existingChangelog.encoding
        : 'base64';
    const existingContent = existingChangelog
      ? Buffer.from(existingChangelog.content, encoding).toString('utf8')
      : undefined;
    const updatedContent = changelogUpdater.updateContent(existingContent);
    const encodedContent = Buffer.from(updatedContent, 'utf8').toString('base64');
    const commitMessage = pullRequestTitle;

    return [
      {
        path: changelogPath,
        content: encodedContent,
        sha: existingChangelog?.sha,
        message: commitMessage,
      },
    ];
  }
}

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

import {Repository} from '../repository';

export interface GiteaRepository extends Repository {
  readonly id: number;
  readonly private: boolean;
  readonly fullName: string;
  readonly description?: string;
  readonly htmlUrl: string;
}

export interface GiteaUser {
  readonly id: number;
  readonly login: string;
  readonly email?: string;
  readonly fullName?: string;
}

export interface GiteaCommit {
  readonly sha: string;
  readonly url: string;
  readonly htmlUrl: string;
  readonly message: string;
  readonly author: GiteaUser | undefined;
  readonly committer: GiteaUser | undefined;
  readonly parents: {sha: string}[];
}

export interface ListCommitsOptions {
  readonly sha?: string;
  readonly since?: string;
  readonly until?: string;
  readonly page?: number;
  readonly limit?: number;
}

export interface CreatePullRequestOptions {
  readonly title: string;
  readonly body: string;
  readonly head: string;
  readonly base: string;
  readonly draft?: boolean;
}

export interface GiteaPullRequest {
  readonly number: number;
  readonly htmlUrl: string;
  readonly state: 'open' | 'closed' | 'merged';
  readonly title: string;
  readonly body: string;
  readonly head: {ref: string};
  readonly base: {ref: string};
}

export interface UpdateFileOptions {
  readonly filePath: string;
  readonly content: string;
  readonly branch?: string;
  readonly message: string;
  readonly sha?: string;
  readonly author?: {
    readonly name: string;
    readonly email: string;
  };
  readonly committer?: {
    readonly name: string;
    readonly email: string;
  };
}

export interface UpsertFileResponse {
  readonly content: {
    readonly sha: string;
    readonly path: string;
    readonly htmlUrl: string;
  };
}

export interface CreateTagOptions {
  readonly tagName: string;
  readonly target: string;
  readonly message?: string;
}

export interface GiteaTag {
  readonly name: string;
  readonly id: string;
  readonly target: string;
}

export interface ListTagsOptions {
  readonly page?: number;
  readonly limit?: number;
}

export interface GiteaTagSummary {
  readonly name: string;
  readonly id: string;
  readonly commit: {sha: string};
}

export interface GetFileContentsOptions {
  readonly filePath: string;
  readonly ref?: string;
}

export interface GiteaFileContent {
  readonly sha: string;
  readonly path: string;
  readonly content: string;
  readonly encoding: 'base64' | string;
}

export interface CreateReleaseOptions {
  readonly tagName: string;
  readonly targetCommitish?: string;
  readonly name: string;
  readonly body?: string;
  readonly draft?: boolean;
  readonly prerelease?: boolean;
}

export interface GiteaRelease {
  readonly id: number;
  readonly tagName: string;
  readonly name: string;
  readonly body?: string;
  readonly htmlUrl: string;
  readonly targetCommitish: string;
  readonly draft: boolean;
  readonly prerelease: boolean;
}

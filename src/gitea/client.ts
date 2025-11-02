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

import {Logger} from 'code-suggester/build/src/types';
import {Repository} from '../repository';
import {
  CreatePullRequestOptions,
  CreateReleaseOptions,
  CreateTagOptions,
  GetFileContentsOptions,
  GiteaCommit,
  GiteaFileContent,
  GiteaPullRequest,
  GiteaRelease,
  GiteaRepository,
  GiteaTag,
  GiteaTagSummary,
  ListCommitsOptions,
  ListTagsOptions,
  UpdateFileOptions,
  UpsertFileResponse,
} from './types';
import {GiteaAPIError, GiteaErrorBody} from './errors';

export interface GiteaClientOptions {
  readonly owner: string;
  readonly repo: string;
  readonly token: string;
  readonly baseUrl?: string;
  readonly defaultBranch?: string;
  readonly fetch?: typeof fetch;
  readonly logger?: Logger;
}

interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly query?: Record<string, string | number | boolean | undefined>;
  readonly headers?: Record<string, string>;
}

const DEFAULT_GITEA_BASE_URL = 'https://gitea.com/api/v1/';

function normalizeBaseUrl(baseUrl: string): string {
  if (!baseUrl.endsWith('/')) {
    return `${baseUrl}/`;
  }
  return baseUrl;
}

function resolveFetch(fetchImpl?: typeof fetch): typeof fetch {
  const implementation = fetchImpl ?? globalThis.fetch;
  if (!implementation) {
    throw new Error(
      'Fetch API is not available. Provide a custom implementation via options.fetch.'
    );
  }
  return implementation;
}

function parseRepositoryResponse(
  response: any,
  owner: string,
  repo: string
): GiteaRepository {
  return {
    id: response.id,
    owner,
    repo,
    defaultBranch: response.default_branch ?? 'main',
    private: Boolean(response.private),
    fullName: response.full_name ?? `${owner}/${repo}`,
    description: response.description ?? undefined,
    htmlUrl: response.html_url ?? response.website ?? '',
  };
}

export class GiteaClient {
  readonly repository: Repository;
  private readonly owner: string;
  private readonly repo: string;
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger?: Logger;
  private repoMetadata?: GiteaRepository;

  constructor(options: GiteaClientOptions, repository: Repository) {
    this.repository = repository;
    this.owner = options.owner;
    this.repo = options.repo;
    this.token = options.token;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_GITEA_BASE_URL);
    this.fetchImpl = resolveFetch(options.fetch);
    this.logger = options.logger;
    if ((repository as GiteaRepository).htmlUrl) {
      this.repoMetadata = repository as GiteaRepository;
    }
  }

  static async create(options: GiteaClientOptions): Promise<GiteaClient> {
    const baseRepository: Repository = {
      owner: options.owner,
      repo: options.repo,
      defaultBranch: options.defaultBranch ?? 'main',
    };
    const initialClient = new GiteaClient(options, baseRepository);
    if (options.defaultBranch) {
      return initialClient;
    }
    const repository = await initialClient.getRepository();
    return new GiteaClient(options, repository);
  }

  get repositoryMetadata(): GiteaRepository | undefined {
    return this.repoMetadata;
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>
  ): string {
    const url = new URL(path, this.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const method = options.method ?? 'GET';
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `token ${this.token}`,
      ...options.headers,
    };
    let body: string | undefined;
    if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json';
    }
    this.logger?.debug?.(
      'gitea.request',
      JSON.stringify({method, url, hasBody: Boolean(body)})
    );
    const response: Response = await this.fetchImpl(url, {
      method,
      headers,
      body,
    });
    if (!response.ok) {
      await this.handleError(response, method, url);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    if (!text) {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      return text as unknown as T;
    }
  }

  private async handleError(
    response: Response,
    method: string,
    url: string
  ): Promise<never> {
    let parsedBody: GiteaErrorBody | string | undefined;
    const raw = await response.text();
    if (raw) {
      try {
        parsedBody = JSON.parse(raw) as GiteaErrorBody;
      } catch (_err) {
        parsedBody = raw;
      }
    }
    const message =
      typeof parsedBody === 'string'
        ? parsedBody
        : parsedBody?.message ?? `Request failed with status ${response.status}`;
    throw new GiteaAPIError(message, response.status, method, url, parsedBody);
  }

  async getRepository(): Promise<GiteaRepository> {
    const response = await this.request<any>(
      `repos/${this.owner}/${this.repo}`
    );
    const repository = parseRepositoryResponse(response, this.owner, this.repo);
    this.repoMetadata = repository;
    return repository;
  }

  async listCommits(options: ListCommitsOptions = {}): Promise<GiteaCommit[]> {
    const commits = await this.request<any[]>(
      `repos/${this.owner}/${this.repo}/commits`,
      {query: options as Record<string, string | number | boolean | undefined>}
    );
    return commits.map(commit => ({
      sha: commit.sha,
      url: commit.url,
      htmlUrl: commit.html_url ?? commit.htmlUrl ?? '',
      message: commit.commit?.message ?? commit.message ?? '',
      author: commit.author,
      committer: commit.committer,
      parents: commit.parents ?? [],
    }));
  }

  async listTags(options: ListTagsOptions = {}): Promise<GiteaTagSummary[]> {
    const tags = await this.request<any[]>(
      `repos/${this.owner}/${this.repo}/tags`,
      {query: options as Record<string, string | number | boolean | undefined>}
    );
    return tags.map(tag => ({
      name: tag.name,
      id: tag.id ?? tag.commit?.sha ?? tag.name,
      commit: {
        sha: tag.commit?.sha ?? tag.sha ?? tag.target,
      },
    }));
  }

  async getFileContents(
    options: GetFileContentsOptions
  ): Promise<GiteaFileContent | undefined> {
    const encodedPath = options.filePath
      .split('/')
      .map(segment => encodeURIComponent(segment))
      .join('/');
    try {
      const response = await this.request<any>(
        `repos/${this.owner}/${this.repo}/contents/${encodedPath}`,
        {
          query: options.ref ? {ref: options.ref} : undefined,
          headers: {
            Accept: 'application/vnd.gitea.object',
          },
        }
      );
      return {
        sha: response.sha,
        path: response.path ?? options.filePath,
        content: response.content,
        encoding: response.encoding ?? 'base64',
      };
    } catch (err) {
      if (err instanceof GiteaAPIError && err.status === 404) {
        return undefined;
      }
      throw err;
    }
  }

  async createPullRequest(
    options: CreatePullRequestOptions
  ): Promise<GiteaPullRequest> {
    const response = await this.request<GiteaPullRequest>(
      `repos/${this.owner}/${this.repo}/pulls`,
      {
        method: 'POST',
        body: {
          title: options.title,
          body: options.body,
          head: options.head,
          base: options.base,
          draft: options.draft ?? false,
        },
      }
    );
    return response;
  }

  async updateFile(options: UpdateFileOptions): Promise<UpsertFileResponse> {
    const encodedPath = options.filePath
      .split('/')
      .map(segment => encodeURIComponent(segment))
      .join('/');
    const response = await this.request<UpsertFileResponse>(
      `repos/${this.owner}/${this.repo}/contents/${encodedPath}`,
      {
        method: 'PUT',
        body: {
          content: options.content,
          message: options.message,
          branch: options.branch ?? this.repository.defaultBranch,
          sha: options.sha,
          author: options.author,
          committer: options.committer,
        },
      }
    );
    return response;
  }

  async createTag(options: CreateTagOptions): Promise<GiteaTag> {
    const response = await this.request<GiteaTag>(
      `repos/${this.owner}/${this.repo}/git/tags`,
      {
        method: 'POST',
        body: {
          tag: options.tagName,
          message: options.message ?? options.tagName,
          object: options.target,
          type: 'commit',
        },
      }
    );
    return response;
  }

  async createRelease(options: CreateReleaseOptions): Promise<GiteaRelease> {
    const response = await this.request<GiteaRelease>(
      `repos/${this.owner}/${this.repo}/releases`,
      {
        method: 'POST',
        body: {
          tag_name: options.tagName,
          target_commitish:
            options.targetCommitish ?? this.repository.defaultBranch,
          name: options.name,
          body: options.body,
          draft: options.draft ?? false,
          prerelease: options.prerelease ?? false,
        },
      }
    );
    return response;
  }
}

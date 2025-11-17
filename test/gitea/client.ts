import {afterEach, describe, it} from 'mocha';
import {expect} from 'chai';
import * as nock from 'nock';
import {GiteaClient} from '../../src/gitea';
import {GiteaAPIError} from '../../src/gitea/errors';

const fetch = require('node-fetch');

nock.disableNetConnect();

describe('GiteaClient', () => {
  const baseUrl = 'https://gitea.example/api/v1/';
  const owner = 'octo';
  const repo = 'release-please';

  afterEach(() => {
    nock.cleanAll();
  });

  it('fetches repository metadata when default branch missing', async () => {
    const scope = nock('https://gitea.example')
      .get('/api/v1/repos/octo/release-please')
      .reply(200, {
        id: 123,
        private: false,
        default_branch: 'main',
        full_name: 'octo/release-please',
        html_url: 'https://gitea.example/octo/release-please',
      });

    const client = await GiteaClient.create({
      owner,
      repo,
      token: 'token',
      baseUrl,
      fetch,
    });

    scope.done();
    expect(client.repository.defaultBranch).to.equal('main');
  });

  it('lists commits with provided query parameters', async () => {
    nock('https://gitea.example')
      .get('/api/v1/repos/octo/release-please/commits')
      .query({page: '2', limit: '10'})
      .reply(200, [
        {
          sha: 'abc',
          url: 'https://gitea.example/api/v1/repos/octo/release-please/git/commits/abc',
          html_url: 'https://gitea.example/octo/release-please/commit/abc',
          commit: {message: 'feat: add something'},
          parents: [],
        },
      ]);

    const client = new GiteaClient(
      {
        owner,
        repo,
        token: 'token',
        baseUrl,
        fetch,
      },
      {
        owner,
        repo,
        defaultBranch: 'main',
      }
    );

    const commits = await client.listCommits({page: 2, limit: 10});
    expect(commits).to.have.length(1);
    expect(commits[0].message).to.equal('feat: add something');
  });

  it('lists tags using summary endpoint', async () => {
    nock('https://gitea.example')
      .get('/api/v1/repos/octo/release-please/tags')
      .query({limit: '5'})
      .reply(200, [
        {
          name: 'v1.2.3',
          id: 'refs/tags/v1.2.3',
          commit: {sha: 'abc'},
        },
      ]);

    const client = new GiteaClient(
      {
        owner,
        repo,
        token: 'token',
        baseUrl,
        fetch,
      },
      {
        owner,
        repo,
        defaultBranch: 'main',
      }
    );

    const tags = await client.listTags({limit: 5});
    expect(tags).to.have.length(1);
    expect(tags[0].name).to.equal('v1.2.3');
    expect(tags[0].commit.sha).to.equal('abc');
  });

  it('retrieves file contents and handles missing files', async () => {
    const content = Buffer.from('# Changelog\n').toString('base64');
    nock('https://gitea.example')
      .get('/api/v1/repos/octo/release-please/contents/CHANGELOG.md')
      .query({ref: 'main'})
      .reply(200, {
        sha: 'abc123',
        path: 'CHANGELOG.md',
        content,
        encoding: 'base64',
      });

    const client = new GiteaClient(
      {
        owner,
        repo,
        token: 'token',
        baseUrl,
        fetch,
      },
      {
        owner,
        repo,
        defaultBranch: 'main',
      }
    );

    const file = await client.getFileContents({
      filePath: 'CHANGELOG.md',
      ref: 'main',
    });
    expect(file?.sha).to.equal('abc123');

    nock('https://gitea.example')
      .get('/api/v1/repos/octo/release-please/contents/MISSING.md')
      .query({ref: 'main'})
      .reply(404, {message: 'not found'});

    const missing = await client.getFileContents({
      filePath: 'MISSING.md',
      ref: 'main',
    });
    expect(missing).to.be.undefined;
  });

  it('throws helpful error when request fails', async () => {
    const scope = nock('https://gitea.example')
      .get('/api/v1/repos/octo/release-please')
      .reply(401, {message: 'invalid token'});

    const client = new GiteaClient(
      {
        owner,
        repo,
        token: 'token',
        baseUrl,
        fetch,
      },
      {
        owner,
        repo,
        defaultBranch: 'main',
      }
    );

    let caught: unknown;
    try {
      await client.getRepository();
    } catch (err) {
      caught = err;
    }
    scope.done();
    expect(caught).to.be.instanceOf(GiteaAPIError);
  });
});

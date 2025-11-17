import {afterEach, describe, it} from 'mocha';
import {expect} from 'chai';
import * as nock from 'nock';
import {GiteaClient, GiteaReleasePlanner} from '../../src/gitea';
import {ReleasePlan} from '../../src/gitea/release-plan';

const fetch = require('node-fetch');

nock.disableNetConnect();

describe('GiteaReleasePlanner', () => {
  const baseUrl = 'https://gitea.example/api/v1/';
  const owner = 'octo';
  const repo = 'demo';

  afterEach(() => {
    nock.cleanAll();
  });

  async function createClient(): Promise<GiteaClient> {
    nock('https://gitea.example')
      .get('/api/v1/repos/octo/demo')
      .reply(200, {
        id: 1,
        private: false,
        default_branch: 'main',
        full_name: 'octo/demo',
        html_url: 'https://gitea.example/octo/demo',
      });

    return await GiteaClient.create({
      owner,
      repo,
      token: 'token',
      baseUrl,
      fetch,
    });
  }

  it('builds a release plan from conventional commits', async () => {
    const client = await createClient();

    nock('https://gitea.example')
      .get('/api/v1/repos/octo/demo/tags')
      .query({limit: '1'})
      .reply(200, [
        {
          name: 'v1.2.0',
          id: 'v1.2.0',
          commit: {sha: 'abc123'},
        },
      ]);

    nock('https://gitea.example')
      .get('/api/v1/repos/octo/demo/commits')
      .query({sha: 'main', limit: '100'})
      .reply(200, [
        {
          sha: 'def456',
          url: 'https://gitea.example/api/v1/repos/octo/demo/git/commits/def456',
          commit: {message: 'feat: add new capability'},
          parents: [{sha: 'abc123'}],
        },
        {
          sha: 'abc123',
          url: 'https://gitea.example/api/v1/repos/octo/demo/git/commits/abc123',
          commit: {message: 'chore(main): release 1.2.0'},
          parents: [],
        },
      ]);

    const existingChangelog = Buffer.from(
      '# Changelog\n\n## [1.2.0](https://gitea.example/octo/demo/compare/v1.1.0...v1.2.0)\n\n- Previous release\n'
    ).toString('base64');

    nock('https://gitea.example')
      .get('/api/v1/repos/octo/demo/contents/CHANGELOG.md')
      .query({ref: 'main'})
      .reply(200, {
        sha: 'changelogsha',
        path: 'CHANGELOG.md',
        content: existingChangelog,
        encoding: 'base64',
      });

    const packageJson = Buffer.from(
      JSON.stringify({name: 'demo', version: '1.2.0'}, null, 2)
    ).toString('base64');

    nock('https://gitea.example')
      .get('/api/v1/repos/octo/demo/contents/package.json')
      .query({ref: 'main'})
      .reply(200, {
        sha: 'pkgjsonsha',
        path: 'package.json',
        content: packageJson,
        encoding: 'base64',
      });

    const packageLockJson = Buffer.from(
      JSON.stringify(
        {
          name: 'demo',
          version: '1.2.0',
          lockfileVersion: 2,
          packages: {
            '': {name: 'demo', version: '1.2.0'},
          },
        },
        null,
        2
      )
    ).toString('base64');

    nock('https://gitea.example')
      .get('/api/v1/repos/octo/demo/contents/package-lock.json')
      .query({ref: 'main'})
      .reply(200, {
        sha: 'pkglocksha',
        path: 'package-lock.json',
        content: packageLockJson,
        encoding: 'base64',
      });

    const planner = new GiteaReleasePlanner(client);
    const plan: ReleasePlan = await planner.buildReleasePlan();

    expect(plan.version.toString()).to.equal('1.3.0');
    expect(plan.previousTag).to.equal('v1.2.0');
    expect(plan.currentTag).to.equal('v1.3.0');
    expect(plan.pullRequestTitle).to.equal('chore(main): release 1.3.0');
    expect(plan.headBranchName).to.equal('release-please--branches--main');
    expect(plan.updates).to.have.length(3);
    const changelogUpdate = plan.updates.find(update => update.path === 'CHANGELOG.md');
    expect(changelogUpdate?.sha).to.equal('changelogsha');
    const decodedChangelog = Buffer.from(
      changelogUpdate!.content,
      'base64'
    ).toString('utf8');
    expect(decodedChangelog).to.contain('### Features');
    expect(decodedChangelog).to.contain('add new capability');
    const packageJsonUpdate = plan.updates.find(update => update.path === 'package.json');
    expect(packageJsonUpdate?.sha).to.equal('pkgjsonsha');
    const decodedPackageJson = JSON.parse(
      Buffer.from(packageJsonUpdate!.content, 'base64').toString('utf8')
    );
    expect(decodedPackageJson.version).to.equal('1.3.0');
    const packageLockUpdate = plan.updates.find(
      update => update.path === 'package-lock.json'
    );
    expect(packageLockUpdate?.sha).to.equal('pkglocksha');
    const decodedPackageLock = JSON.parse(
      Buffer.from(packageLockUpdate!.content, 'base64').toString('utf8')
    );
    expect(decodedPackageLock.version).to.equal('1.3.0');
    expect(decodedPackageLock.packages[''].version).to.equal('1.3.0');
    expect(plan.commits.map(commit => commit.sha)).to.deep.equal(['def456']);
  });

  it('handles initial releases when no tags are present', async () => {
    const client = await createClient();

    nock('https://gitea.example')
      .get('/api/v1/repos/octo/demo/tags')
      .query({limit: '1'})
      .reply(200, []);

    nock('https://gitea.example')
      .get('/api/v1/repos/octo/demo/commits')
      .query({sha: 'main', limit: '100'})
      .reply(200, [
        {
          sha: 'def456',
          url: 'https://gitea.example/api/v1/repos/octo/demo/git/commits/def456',
          commit: {message: 'fix: squash bug'},
          parents: [],
        },
      ]);

    nock('https://gitea.example')
      .get('/api/v1/repos/octo/demo/contents/CHANGELOG.md')
      .query({ref: 'main'})
      .reply(404, {message: 'not found'});

    nock('https://gitea.example')
      .get('/api/v1/repos/octo/demo/contents/package.json')
      .query({ref: 'main'})
      .reply(404, {message: 'not found'});

    nock('https://gitea.example')
      .get('/api/v1/repos/octo/demo/contents/package-lock.json')
      .query({ref: 'main'})
      .reply(404, {message: 'not found'});

    const planner = new GiteaReleasePlanner(client);
    const plan = await planner.buildReleasePlan();

    expect(plan.previousTag).to.be.undefined;
    expect(plan.currentTag).to.equal('v0.0.1');
    const changelogUpdate = plan.updates.find(update => update.path === 'CHANGELOG.md');
    expect(changelogUpdate?.sha).to.be.undefined;
    const decodedChangelog = Buffer.from(
      changelogUpdate!.content,
      'base64'
    ).toString('utf8');
    expect(decodedChangelog).to.contain('squash bug');
  });
});

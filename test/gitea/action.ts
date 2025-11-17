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

import {describe, it} from 'mocha';
import {expect} from 'chai';

import {normalizeApiBaseUrl, resolveServerUrl} from '../../src/gitea/action';

describe('gitea action helpers', () => {
  describe('normalizeApiBaseUrl', () => {
    it('appends api path to bare server URLs', () => {
      expect(normalizeApiBaseUrl('https://gitea.example.com')).to.equal(
        'https://gitea.example.com/api/v1/'
      );
    });

    it('preserves URLs that already reference the API root', () => {
      expect(normalizeApiBaseUrl('https://gitea.example.com/api/v1')).to.equal(
        'https://gitea.example.com/api/v1/'
      );
    });

    it('handles trailing slashes', () => {
      expect(normalizeApiBaseUrl('https://gitea.example.com/')).to.equal(
        'https://gitea.example.com/api/v1/'
      );
      expect(normalizeApiBaseUrl('https://gitea.example.com/api/v1/')).to.equal(
        'https://gitea.example.com/api/v1/'
      );
    });

    it('upgrades /api to /api/v1/', () => {
      expect(normalizeApiBaseUrl('https://gitea.example.com/api')).to.equal(
        'https://gitea.example.com/api/v1/'
      );
    });

    it('throws on empty server URLs', () => {
      expect(() => normalizeApiBaseUrl('   ')).to.throw('Server URL cannot be empty.');
    });
  });

  describe('resolveServerUrl', () => {
    it('prefers explicit input when provided', () => {
      const env = {INPUT_SERVER_URL: 'https://gitea.example.org'} as NodeJS.ProcessEnv;
      expect(resolveServerUrl(env)).to.equal('https://gitea.example.org');
    });

    it('falls back to GITEA_SERVER_URL when input is missing', () => {
      const env = {GITEA_SERVER_URL: 'https://gitea.internal'} as NodeJS.ProcessEnv;
      expect(resolveServerUrl(env)).to.equal('https://gitea.internal');
    });

    it('replaces example.com input with GITEA_SERVER_URL when available', () => {
      const env = {
        INPUT_SERVER_URL: 'https://gitea.example.com',
        GITEA_SERVER_URL: 'https://gitea.company.test',
      } as NodeJS.ProcessEnv;
      expect(resolveServerUrl(env)).to.equal('https://gitea.company.test');
    });

    it('uses default when nothing else is provided', () => {
      expect(resolveServerUrl({} as NodeJS.ProcessEnv)).to.equal('https://gitea.com');
    });
  });
});

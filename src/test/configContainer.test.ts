/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { assert } from 'chai';
import { URI } from 'vscode-uri';
import { getCLIHost, loadNativeModule } from '../spec-common/commonUtils';
import { DevContainerConfig, DevContainerFromImageConfig } from '../spec-configuration/configuration';
import { readDevContainerConfigFile } from '../spec-node/configContainer';
import { mergeDevContainerConfigs } from '../spec-node/imageMetadata';
import { Workspace } from '../spec-utils/workspaces';
import { nullLog } from '../spec-utils/log';

const workspace: Workspace = {
	isWorkspaceFile: false,
	workspaceOrFolderPath: '/foo/bar',
	rootFolderPath: '/foo/bar',
	configFolderPath: '/foo/bar',
};

async function readConfig(relativePath: string) {
	const cliHost = await getCLIHost(process.cwd(), loadNativeModule, false);
	const configFile = URI.file(path.resolve(relativePath));
	return readDevContainerConfigFile(cliHost, workspace, configFile, false, false, nullLog);
}

describe('readDevContainerConfigFile', function () {
	it('can read a basic configuration file', async function () {
		const configs = await readConfig('./src/test/configs/example/.devcontainer.json');
		assert.isOk(configs);
		assert.property(configs, 'config');
		assert.isOk(configs?.config.config);

		const features = configs?.config.config.features as Record<string, string | boolean | Record<string, string | boolean>>;
		assert.hasAllKeys(features, ['ghcr.io/devcontainers/features/github-cli:1']);
	});

	it('can resolve an "extends" file reference', async function () {
		const configs = await readConfig('./src/test/configs/extends/.devcontainer.json');
		assert.isOk(configs);
		const expectedConfig = {
			name: 'Overrides',
			image: 'mcr.microsoft.com/devcontainers/base:latest',
			forwardPorts: [80, 443],
			capAdd: ['SYS_PTRACE', 'NET_ADMIN'],
			hostRequirements: {
				cpus: 2,
				memory: `${8 * 2 ** 30}`,
				storage: undefined,
				gpu: undefined,
			},
			remoteEnv: {
				FROM_BASE: 'base',
				OVERRIDE_ME: 'child',
			},
			features: {
				'ghcr.io/devcontainers/features/docker-in-docker:1': {
					version: 'latest',
					moby: true,
				},
				'ghcr.io/devcontainers/features/go:1': {
					version: 'latest',
				},
			},
		};

		assert.deepEqual(configs?.config.raw as any, expectedConfig);
		assert.notProperty(configs?.config.raw as any, 'extends');
	});

	it('can resolve nested "extends" file references', async function () {
		const configs = await readConfig('./src/test/configs/extends/.devcontainer.nested.json');
		assert.isOk(configs);
		assert.strictEqual(configs?.config.raw.name, 'Nested');
		assert.deepEqual(configs?.config.raw.forwardPorts, [80, 443, 2222]);
		assert.strictEqual((configs?.config.raw as DevContainerFromImageConfig).image, 'mcr.microsoft.com/devcontainers/base:latest');
	});

	it('rejects a cyclic "extends" reference', async function () {
		try {
			await readConfig('./src/test/configs/extends/.devcontainer.cycle-a.json');
			assert.fail('expected cyclic extends to throw');
		} catch (err: any) {
			assert.match(String(err.description || err.message), /cyclic "extends" reference/);
		}
	});

	it('can resolve "extends" with extendsMergeMode override', async function () {
		const configs = await readConfig('./src/test/configs/extends/.devcontainer.override.json');
		assert.isOk(configs);
		const raw = configs?.config.raw as DevContainerFromImageConfig;
		assert.strictEqual(raw.name, 'Override merge');
		assert.deepEqual(raw.forwardPorts, [443]);
		assert.strictEqual(raw.init, false);
		assert.strictEqual(raw.hostRequirements?.cpus, 2);
		assert.strictEqual(raw.hostRequirements?.memory, '4gb');
		assert.notProperty(raw as any, 'extends');
		assert.notProperty(raw as any, 'extendsMergeMode');
	});

	it('rejects an invalid "extendsMergeMode" value', async function () {
		const cliHost = await getCLIHost(process.cwd(), loadNativeModule, false);
		const configFile = URI.file(path.resolve('./src/test/configs/extends/.devcontainer.invalid-merge.json'));
		try {
			await readDevContainerConfigFile(cliHost, workspace, configFile, false, false, nullLog);
			assert.fail('expected invalid extendsMergeMode to throw');
		} catch (err: any) {
			assert.match(String(err.description || err.message), /extendsMergeMode.*combine.*override/);
		}
	});

	it('rejects a missing "extends" file', async function () {
		try {
			await readConfig('./src/test/configs/extends/.devcontainer.missing.json');
			assert.fail('expected missing extends to throw');
		} catch (err: any) {
			assert.match(String(err.description || err.message), /was not found/);
		}
	});
});

describe('mergeDevContainerConfigs', function () {
	it('uses image metadata merge logic for overlapping properties', function () {
		const base: DevContainerConfig = {
			image: 'mcr.microsoft.com/devcontainers/base:latest',
			init: false,
			privileged: true,
			forwardPorts: [80],
			hostRequirements: {
				cpus: 4,
				memory: '4gb',
			},
			remoteUser: 'vscode',
			onCreateCommand: 'echo base',
		};
		const overlay: DevContainerConfig = {
			image: 'mcr.microsoft.com/devcontainers/javascript-node:latest',
			init: true,
			forwardPorts: [443],
			hostRequirements: {
				cpus: 2,
				memory: '8gb',
			},
			onCreateCommand: 'echo overlay',
		};

		const merged = mergeDevContainerConfigs(base, overlay);
		assert.strictEqual((merged as DevContainerFromImageConfig).image, 'mcr.microsoft.com/devcontainers/javascript-node:latest');
		assert.strictEqual(merged.init, true);
		assert.strictEqual(merged.privileged, true);
		assert.deepEqual(merged.forwardPorts, [80, 443]);
		assert.strictEqual(merged.hostRequirements?.cpus, 4);
		assert.strictEqual(merged.hostRequirements?.memory, `${8 * 2 ** 30}`);
		assert.strictEqual(merged.remoteUser, 'vscode');
		assert.strictEqual(merged.onCreateCommand, 'echo overlay');
	});

	it('uses override merge when extendsMergeMode is override', function () {
		const base: DevContainerConfig = {
			image: 'mcr.microsoft.com/devcontainers/base:latest',
			init: true,
			privileged: true,
			forwardPorts: [80],
			hostRequirements: {
				cpus: 4,
				memory: '8gb',
				storage: '32gb',
			},
		};
		const overlay: DevContainerConfig = {
			image: 'mcr.microsoft.com/devcontainers/javascript-node:latest',
			init: false,
			forwardPorts: [443],
			hostRequirements: {
				memory: '4gb',
			},
		};

		const merged = mergeDevContainerConfigs(base, overlay, 'override');
		assert.strictEqual(merged.init, false);
		assert.strictEqual(merged.privileged, true);
		assert.deepEqual(merged.forwardPorts, [443]);
		assert.strictEqual(merged.hostRequirements?.cpus, 4);
		assert.strictEqual(merged.hostRequirements?.memory, '4gb');
		assert.strictEqual(merged.hostRequirements?.storage, '32gb');
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';
import { devContainerDown, devContainerUp, shellExec } from './testUtils';

const pkg = require('../../package.json');

describe('Dev Containers CLI extends', function () {
	this.timeout('240s');

	const tmp = path.relative(process.cwd(), path.join(__dirname, 'tmp'));
	const cli = `npx --prefix ${tmp} devcontainer`;
	const testFolder = path.join(__dirname, 'configs/extends-up');
	const overrideTestFolder = path.join(__dirname, 'configs/extends-up-override');

	before('Install packaged CLI', async () => {
		await shellExec(`rm -rf ${tmp}/node_modules`);
		await shellExec(`mkdir -p ${tmp}`);
		await shellExec(`npm --prefix ${tmp} install devcontainers-cli-${pkg.version}.tgz`);
	});

	describe('Command up with extends', () => {
		describe('combine (default extendsMergeMode)', () => {
			let containerId: string | null = null;

			before(async () => {
				const res = await shellExec(
					`${cli} up --workspace-folder ${testFolder} --buildkit=never --include-configuration --include-merged-configuration`,
				);
				const response = JSON.parse(res.stdout);
				assert.equal(response.outcome, 'success');
				containerId = response.containerId;
				assert.ok(containerId, 'Container id not found.');
				assert.equal(response.configuration?.name, 'extends-up-combine');
				assert.equal(response.configuration?.remoteEnv?.FROM_BASE, 'base');
				assert.equal(response.configuration?.remoteEnv?.OVERRIDE_ME, 'child');
				assert.equal(response.configuration?.remoteEnv?.EXTENDS_UP, 'combine');
				assert.notProperty(response.configuration ?? {}, 'extends');
				assert.notProperty(response.configuration ?? {}, 'extendsMergeMode');
			});

			after(async () => await devContainerDown({ containerId }));

			it('starts a container with merged remoteEnv from the extends chain', async () => {
				const env = await shellExec(`docker exec ${containerId} printenv OVERRIDE_ME`);
				assert.equal(env.stdout.trim(), 'child');
				const marker = await shellExec(`docker exec ${containerId} printenv EXTENDS_UP`);
				assert.equal(marker.stdout.trim(), 'combine');
			});
		});

		describe('override (extendsMergeMode)', () => {
			let containerId: string | null = null;

			before(async () => {
				const res = await shellExec(
					`${cli} up --workspace-folder ${overrideTestFolder} --buildkit=never --include-configuration`,
				);
				const response = JSON.parse(res.stdout);
				assert.equal(response.outcome, 'success');
				containerId = response.containerId;
				assert.ok(containerId, 'Container id not found.');
				assert.equal(response.configuration?.name, 'extends-up-override');
				assert.deepEqual(response.configuration?.remoteEnv, {
					OVERRIDE_ME: 'child',
					EXTENDS_UP: 'override',
				});
				assert.deepEqual(response.configuration?.forwardPorts, [9999]);
			});

			after(async () => await devContainerDown({ containerId }));

			it('starts a container using override merge semantics', async () => {
				const env = await shellExec(`docker exec ${containerId} printenv EXTENDS_UP`);
				assert.equal(env.stdout.trim(), 'override');
			});
		});
	});
});

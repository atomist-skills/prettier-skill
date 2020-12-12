/*
 * Copyright © 2020 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { guid } from "@atomist/skill";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import * as assert from "power-assert";

import { updateLintConfiguration } from "../../lib/events/updateToolsOnPush";

describe("updateToolsOnPush", () => {
	describe("updateLintConfiguration", () => {
		it("should add lint-staged config", async () => {
			const content = `{
        "name": "@atomist/test-project",
        "version": "1.0.0",
            "author": "Atomist"
}`;

			const expectedContent = `{
        "name": "@atomist/test-project",
        "version": "1.0.0",
        "author": "Atomist",
        "scripts": {
                "atm:lint:prettier": "prettier --write"
        },
        "husky": {
                "hooks": {
                        "pre-commit": "lint-staged"
                }
        },
        "lint-staged": {
                "**/*": "npm run atm:lint:prettier"
        }
}
`;
			const p = path.join(os.tmpdir(), guid());
			await fs.writeFile(p, content);

			await updateLintConfiguration(
				{
					project: {
						path: () => p,
					},
				} as any,
				{},
			);

			const pj = (await fs.readFile(p)).toString();
			assert.deepStrictEqual(pj, expectedContent);
		});

		it("should update existing lint-staged config", async () => {
			const content = `{
        "name": "@atomist/test-project",
        "version": "1.0.0",
        "author": "Atomist",
        "scripts": {
                "atm:lint:prettier": "prettier --write"
        },
        "husky": {
                "hooks": {
                                "pre-commit": "some over command"
                }
        },
        "lint-staged": {
                        "**/*.ts": "npm run atm:lint:prettier"
        }
}
`;
			const expectedContent = `{
        "name": "@atomist/test-project",
        "version": "1.0.0",
        "author": "Atomist",
        "scripts": {
                "atm:lint:prettier": "prettier --write"
        },
        "husky": {
                "hooks": {
                        "pre-commit": "some over command && lint-staged"
                }
        },
        "lint-staged": {
                "**/*": "npm run atm:lint:prettier"
        }
}
`;
			const p = path.join(os.tmpdir(), guid());
			await fs.writeFile(p, content);

			await updateLintConfiguration(
				{
					project: {
						path: () => p,
					},
				} as any,
				{},
			);

			const pj = (await fs.readFile(p)).toString();
			assert.deepStrictEqual(pj, expectedContent);
		});
	});
});

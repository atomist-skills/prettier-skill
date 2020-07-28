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

import {
	Category,
	LineStyle,
	parameter,
	ParameterType,
	ParameterVisibility,
	resourceProvider,
	skill,
} from "@atomist/skill";
import { LintConfiguration } from "./lib/configuration";

export const Skill = skill<LintConfiguration & { repos: any }>({
	name: "prettier-skill",
	namespace: "atomist",
	displayName: "Prettier",
	author: "Atomist",
	categories: [Category.CodeQuality],
	license: "Apache-2.0",
	homepageUrl: "https://github.com/atomist-skills/prettier-skill",
	repositoryUrl: "https://github.com/atomist-skills/prettier-skill.git",
	iconUrl: "file://docs/images/icon.svg",

	runtime: {
		memory: 2048,
		timeout: 540,
	},

	resourceProviders: {
		github: resourceProvider.gitHub({ minRequired: 1 }),
		chat: resourceProvider.chat({ minRequired: 0 }),
	},

	parameters: {
		glob: {
			type: ParameterType.String,
			displayName: "Files",
			description:
				"File, folder or glob pattern to format (defaults to '.')",
			required: false,
		},
		ignores: {
			type: ParameterType.StringArray,
			displayName: "Ignore pattern",
			description:
				"Pattern of files or folders to ignore during formatting",
			required: false,
		},
		config: {
			type: ParameterType.String,
			displayName: "Configuration",
			description:
				"Prettier configuration in JSON format used if project does not contain own configuration. See the [Prettier documentation](https://prettier.io/docs/en/configuration.html) on how to configure it.",
			lineStyle: LineStyle.Multiple,
			required: false,
		},
		args: {
			type: ParameterType.StringArray,
			displayName: "Extra arguments",
			description:
				"Additional [command line arguments](https://prettier.io/docs/en/cli.html) passed to Prettier",
			required: false,
		},
		modules: {
			type: ParameterType.StringArray,
			displayName: "NPM packages to install",
			description:
				"Use this parameter to configure NPM packages like prettier itself or plugins that should get installed",
			required: false,
		},
		push: parameter.pushStrategy({
			displayName: "Fix problems",
			description:
				"Run Prettier with `--write` option and determine how and when fixes should be committed back into the repository",
			options: [
				{
					text: "Do not apply fixes",
					value: "none",
				},
			],
		}),
		commitMsg: {
			type: ParameterType.String,
			displayName: "Commit message",
			description:
				"Commit message to use when committing Prettier fixes back into the repository",
			placeHolder: "ESLint fixes",
			required: false,
			visibility: ParameterVisibility.Hidden,
		},
		labels: {
			type: ParameterType.StringArray,
			displayName: "Pull request labels",
			description:
				"Add additional labels to pull requests raised by this skill, e.g. to configure the [auto-merge](https://go.atomist.com/catalog/skills/atomist/github-auto-merge-skill) behavior.",
			required: false,
		},
		configure: {
			type: ParameterType.SingleChoice,
			displayName: "Configure repositories",
			description:
				"Update repositories to use the skill's Prettier configuration",
			options: [
				{
					text:
						"Update Prettier config, ignore files and install Git commit hooks",
					value: "prettier_and_hook",
				},
				{
					text: "Update Prettier config and ignore files",
					value: "prettier_only",
				},
				{
					text: "Don't configure Prettier",
					value: "none",
				},
			],
			defaultValue: "none",
			required: false,
		},
		repos: parameter.repoFilter(),
	},

	subscriptions: ["file://graphql/subscription/*.graphql"],
});

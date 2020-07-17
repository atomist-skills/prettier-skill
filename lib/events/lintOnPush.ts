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
	EventContext,
	EventHandler,
	git,
	github,
	project,
	repository,
	runSteps,
	secret,
	Step,
	status,
	childProcess,
} from "@atomist/skill";
import { Severity } from "@atomist/skill-logging";
import * as fs from "fs-extra";
import {
	DefaultLintConfiguration,
	LintConfiguration,
	NpmDevInstallArgs,
	NpmInstallArgs,
} from "../configuration";
import { LintOnPushSubscription } from "../typings/types";

interface LintParameters {
	project: project.Project;
	credential: secret.GitHubCredential | secret.GitHubAppCredential;
	start: string;
	check: github.Check;
}

type LintStep = Step<
	EventContext<LintOnPushSubscription, LintConfiguration>,
	LintParameters
>;

const SetupStep: LintStep = {
	name: "clone repository",
	run: async (ctx, params) => {
		const push = ctx.data.Push[0];
		const repo = push.repo;

		if (push.branch.startsWith("atomist/")) {
			return status.success(`Ignore generated branch`).hidden().abort();
		}

		await ctx.audit.log(`Starting Prettier on ${repo.owner}/${repo.name}`);

		params.credential = await ctx.credential.resolve(
			secret.gitHubAppToken({
				owner: repo.owner,
				repo: repo.name,
				apiUrl: repo.org.provider.apiUrl,
			}),
		);

		params.project = await ctx.project.clone(
			repository.gitHub({
				owner: repo.owner,
				repo: repo.name,
				credential: params.credential,
				branch: push.branch,
				sha: push.after.sha,
			}),
			{ alwaysDeep: false, detachHead: false },
		);
		await ctx.audit.log(
			`Cloned repository ${repo.owner}/${
				repo.name
			} at sha ${push.after.sha.slice(0, 7)}`,
		);

		const includeGlobs = ctx.configuration?.[0]?.parameters?.glob || ".";
		const matchingFiles = await project.globFiles(
			params.project,
			includeGlobs,
			{
				ignore: [".git", "node_modules"],
			},
		);
		if (matchingFiles.length === 0) {
			return status
				.success("Project does not contain any matching files")
				.hidden()
				.abort();
		}

		params.check = await github.createCheck(ctx, params.project.id, {
			sha: push.after.sha,
			name: "prettier-skill",
			title: "Prettier",
			body: `Running \`prettier\``,
		});

		return status.success();
	},
};

const NpmInstallStep: LintStep = {
	name: "npm install",
	runWhen: async (ctx, params) => {
		return fs.pathExists(params.project.path("package.json"));
	},
	run: async (ctx, params) => {
		const opts = { env: { ...process.env, NODE_ENV: "development" } };
		if (await fs.pathExists(params.project.path("package-lock.json"))) {
			await params.project.spawn("npm", ["ci", ...NpmInstallArgs], opts);
		} else {
			await params.project.spawn("npm", ["install", ...NpmInstallArgs], opts);
		}

		const cfg = ctx.configuration[0].parameters;
		if (cfg.modules?.length > 0) {
			await ctx.audit.log("Installing configured npm packages");
			await params.project.spawn(
				"npm",
				["install", ...cfg.modules, ...NpmDevInstallArgs],
				opts,
			);
			await params.project.spawn("git", ["reset", "--hard"], opts);
		}

		return status.success();
	},
};

const ValidateRepositoryStep: LintStep = {
	name: "validate",
	runWhen: async (ctx, params) => {
		return fs.pathExists(params.project.path("package.json"));
	},
	run: async (ctx, params) => {
		const push = ctx.data.Push[0];
		const repo = push.repo;

		if (
			!(await fs.pathExists(
				params.project.path("node_modules", ".bin", "prettier"),
			))
		) {
			return status.failure(
				`No Prettier installed in [${repo.owner}/${repo.name}](${repo.url})`,
			);
		}
		return status.success();
	},
};

const RunEslintStep: LintStep = {
	name: "run prettier",
	run: async (ctx, params) => {
		const push = ctx.data.Push[0];
		const repo = push.repo;
		const cfg: LintConfiguration = {
			...DefaultLintConfiguration,
			...ctx.configuration[0].parameters,
		};

		const args: string[] = [];
		const configFile = params.project.path(
			`prettierrc-${push.after.sha.slice(0, 7)}.json`,
		);
		const ignoreFile = params.project.path(
			`.prettierignore-${push.after.sha.slice(0, 7)}`,
		);
		const filesToDelete = [];

		cfg.args?.forEach(a => args.push(a));

		// Add .prettierignore if missing
		if (
			!(await fs.pathExists(params.project.path(".prettierignore"))) &&
			!!cfg.ignores
		) {
			await fs.writeFile(ignoreFile, `${cfg.ignores.join("\n")}\n`);
			filesToDelete.push(ignoreFile);
			args.push("--ignore-path", ignoreFile);
		}

		// Add .prettierrc.json if missing
		const configs = await project.globFiles(params.project, ".prettierrc*");
		const pj = (await fs.pathExists(params.project.path("package.json")))
			? await fs.readJson(params.project.path("package.json"))
			: {};
		if (configs.length === 0 && !pj.prettier && !!cfg.config) {
			await fs.writeFile(configFile, cfg.config);
			filesToDelete.push(configFile);
			args.push("--config", configFile);
		}

		if (!!cfg.push && cfg.push !== "none") {
			args.push("--write");
		}
		args.push(cfg.glob);

		const argsString = args
			.join(" ")
			.split(`${params.project.path()}/`)
			.join("");
		await ctx.audit.log(`Running Prettier with: $ prettier ${argsString}`);
		const result = await runPrettier(args, ctx, params);

		for (const file of filesToDelete) {
			await fs.remove(file);
		}

		if (result.exitCode === 0) {
			await params.check.update({
				conclusion: "success",
				body: `\`prettier\` found code to be formatted properly

\`$ prettier ${argsString}\``,
			});
			return status.success(
				`Prettier found [${repo.owner}/${repo.name}](${repo.url}) to be formatted properly`,
			);
		} else if (result.exitCode === 1) {
			await params.check.update({
				conclusion: "action_required",
				body: `\`prettier\` found code not to be formatted properly

\`$ prettier ${argsString}\``,
			});

			return status.success(
				`Prettier found [${repo.owner}/${repo.name}](${repo.url}) not to be formatted properly`,
			);
		} else if (result.exitCode === 2) {
			await ctx.audit.log(`Running Prettier errored:`, Severity.Error);
			await ctx.audit.log(result.log, Severity.Error);
			await params.check.update({
				conclusion: "action_required",
				body: `Running \`prettier\` errored

\`$ prettier ${argsString}\`

\`\`\`
${result.log}
\`\`\``,
			});
			return status.failure(`Running Prettier errored`);
		} else {
			await params.check.update({
				conclusion: "action_required",
				body: `Unknown Prettier exit code: \`${result.exitCode}\``,
			});
			return status.failure(`Unknown Prettier exit code`).hidden();
		}
	},
};

async function runPrettier(
	args: string[],
	ctx: EventContext<LintOnPushSubscription, LintConfiguration>,
	params: LintParameters,
): Promise<{ exitCode: number; log: string }> {
	if (await fs.pathExists(params.project.path("package.json"))) {
		// If project is NPM-based we can run prettier through the installed bin
		// This works for project providing their own prettier set up or when we
		// installed the configured packages from the skill configuration.
		// Here we don't default to a prettier version and require it to either
		// come from the package.json or skill configuration.
		const cmd = params.project.path("node_modules", ".bin", "prettier");
		const captureLog = childProcess.captureLog();
		const result = await params.project.spawn(cmd, args, {
			log: captureLog,
			logCommand: false,
		});
		return {
			exitCode: result.status,
			log: captureLog.log.trim(),
		};
	} else {
		// If project does not have a package.json, we can still run prettier through npx
		// by installing all modules as packages to npx and making sure that at least prettier gets installed
		const modules = ctx.configuration?.[0]?.parameters?.modules || [];
		if (
			!modules.some(m => m === "prettier") &&
			!modules.some(m => m.startsWith("prettier@"))
		) {
			modules.push("prettier");
		}
		const captureLog = childProcess.captureLog();
		const result = await params.project.spawn(
			"npx",
			[...modules.map(m => `--package=${m}`), "--quiet", "prettier", ...args],
			{
				log: captureLog,
				logCommand: false,
			},
		);
		return {
			exitCode: result.status,
			log: captureLog.log.trim(),
		};
	}
}

const PushStep: LintStep = {
	name: "push",
	runWhen: async (ctx, params) => {
		const pushCfg = ctx.configuration[0]?.parameters?.push;
		return (
			!!pushCfg &&
			pushCfg !== "none" &&
			!(await git.status(params.project)).isClean
		);
	},
	run: async (ctx, params) => {
		const cfg: LintConfiguration = {
			...DefaultLintConfiguration,
			...ctx.configuration[0].parameters,
		};
		const pushCfg = cfg.push;
		const push = ctx.data.Push[0];
		const repo = push.repo;

		return github.persistChanges(
			ctx,
			params.project,
			pushCfg,
			{
				branch: push.branch,
				defaultBranch: repo.defaultBranch,
				author: {
					login: push.after.author?.login,
					name: push.after.author?.name,
					email: push.after.author?.emails?.[0]?.address,
				},
			},
			{
				branch: `atomist/prettier-${push.branch}`,
				title: "Prettier fixes",
				body: "Prettier format fixes",
				labels: cfg.labels,
			},
			{
				message: cfg.commitMsg,
			},
		);
	},
};

const ClosePrStep: LintStep = {
	name: "close pr",
	runWhen: async (ctx, params) => {
		return (await git.status(params.project)).isClean;
	},
	run: async (ctx, params) => {
		const push = ctx.data.Push[0];
		await github.closePullRequests(
			ctx,
			params.project,
			push.branch,
			`atomist/prettier-${push.branch}`,
			"Closing pull request because code has been properly formatted in base branch",
		);
		return status.success();
	},
};

export const handler: EventHandler<
	LintOnPushSubscription,
	LintConfiguration
> = async ctx =>
	runSteps({
		context: ctx,
		steps: [
			SetupStep,
			NpmInstallStep,
			ValidateRepositoryStep,
			RunEslintStep,
			ClosePrStep,
			PushStep,
		],
	});

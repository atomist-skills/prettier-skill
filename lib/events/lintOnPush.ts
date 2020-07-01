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

import { EventContext, EventHandler, git, github, project, repository, runSteps, secret, Step } from "@atomist/skill";
import { Severity } from "@atomist/skill-logging";
import * as fs from "fs-extra";
import { DefaultLintConfiguration, LintConfiguration } from "../configuration";
import { LintOnPushSubscription } from "../typings/types";

interface LintParameters {
    project: project.Project;
    credential: secret.GitHubCredential | secret.GitHubAppCredential;
    start: string;
    check: github.Check;
}

type LintStep = Step<EventContext<LintOnPushSubscription, LintConfiguration>, LintParameters>;

const SetupStep: LintStep = {
    name: "clone repository",
    run: async (ctx, params) => {
        const push = ctx.data.Push[0];
        const repo = push.repo;

        if (push.branch.startsWith("prettier-")) {
            return {
                code: 1,
                reason: "Don't lint an prettier branch",
                visibility: "hidden",
            };
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
        await ctx.audit.log(`Cloned repository ${repo.owner}/${repo.name} at sha ${push.after.sha.slice(0, 7)}`);

        if (!(await fs.pathExists(params.project.path("package.json")))) {
            return {
                code: 1,
                reason: "Project not an NPM project",
                visibility: "hidden",
            };
        }

        const includeGlobs = ctx.configuration?.[0]?.parameters?.glob || ".";
        const matchingFiles = await project.globFiles(params.project, includeGlobs, {
            ignore: [".git", "node_modules"],
        });
        if (matchingFiles.length === 0) {
            return {
                code: 1,
                reason: "Project does not contain any matching files",
                visibility: "hidden",
            };
        }

        params.check = await github.openCheck(ctx, params.project.id, {
            sha: push.after.sha,
            name: "prettier-skill",
            title: "Prettier",
            body: `Running \`prettier\``,
        });

        return {
            code: 0,
        };
    },
};

const NpmInstallStep: LintStep = {
    name: "npm install",
    run: async (ctx, params) => {
        const opts = { env: { ...process.env, NODE_ENV: "development" } };
        if (await fs.pathExists(params.project.path("package-lock.json"))) {
            await params.project.spawn("npm", ["ci"], opts);
        } else {
            await params.project.spawn("npm", ["install"], opts);
        }

        const cfg = ctx.configuration[0].parameters;
        if (cfg.modules?.length > 0) {
            await ctx.audit.log("Installing configured NPM packages");
            await params.project.spawn("npm", ["install", ...cfg.modules, "--save-dev"], opts);
            await params.project.spawn("git", ["reset", "--hard"], opts);
        }
        return {
            code: 0,
        };
    },
};

const ValidateRepositoryStep: LintStep = {
    name: "validate",
    run: async (ctx, params) => {
        const push = ctx.data.Push[0];
        const repo = push.repo;

        if (!(await fs.pathExists(params.project.path("node_modules", ".bin", "prettier")))) {
            return {
                code: 1,
                visibility: "hidden",
                reason: `No Prettier installed in [${repo.owner}/${repo.name}](${repo.url})`,
            };
        } else {
            return {
                code: 0,
            };
        }
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
        const cmd = params.project.path("node_modules", ".bin", "prettier");
        const args: string[] = [];
        const configFile = params.project.path(`prettierrc-${push.after.sha.slice(0, 7)}.json`);
        const filesToDelete = [];

        cfg.args?.forEach(a => args.push(a));

        // Add .prettierrc.json if missing
        const configs = await project.globFiles(params.project, ".prettierrc*");
        const pj = await fs.readJson(params.project.path("package.json"));
        if (configs.length === 0 && !pj.prettier && !!cfg.config) {
            await fs.writeFile(configFile, cfg.config);
            filesToDelete.push(configFile);
            args.push("--config", configFile);
        }

        if (!!cfg.push && cfg.push !== "none") {
            args.push("--write");
        }
        args.push(cfg.glob);

        const argsString = args.join(" ").split(`${params.project.path()}/`).join("");
        await ctx.audit.log(`Running Prettier with: $ prettier ${argsString}`);
        const lines = [];
        const result = await params.project.spawn(cmd, args, { log: { write: msg => lines.push(msg) } });

        for (const file of filesToDelete) {
            await fs.remove(file);
        }

        if (result.status === 0) {
            await params.check.update({
                conclusion: "success",
                body: `\`prettier\` found code to be formatted properly.

\`$ prettier ${argsString}\``,
            });
            return {
                code: 0,
                reason: `Prettier found [${repo.owner}/${repo.name}](${repo.url}) to be formatted properly`,
            };
        } else if (result.status === 1) {
            await params.check.update({
                conclusion: "action_required",
                body: `\`prettier\` found code not to be formatted properly.

\`$ prettier ${argsString}\``,
            });

            return {
                code: 0,
                reason: `Prettier found [${repo.owner}/${repo.name}](${repo.url}) not to be formatted properly`,
            };
        } else if (result.status === 2) {
            await ctx.audit.log(`Running Prettier failed with configuration or internal error:`, Severity.ERROR);
            await ctx.audit.log(lines.join("\n"), Severity.ERROR);
            await params.check.update({
                conclusion: "action_required",
                body: `Running \`prettier\` failed with a configuration error.

\`$ prettier ${argsString}\`

\`\`\`
${lines.join("\n")}
\`\`\``,
            });
            return {
                code: 1,
                reason: `Running Prettier failed with a configuration error`,
            };
        } else {
            await params.check.update({
                conclusion: "action_required",
                body: `Unknown Prettier exit code: \`${result.status}\``,
            });
            return {
                code: 1,
                visibility: "hidden",
                reason: `Unknown Prettier exit code`,
            };
        }
    },
};

const PushStep: LintStep = {
    name: "push",
    runWhen: async (ctx, params) => {
        const pushCfg = ctx.configuration[0]?.parameters?.push;
        return !!pushCfg && pushCfg !== "none" && !(await git.status(params.project)).isClean;
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
                branch: `prettier-${push.branch}`,
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
            `prettier-${push.branch}`,
            "Closing pull request because code has been properly formatted in base branch",
        );
        return {
            code: 0,
        };
    },
};

export const handler: EventHandler<LintOnPushSubscription, LintConfiguration> = async ctx => {
    return runSteps({
        context: ctx,
        steps: [SetupStep, NpmInstallStep, ValidateRepositoryStep, RunEslintStep, ClosePrStep, PushStep],
    });
};

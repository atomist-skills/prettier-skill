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
    status,
    Step,
} from "@atomist/skill";
import * as fs from "fs-extra";
import { DefaultLintConfiguration, LintConfiguration } from "../configuration";
import { LintOnPushSubscription, UpdateToolsOnPushSubscription } from "../typings/types";
import * as _ from "lodash";

interface UpdateParameters {
    project: project.Project;
    credential: secret.GitHubCredential | secret.GitHubAppCredential;
}

type UpdateStep = Step<EventContext<UpdateToolsOnPushSubscription, LintConfiguration>, UpdateParameters>;

const SetupStep: UpdateStep = {
    name: "clone repository",
    run: async (ctx, params) => {
        const push = ctx.data.Push[0];
        const repo = push.repo;

        if (push.branch !== push.repo.defaultBranch) {
            return status.failure(`Ignore push to non-default branch`).hidden();
        }

        await ctx.audit.log(`Updating prettier configuration on ${repo.owner}/${repo.name}`);

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
            return status.failure("Project is not an npm project").hidden();
        }

        return status.success();
    },
};

const NpmInstallStep: UpdateStep = {
    name: "npm install",
    runWhen: async (ctx, params) => {
        return ctx.configuration?.[0]?.parameters?.modules?.length > 0;
    },
    run: async (ctx, params) => {
        const opts = { env: { ...process.env, NODE_ENV: "development" } };

        const cfg = ctx.configuration[0].parameters;
        await ctx.audit.log("Installing configured NPM packages");
        await params.project.spawn("npm", ["install", ...cfg.modules, "--save-dev"], opts);

        return status.success();
    },
};

const ConfigureEslintStep: UpdateStep = {
    name: "configure prettier",
    run: async (ctx, params) => {
        const cfg: LintConfiguration = {
            ...DefaultLintConfiguration,
            ...ctx.configuration[0].parameters,
        };

        const configFile = params.project.path(`.prettierrc.json`);
        const ignoreFile = params.project.path(`.prettierignore`);

        // Add .prettierignore
        if (cfg.ignores) {
            await fs.writeFile(ignoreFile, cfg.ignores.join("\n"));
        }

        // Add .prettierrc.json
        if (cfg.config) {
            await fs.writeFile(configFile, cfg.config);
        }

        return status.success();
    },
};

const ConfigureHooksStep: UpdateStep = {
    name: "configure hooks",
    runWhen: async (ctx, params) => {
        return ctx.configuration?.[0]?.parameters?.configure === "prettier_and_hook";
    },
    run: async (ctx, params) => {
        const cfg = ctx.configuration[0].parameters;
        const pj = await fs.readJson(params.project.path("package.json"));
        const opts = { env: { ...process.env, NODE_ENV: "development" } };

        // Install husky
        if (!pj.devDependencies?.husky) {
            await params.project.spawn("npm", ["install", "husky", "--save-dev"], opts);
        }
        // Install lint-staged
        if (!pj.devDependencies?.["lint-staged"]) {
            await params.project.spawn("npm", ["install", "lint-staged", "--save-dev"], opts);
        }

        // Add npm script to run prettier
        const script = `atm:lint:prettier`;
        const args = ["--write"];
        cfg.args?.forEach(a => args.push(a));
        _.set(pj, `scripts.${script}`, `prettier ${_.uniq(args)}`);

        // Add husky configuration
        if (!pj.husky?.["pre-commit"]) {
            pj.husky = {
                "pre-commit": "lint-staged",
            };
        } else if (!pj.husky["pre-commit"].includes("lint-staged")) {
            pj.husky["pre-commit"] = `${pj.husky["pre-commit"]} && lint-staged`;
        }

        // Add lint-staged configuration
        const glob = cfg.glob === "." || !cfg.glob ? "**/*" : cfg.glob;
        if (pj["lint-staged"]) {
            pj["lint-staged"][glob] = `npm run ${script}`;
        } else {
            pj["lint-staged"] = { [glob]: `npm run ${script}` };
        }

        await fs.writeJson(params.project.path("package.json"), pj, {
            spaces: 2,
        });

        return status.success();
    },
};

const PushStep: UpdateStep = {
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
        const push = ctx.data.Push[0];
        const repo = push.repo;

        return github.persistChanges(
            ctx,
            params.project,
            "pr_default",
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
                branch: `atomist/prettier-config-${push.branch}`,
                title: "Update prettier configuration",
                body: "Update project's prettier configuration to skill configuration",
                labels: cfg.labels,
            },
            {
                message: `Update prettier project configuration\n\n[atomist:generated]\n[atomist-skill:atomist/prettier-skill]`,
            },
        );
    },
};

const ClosePrStep: UpdateStep = {
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
            `atomist/prettier-config-${push.branch}`,
            "Closing pull request because configuration has been updated in base branch",
        );
        return status.success();
    },
};

export const handler: EventHandler<LintOnPushSubscription, LintConfiguration> = async ctx => {
    return runSteps({
        context: ctx,
        steps: [SetupStep, NpmInstallStep, ConfigureEslintStep, ConfigureHooksStep, ClosePrStep, PushStep],
    });
};

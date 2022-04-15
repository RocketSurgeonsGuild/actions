import { setFailed, getInput } from '@actions/core';
import { getOctokit, context } from '@actions/github';
import { addPullRequestLabel } from './ensure-label';

async function run(): Promise<void> {
    try {
        const { payload, repo } = context;
        const githubToken: string = getInput('github-token', { required: true });
        const github = getOctokit(githubToken, {});

        if (payload.pull_request) {
            const pr = await github.rest.pulls.get({
                ...repo,
                pull_number: payload.pull_request.number,
            });

            if (payload.action === 'opened' || payload.action === 'reopened') {
                await addPullRequestLabel(github, repo, pr.data);
            }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
        setFailed(error.message);
    }
}

run();

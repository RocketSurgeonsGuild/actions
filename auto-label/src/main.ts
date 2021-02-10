import { setFailed, getInput } from '@actions/core';
import { getOctokit, context } from '@actions/github';
import { addPullRequestLabel } from './ensure-label';

async function run(): Promise<void> {
    try {
        const { payload, repo } = context;
        const githubToken: string = getInput('github-token', { required: true });
        const github = getOctokit(githubToken, {});

        if (payload.pull_request) {
            const pr = await github.pulls.get({
                ...repo,
                pull_number: payload.pull_request.number,
            });

            if (payload.action === 'opened' && pr.data.merged) {
                await addPullRequestLabel(github, repo, pr.data);
            } 
        }
    } catch (error) {
        setFailed(error.message);
    }
}

run();

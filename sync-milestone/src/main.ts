import { setFailed, getInput } from '@actions/core';
import { getOctokit, context } from '@actions/github';
import { ensureMilestonesAreCorrect, updatePullRequestMilestone, updatePullRequestLabel } from './ensure-milestone';

async function run(): Promise<void> {
    try {
        const { payload, repo } = context;
        const githubToken: string = getInput('github-token', { required: true });
        const defaultLabel: string = getInput('default-label', { required: true });
        const github = getOctokit(githubToken, {});

        if (payload.pull_request) {
            const pr = await github.pulls.get({
                ...repo,
                pull_number: payload.pull_request.number,
            });

            if (payload.action === 'closed' && pr.data.merged) {
                await updatePullRequestMilestone(github, repo, pr.data).toPromise();
                await updatePullRequestLabel(github, repo, pr.data, defaultLabel);
            } else if (payload.action === 'closed' && !pr.data.merged) {
                await github.issues.update({
                    ...repo,
                    milestone: null,
                    issue_number: pr.data.number,
                });
            } else {
                await updatePullRequestMilestone(github, repo, pr.data).toPromise();
            }
        } else {
            console.log('ensuring milestones are updated');
            await ensureMilestonesAreCorrect(github, repo).toPromise();
        }
    } catch (error) {
        setFailed((error ).message);
    }
}

run();

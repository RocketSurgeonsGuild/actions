import { setFailed, getInput } from '@actions/core';
import { getOctokit } from '@actions/github';
import { ensureMilestonesAreCorrect } from './ensure-milestone';

async function run(): Promise<void> {
    try {
        const githubToken: string = getInput('github-token', { required: true });

        const github = getOctokit(githubToken, {});

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const [owner, repo] = process.env.GITHUB_REPOSITORY!.split('/') as [string, string];

        await ensureMilestonesAreCorrect(github, { owner, repo }).toPromise();
    } catch (error) {
        setFailed(error.message);
    }
}

run();

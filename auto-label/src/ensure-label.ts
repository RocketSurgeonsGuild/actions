/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { getOctokit } from '@actions/github';

type GitHub = ReturnType<typeof getOctokit>;

export async function addPullRequestLabel(
    github: GitHub,
    request: { owner: string; repo: string },
    pr: import('@octokit/types/dist-types/generated/Endpoints').PullsGetResponseData,
) {
    const title = pr.title.split(':')[0].trim();
    const titleLabel = pr.labels.filter(z => z.name.includes(title));
    const hasLabel = titleLabel.length > 0;

    console.log(`label ${hasLabel ? 'found' : 'not found'}`, pr.labels);
    if (hasLabel) return;

    console.log('adding title label', titleLabel);
    await github.issues.addLabels({
        ...request,
        issue_number: pr.number,
        labels: titleLabel.map(z => z.name),
    });
}

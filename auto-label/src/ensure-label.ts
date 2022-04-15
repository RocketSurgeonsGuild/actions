/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { getOctokit } from '@actions/github';

type GitHub = ReturnType<typeof getOctokit>;

export async function addPullRequestLabel(
    github: GitHub,
    request: { owner: string; repo: string },
    pr: Awaited<ReturnType<GitHub['rest']['pulls']['get']>>['data'],
) {
    console.log(`pr title: ${pr.title}`);
    const title = pr.title.split(':')[0].trim();
    var labelsForRepository = await github.rest.issues.listLabelsForRepo({ ...request });
    const titleLabel = labelsForRepository.data.filter(z => z.name.includes(title)).map(x => x.name);
    const hasLabel = titleLabel.length > 0;

    console.log(`label ${hasLabel ? 'found' : 'not found'}`, pr.labels);
    if (!hasLabel) return;

    console.log('adding title label', titleLabel);
    await github.rest.issues.addLabels({
        ...request,
        issue_number: pr.number,
        labels: titleLabel,
    });
}

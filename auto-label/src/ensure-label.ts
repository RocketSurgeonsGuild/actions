/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { getOctokit } from '@actions/github';

type GitHub = ReturnType<typeof getOctokit>;

export async function addPullRequestLabel(
    github: GitHub,
    request: { owner: string; repo: string },
    pr: Awaited<ReturnType<GitHub['rest']['pulls']['get']>>['data'],
    labelMap?: Record<string, string>,
) {
    console.log(`pr title: ${pr.title}`);
    const title = pr.title.split(':')[0].trim();

    let labelsToApply: string[];

    if (labelMap) {
        const mappedLabel = labelMap[title];
        if (!mappedLabel) {
            console.log(`label not found in map for prefix: ${title}`);
            return;
        }
        const repoLabels = await github.rest.issues.listLabelsForRepo({ ...request });
        const exists = repoLabels.data.some(z => z.name === mappedLabel);
        if (!exists) {
            console.log(`mapped label '${mappedLabel}' does not exist in repository`);
            return;
        }
        labelsToApply = [mappedLabel];
    } else {
        const repoLabels = await github.rest.issues.listLabelsForRepo({ ...request });
        labelsToApply = repoLabels.data.filter(z => z.name.includes(title)).map(x => x.name);
        if (labelsToApply.length === 0) {
            console.log('label not found', pr.labels);
            return;
        }
    }

    console.log('adding title label', labelsToApply);
    await github.rest.issues.addLabels({
        ...request,
        issue_number: pr.number,
        labels: labelsToApply,
    });
}

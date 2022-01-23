/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { forkJoin, from, empty, Observable, of } from 'rxjs';
import { mergeMap, toArray, map, filter, expand, tap } from 'rxjs/operators';
import { from as ixFrom, toArray as ixToArray } from 'ix/iterable';
import * as ix from 'ix/iterable/operators';
import { getOctokit } from '@actions/github';

type GitHub = ReturnType<typeof getOctokit>;

export async function addPullRequestLabel(
    github: GitHub,
    request: { owner: string; repo: string },
    pr: import('@octokit/types/dist-types/generated/Endpoints').PullsGetResponseData) {
    console.log(`pr title: ${pr.title}`);
    const title = pr.title.split(':')[0].trim();
    const titleLabel = pr.labels.filter(z => z.name.includes(title)).map(x => x.name);
    const hasLabel = titleLabel.length > 0;

    console.log(`label ${hasLabel ? 'found' : 'not found'}`, pr.labels);
    if (hasLabel) return;

    console.log('adding title label', titleLabel);
    await github.issues.addLabels({
        ...request,
        issue_number: pr.number,
        labels: titleLabel,
    });
}

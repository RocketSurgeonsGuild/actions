/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { forkJoin, from, empty, Observable, of } from 'rxjs';
import { mergeMap, toArray, map, filter, expand, tap } from 'rxjs/operators';
import { getOctokit } from '@actions/github';
import { from as ixFrom, toArray as ixToArray } from 'ix/iterable';
import * as ix from 'ix/iterable/operators';
import { parse, rcompare } from 'semver';

type GitHub = ReturnType<typeof getOctokit>;

export function ensureMilestonesAreCorrect(github: GitHub, request: { owner: string; repo: string }) {
    const milestones = getVersionMilestones(github, request);

    return milestones.pipe(
        mergeMap(milestones => {
            const milestoneRange = ixToArray(ixFrom(milestones).pipe(ix.filter(z => !z.closed_at)));

            const currentPendingMilestone = milestoneRange[0];
            const remainingOpenMilestones = milestoneRange.slice(1);
            console.log('Current Milestone', currentPendingMilestone.title);
            console.log(
                'Old Milestones',
                remainingOpenMilestones.map(z => z.title),
            );
            if (!remainingOpenMilestones.length) return empty();

            const issues = from(remainingOpenMilestones.filter(z => z.open_issues > 0 || z.closed_issues > 0))
                .pipe(
                    mergeMap(milestone =>
                        rxifyRequest(github, github.issues.listForRepo, {
                            ...request,
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            milestone: milestone.number as any,
                            state: 'all',
                        }).pipe(map(issue => ({ issue, milestone }))),
                    ),
                    tap(({ issue, milestone }) => {
                        console.log(`Moving issue '${issue.title}' from ${milestone.title} to ${currentPendingMilestone.title}`);
                    }),
                    // eslint-disable-next-line @typescript-eslint/promise-function-async
                    mergeMap(({ issue }) =>
                        from(
                            github.issues.update({
                                ...request,
                                issue_number: issue.number,
                                milestone: currentPendingMilestone.number,
                            }),
                        ),
                    ),
                    toArray(),
                )
                .toPromise();

            const deleteMilestones = from(remainingOpenMilestones.filter(z => z.open_issues === 0 && z.closed_issues === 0))
                .pipe(
                    mergeMap(milestone => {
                        return from(
                            github.issues.deleteMilestone({
                                ...request,
                                milestone_number: milestone.number,
                            }),
                        );
                    }),
                )
                .toPromise();

            return forkJoin(deleteMilestones, issues).pipe(map(z => z[1]));
        }),
    );
}

export function updatePullRequestMilestone(
    github: GitHub,
    request: { owner: string; repo: string },
    pr: import('@octokit/types/dist-types/generated/Endpoints').PullsGetResponseData,
) {
    const milestone = getVersionMilestones(github, request).pipe(map(z => z[0]));

    return milestone.pipe(
        mergeMap(milestone => {
            console.log(`checking milestone for #${pr.number} - ${pr.title}`);
            if (milestone && (!pr.milestone || (pr.milestone && pr.milestone.title !== milestone.title))) {
                console.log(`need to update milestone on ${pr.title} from ${pr.milestone?.title ?? 'nothing'} to ${milestone.title}`);
                return from(
                    github.issues.update({
                        ...request,
                        milestone: milestone.number,
                        issue_number: pr.number,
                    }),
                ).pipe(mergeMap(() => empty()));
            }
            return empty();
        }),
    );
}

export async function updatePullRequestLabel(
    github: GitHub,
    request: { owner: string; repo: string },
    pr: import('@octokit/types/dist-types/generated/Endpoints').PullsGetResponseData,
    defaultLabel: string,
) {
    const mergeLabel = pr.labels.filter(z => !z.name.includes('merge'));
    const hasLabel = mergeLabel.length > 0;

    console.log(`label ${hasLabel ? 'found' : 'not found'}`, pr.labels);
    if (hasLabel) return;

    console.log('adding default label', defaultLabel);
    await github.issues.addLabels({
        ...request,
        issue_number: pr.number,
        labels: [defaultLabel],
    });
}

function getVersionMilestones(github: GitHub, request: { owner: string; repo: string }) {
    return rxifyRequest(github, github.issues.listMilestones, {
        ...request,
        state: 'open',
    }).pipe(
        map(x => ({ ...x, semver: parse(x.title)! })),
        filter(z => z.semver != null),
        toArray(),
        map(milestones => milestones.sort((a, b) => rcompare(a.semver, b.semver))),
    );
}

type ValueOf<T> = T extends (infer R)[] ? R : T extends Promise<infer R> ? R : T extends Observable<infer R> ? R : T extends Iterator<infer R> ? R : T;

function rxifyRequest<T, R>(
    github: GitHub,
    method: (request: T) => Promise<import('@octokit/types/dist-types/OctokitResponse').OctokitResponse<R>>,
    request: T,
) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (request as any).page;
    return new Observable<ValueOf<R>>(subscriber => {
        return from(method({ ...request }))
            .pipe(
                expand(({ headers }) => {
                    if (headers.link) {
                        const next = getLink(headers.link, 'next');
                        if (next) {
                            return from(
                                github.request({
                                    url: next,
                                }),
                            );
                        }
                    }
                    return empty();
                }),
                mergeMap(results => (Array.isArray(results.data) ? from(results.data) : of(results.data)) as Observable<ValueOf<R>>),
            )
            .subscribe(subscriber);
    });
}

function getLink(value: string, name: string) {
    return (value.match(new RegExp(`<([^>]+)>;\\s*rel="${name}"`)) || [])[1];
}

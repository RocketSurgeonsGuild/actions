/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { forkJoin, from, zip, empty, Observable, of } from 'rxjs';
import { mergeMap, toArray, map, filter, skip, expand } from 'rxjs/operators';
import { differenceBy, slice } from 'lodash-es';
import { getOctokit } from '@actions/github';
import { parse, rcompare } from 'semver';

type GitHub = ReturnType<typeof getOctokit>;

export function ensureMilestonesAreCorrect(github: GitHub, request: { owner: string; repo: string }) {
    const milestones = getVersionMilestones(github, request);
    const versions = getTagVersions(github, request);

    return forkJoin(milestones, versions).pipe(
        mergeMap(([milestones, versions]) => {
            const unlabeledMilestones = differenceBy(milestones, versions, z => z.semver);
            const versionRange = ['refs/heads/master', ...versions.map(z => `refs/tags/${z.name}`)];

            const versionRanges = zip(from(versionRange), from(versionRange).pipe(skip(1))).pipe(
                mergeMap(([head, base]) =>
                    getPullRequestsBetween(github, { ...request, base, head }).pipe(
                        toArray(),
                        map(pullRequests => ({ head, base, pullRequests })),
                    ),
                ),
            );

            return versionRanges.pipe(
                mergeMap(set => {
                    const name = set.head.replace('refs/tags/', '').replace('refs/heads/', '');

                    let milestone = milestones.find(z => z.title === name);
                    if (name === 'master' && unlabeledMilestones.length) {
                        milestone = unlabeledMilestones[0];
                    }

                    if (milestone) {
                        return from(set.pullRequests).pipe(
                            mergeMap(pr => {
                                console.log(`checking milestone for #${pr.id} - ${pr.title}`);
                                if (milestone && pr.milestone && pr.milestone.title !== milestone.title) {
                                    console.log(`need to update milestone on ${pr.title} from ${pr.milestone.title} to ${milestone.title}`);
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

                    return empty();
                }),
            );
        }),
    );
}

function getTagVersions(github: GitHub, request: { owner: string; repo: string }) {
    return rxifyRequest(github, github.repos.listTags, request).pipe(
        map(x => ({ ...x, semver: parse(x.name)! })),
        filter(z => z.semver != null),
        toArray(),
        map(versions => versions.sort((a, b) => rcompare(a.semver, b.semver))),
        map(z => slice(z, 0, 2)),
    );
}

function getVersionMilestones(github: GitHub, request: { owner: string; repo: string }) {
    return rxifyRequest(github, github.issues.listMilestonesForRepo, {
        ...request,
        state: 'all',
    }).pipe(
        map(x => ({ ...x, semver: parse(x.title)! })),
        filter(z => z.semver != null),
        toArray(),
        map(milestones => milestones.sort((a, b) => rcompare(a.semver, b.semver))),
        map(z => slice(z, 0, 3)),
    );
}

function getPullRequestsBetween(
    github: GitHub,
    request: {
        head: string;
        base: string;
        owner: string;
        repo: string;
    },
) {
    const { owner, repo } = request;
    return rxifyRequest(github, github.repos.compareCommits, request).pipe(
        mergeMap(commits =>
            from(commits.commits).pipe(
                mergeMap(
                    commit =>
                        rxifyRequest(github, github.repos.listPullRequestsAssociatedWithCommit, {
                            owner,
                            repo,
                            commit_sha: commit.sha,
                        }),
                    4,
                ),
            ),
        ),
    );
}

type ValueOf<T> = T extends (infer R)[]
    ? R
    : T extends Promise<infer R>
    ? R
    : T extends Observable<infer R>
    ? R
    : T extends Iterator<infer R>
    ? R
    : T;

function rxifyRequest<T, R>(
    github: GitHub,
    method: (request: T) => Promise<import('@octokit/types/dist-types/OctokitResponse').OctokitResponse<R>>,
    request: T,
) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (request as any).page;
    return new Observable<ValueOf<R>>(subscriber => {
        const controller = new AbortController();
        from(method({ ...request, request: { signal: controller.signal } }))
            .pipe(
                expand(({ headers }) => {
                    if (headers.link) {
                        const next = getLink(headers.link, 'next');
                        if (next) {
                            return from(
                                github.request({
                                    url: next,
                                    request: { signal: controller.signal },
                                }),
                            );
                        }
                    }
                    return empty();
                }),
                mergeMap(results => (Array.isArray(results.data) ? from(results.data) : of(results.data)) as Observable<ValueOf<R>>),
            )
            .subscribe(subscriber);
        return () => controller.abort();
    });
}

function getLink(value: string, name: string) {
    return (value.match(new RegExp(`<([^>]+)>;\\s*rel="${name}"`)) || [])[1];
}

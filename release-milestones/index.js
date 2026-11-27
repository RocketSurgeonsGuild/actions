// @ts-check
'use strict';

/**
 * Keeps a repository's version milestones and its draft release in step with what has been merged.
 *
 * One idempotent reconcile, safe to re-run at any time:
 *  - The next version is the latest stable release bumped by the labels of the pull requests merged since it
 *    (semver), or <year>.<month>.<releases this month> (calver). A pending milestone renamed by hand to a higher
 *    version wins, so a release can be forced up.
 *  - The pending milestone carries that version: every merged pull request since the latest release, the issues
 *    those pull requests close, and the open pull requests into the default branch.
 *  - The latest stable release's milestone holds exactly the pull requests between the previous release and it
 *    (plus the issues they close); anything still open moves on to the pending milestone, then it is closed.
 *  - Older milestones that are still open are closed (or deleted when empty) after their open items move on.
 *  - The draft release is named after the pending version and its notes are regenerated on every run.
 *
 * The pull-request mode only puts a single pull request into the pending milestone, so it stays cheap.
 */

const STABLE_VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;

/**
 * @typedef {{ major: number, minor: number, patch: number }} Version
 * @typedef {{
 *   mode: 'pull-request' | 'sync',
 *   defaultLabel: string,
 *   versioning: 'semver' | 'calver',
 *   majorLabels: string[],
 *   minorLabels: string[],
 *   initialVersion: Version,
 *   releaseTag: string,
 *   draftRelease: boolean,
 *   dryRun: boolean,
 *   now: Date,
 * }} Options
 */

/** @param {string | null | undefined} text @returns {Version | undefined} */
function parseVersion(text) {
    const match = STABLE_VERSION.exec((text ?? '').trim());
    if (!match) return undefined;
    return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** @param {Version} a @param {Version} b */
function compareVersions(a, b) {
    return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** @param {Version} version */
function formatVersion(version) {
    return `v${version.major}.${version.minor}.${version.patch}`;
}

/**
 * The bump the merged pull requests ask for: a major label wins over a minor label, which wins over a patch.
 * @param {{ labels: string[] }[]} pullRequests
 * @param {{ majorLabels: string[], minorLabels: string[] }} options
 * @returns {'major' | 'minor' | 'patch'}
 */
function bumpFor(pullRequests, options) {
    let bump = /** @type {'major' | 'minor' | 'patch'} */ ('patch');
    for (const pullRequest of pullRequests) {
        if (pullRequest.labels.some(label => options.majorLabels.includes(label))) return 'major';
        if (pullRequest.labels.some(label => options.minorLabels.includes(label))) bump = 'minor';
    }
    return bump;
}

/**
 * Semver: a breaking change bumps major (minor while the major version is 0), a feature or enhancement bumps minor,
 * anything else bumps patch.
 * @param {Version | undefined} latest
 * @param {{ labels: string[] }[]} pullRequests
 * @param {{ majorLabels: string[], minorLabels: string[], initialVersion: Version }} options
 * @returns {Version}
 */
function nextSemver(latest, pullRequests, options) {
    if (!latest) return options.initialVersion;
    const bump = bumpFor(pullRequests, options);
    if (bump === 'major' && latest.major > 0) return { major: latest.major + 1, minor: 0, patch: 0 };
    if (bump === 'major' || bump === 'minor') return { major: latest.major, minor: latest.minor + 1, patch: 0 };
    return { major: latest.major, minor: latest.minor, patch: latest.patch + 1 };
}

/**
 * Calver: <year>.<month>.<number of this month's tags>, the same count MSBuildSdk's release workflow uses.
 * @param {Date} now
 * @param {string[]} tagNames
 * @returns {Version}
 */
function nextCalver(now, tagNames) {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const count = tagNames.filter(tag => {
        const version = parseVersion(tag);
        return version && version.major === year && version.minor === month;
    }).length;
    return { major: year, minor: month, patch: count };
}

/**
 * The pending version: the computed one, unless a pending milestone was renamed by hand to something higher.
 * @param {Version} computed
 * @param {Version[]} pendingMilestoneVersions open milestones above the latest release
 */
function chooseTarget(computed, pendingMilestoneVersions) {
    return pendingMilestoneVersions.reduce((target, version) => (compareVersions(version, target) > 0 ? version : target), computed);
}

/** @param {string} value */
function splitList(value) {
    return value
        .split(/[,\n]/)
        .map(item => item.trim())
        .filter(Boolean);
}

/** @param {NodeJS.ProcessEnv} env @returns {Options} */
function readOptions(env) {
    const mode = env.RM_MODE === 'pull-request' ? 'pull-request' : 'sync';
    const versioning = env.RM_VERSIONING === 'calver' ? 'calver' : 'semver';
    const initialVersion = parseVersion(env.RM_INITIAL_VERSION || 'v0.1.0');
    if (!initialVersion) throw new Error(`initial-version '${env.RM_INITIAL_VERSION}' is not a version`);
    return {
        mode,
        versioning,
        defaultLabel: env.RM_DEFAULT_LABEL ?? '',
        majorLabels: splitList(env.RM_MAJOR_LABELS ?? ':boom: breaking change'),
        minorLabels: splitList(env.RM_MINOR_LABELS ?? ':rocket: feature,:fire: enhancement'),
        initialVersion,
        releaseTag: (env.RM_RELEASE_TAG ?? '').trim(),
        draftRelease: (env.RM_DRAFT_RELEASE ?? 'true') !== 'false',
        dryRun: env.RM_DRY_RUN === 'true',
        now: new Date(),
    };
}

/**
 * @param {{ github: any, context: any, core: any }} script the actions/github-script globals
 * @param {Options} [options]
 */
async function run({ github, context, core }, options = readOptions(process.env)) {
    const repo = { owner: context.repo.owner, repo: context.repo.repo };
    const fullName = `${repo.owner}/${repo.repo}`;
    const summary = /** @type {string[]} */ ([]);

    /** Logs a change and makes it, unless this is a dry run. @template T @param {string} what @param {() => Promise<T>} change */
    async function act(what, change) {
        summary.push(what);
        core.info(`${options.dryRun ? '[dry-run] ' : ''}${what}`);
        return options.dryRun ? undefined : change();
    }

    const defaultBranch = context.payload.repository?.default_branch ?? (await github.rest.repos.get(repo)).data.default_branch;

    // ---- state ------------------------------------------------------------------------------------------------

    const releases = /** @type {any[]} */ (await github.paginate(github.rest.repos.listReleases, { ...repo, per_page: 100 }));
    const stableReleases = releases
        .filter(release => !release.draft && !release.prerelease)
        .map(release => ({ release, version: parseVersion(release.tag_name) }))
        .filter(/** @returns {entry is { release: any, version: Version }} */ entry => entry.version !== undefined)
        .sort((a, b) => compareVersions(b.version, a.version));
    const latest = stableReleases[0];
    core.info(`Latest stable release: ${latest ? latest.release.tag_name : '(none)'}`);

    /** @type {any[]} */
    let milestones = await github.paginate(github.rest.issues.listMilestones, { ...repo, state: 'all', per_page: 100 });
    const versionOf = (/** @type {any} */ milestone) => parseVersion(milestone.title);
    const isPending = (/** @type {any} */ milestone) => {
        const version = versionOf(milestone);
        return version !== undefined && (!latest || compareVersions(version, latest.version) > 0);
    };
    const findMilestone = (/** @type {string} */ title) => milestones.find(milestone => milestone.title === title);

    /** @param {string} title */
    async function createMilestone(title) {
        const created = await act(`Create milestone ${title}`, async () => {
            try {
                return (await github.rest.issues.createMilestone({ ...repo, title })).data;
            } catch (error) {
                // Another run created it first.
                if (/** @type {any} */ (error).status !== 422) throw error;
                milestones = await github.paginate(github.rest.issues.listMilestones, { ...repo, state: 'all', per_page: 100 });
                const existing = findMilestone(title);
                if (!existing) throw error;
                return existing;
            }
        });
        const milestone = created ?? { number: -milestones.length - 1, title, state: 'open', open_issues: 0, closed_issues: 0 };
        if (!findMilestone(title)) milestones.push(milestone);
        return milestone;
    }

    /** @param {any} milestone @param {Record<string, unknown>} changes @param {string} what */
    async function updateMilestone(milestone, changes, what) {
        await act(what, () => github.rest.issues.updateMilestone({ ...repo, milestone_number: milestone.number, ...changes }));
        Object.assign(milestone, changes);
    }

    /** @param {any} milestone */
    async function listMilestoneItems(milestone) {
        if (milestone.number < 0) return [];
        return /** @type {any[]} */ (
            await github.paginate(github.rest.issues.listForRepo, { ...repo, milestone: String(milestone.number), state: 'all', per_page: 100 })
        );
    }

    /** @param {{ number: number, milestone?: { number: number } | null }} item @param {any} milestone @param {string} why */
    async function setMilestone(item, milestone, why) {
        if ((item.milestone?.number ?? null) === (milestone?.number ?? null)) return;
        await act(`#${item.number} → ${milestone ? milestone.title : '(no milestone)'} (${why})`, () =>
            github.rest.issues.update({ ...repo, issue_number: item.number, milestone: milestone ? milestone.number : null }),
        );
        item.milestone = milestone;
    }

    // ---- merged pull requests -----------------------------------------------------------------------------------

    /**
     * The merged pull requests whose commits are in base...head, with their labels, milestone and the issues they close.
     * @param {string} base @param {string} head @param {boolean} onlyDefaultBranch
     */
    async function mergedPullRequestsBetween(base, head, onlyDefaultBranch) {
        const shas = /** @type {string[]} */ ([]);
        for (let page = 1; ; page++) {
            const { data } = await github.rest.repos.compareCommitsWithBasehead({ ...repo, basehead: `${base}...${head}`, per_page: 100, page });
            shas.push(...data.commits.map((/** @type {any} */ commit) => commit.sha));
            if (data.commits.length < 100 || shas.length >= data.total_commits) break;
        }

        /** @type {Map<number, { number: number, title: string, labels: string[], milestone: any, closes: any[] }>} */
        const pullRequests = new Map();
        for (let index = 0; index < shas.length; index += 40) {
            const batch = shas.slice(index, index + 40);
            const fields = batch
                .map(
                    (sha, i) => `c${i}: object(oid: "${sha}") { ... on Commit { associatedPullRequests(first: 5) { nodes {
                        number title merged baseRefName
                        labels(first: 50) { nodes { name } }
                        milestone { number title }
                        closingIssuesReferences(first: 25) { nodes { number state repository { nameWithOwner } milestone { number title } } }
                    } } } }`,
                )
                .join('\n');
            const result = await github.graphql(`query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`, {
                owner: repo.owner,
                name: repo.repo,
            });
            for (const commit of Object.values(result.repository)) {
                for (const node of /** @type {any} */ (commit)?.associatedPullRequests?.nodes ?? []) {
                    if (!node.merged || (onlyDefaultBranch && node.baseRefName !== defaultBranch) || pullRequests.has(node.number)) continue;
                    pullRequests.set(node.number, {
                        number: node.number,
                        title: node.title,
                        labels: node.labels.nodes.map((/** @type {any} */ label) => label.name),
                        milestone: node.milestone,
                        closes: node.closingIssuesReferences.nodes.filter((/** @type {any} */ issue) => issue.repository.nameWithOwner === fullName),
                    });
                }
            }
        }
        return { commits: shas.length, pullRequests: [...pullRequests.values()] };
    }

    /** Puts merged pull requests, and the issues they close, into a milestone. @param {Awaited<ReturnType<typeof mergedPullRequestsBetween>>['pullRequests']} pullRequests @param {any} milestone */
    async function collectInto(pullRequests, milestone) {
        for (const pullRequest of pullRequests) {
            await setMilestone(pullRequest, milestone, 'merged for this version');
            for (const issue of pullRequest.closes) {
                // Leave issues filed under a non-version milestone (a roadmap, a backlog) alone.
                if (issue.milestone && !versionOf(issue.milestone)) continue;
                await setMilestone(issue, milestone, `closed by #${pullRequest.number}`);
            }
        }
    }

    /** @param {any} pullRequest */
    async function ensureDefaultLabel(pullRequest) {
        if (!options.defaultLabel) return;
        const labels = /** @type {any[]} */ (pullRequest.labels ?? []).map(label => (typeof label === 'string' ? label : label.name));
        if (labels.some(label => !label.includes('merge'))) return;
        await act(`#${pullRequest.number} add label ${options.defaultLabel}`, () =>
            github.rest.issues.addLabels({ ...repo, issue_number: pullRequest.number, labels: [options.defaultLabel] }),
        );
    }

    // ---- pending milestone ----------------------------------------------------------------------------------------

    /** @type {Awaited<ReturnType<typeof mergedPullRequestsBetween>> | undefined} */
    let pendingRange;
    async function getPendingRange() {
        pendingRange ??= latest ? await mergedPullRequestsBetween(latest.release.tag_name, defaultBranch, true) : { commits: 0, pullRequests: [] };
        return pendingRange;
    }

    async function computeTarget() {
        const pendingVersions = milestones
            .filter(milestone => milestone.state === 'open' && isPending(milestone))
            .map(milestone => /** @type {Version} */ (versionOf(milestone)));
        let computed;
        if (options.versioning === 'calver') {
            const tags = /** @type {any[]} */ (await github.paginate(github.rest.git.listMatchingRefs, { ...repo, ref: 'tags/v', per_page: 100 }));
            computed = nextCalver(
                options.now,
                tags.map(tag => tag.ref.replace(/^refs\/tags\//, '')),
            );
        } else {
            computed = nextSemver(latest?.version, (await getPendingRange()).pullRequests, options);
        }
        const target = chooseTarget(computed, pendingVersions);
        core.info(`Next version: ${formatVersion(target)}${compareVersions(target, computed) === 0 ? '' : ` (milestone override; computed ${formatVersion(computed)})`}`);
        return formatVersion(target);
    }

    /** @type {any} */
    let pendingMilestone;
    /** The milestone for the next version: renamed from an older pending milestone when the version moved, created when there is none. */
    async function ensurePendingMilestone() {
        if (pendingMilestone) return pendingMilestone;
        const title = await computeTarget();
        const others = milestones
            .filter(milestone => milestone.state === 'open' && isPending(milestone) && milestone.title !== title)
            .sort((a, b) => compareVersions(/** @type {Version} */ (versionOf(b)), /** @type {Version} */ (versionOf(a))));

        pendingMilestone = findMilestone(title);
        if (pendingMilestone && pendingMilestone.state !== 'open') {
            await updateMilestone(pendingMilestone, { state: 'open' }, `Reopen milestone ${title}: it has not been released`);
        } else if (!pendingMilestone && others.length) {
            pendingMilestone = others.shift();
            await updateMilestone(pendingMilestone, { title }, `Rename milestone ${pendingMilestone.title} → ${title}`);
        } else if (!pendingMilestone) {
            pendingMilestone = await createMilestone(title);
        }

        // Fold any other pending milestones into it.
        for (const other of others) {
            const items = await listMilestoneItems(other);
            for (const item of items) await setMilestone(item, pendingMilestone, `moved from ${other.title}`);
            // Its count can include items the API no longer lists; keep (closed) a milestone that still holds those.
            if (items.length >= (other.open_issues ?? 0) + (other.closed_issues ?? 0)) {
                await act(`Delete milestone ${other.title} (folded into ${title})`, () =>
                    github.rest.issues.deleteMilestone({ ...repo, milestone_number: other.number }),
                );
                milestones = milestones.filter(milestone => milestone !== other);
            } else {
                await updateMilestone(other, { state: 'closed' }, `Close milestone ${other.title} (folded into ${title})`);
            }
        }
        return pendingMilestone;
    }

    // ---- pull-request mode ------------------------------------------------------------------------------------------

    if (options.mode === 'pull-request') {
        const pullRequest = context.payload.pull_request;
        if (!pullRequest) {
            core.info('No pull request in the event payload; nothing to do.');
            return summary;
        }
        if (pullRequest.base.ref !== defaultBranch) {
            core.info(`#${pullRequest.number} targets ${pullRequest.base.ref}, not ${defaultBranch}; leaving its milestone alone.`);
            return summary;
        }
        const current = pullRequest.milestone;
        if (context.payload.action === 'closed' && !pullRequest.merged) {
            if (current && isPending(current)) await setMilestone(pullRequest, null, 'closed without merging');
            return summary;
        }
        if (pullRequest.merged) await ensureDefaultLabel(pullRequest);
        // Already filed under a released version: it shipped there (a re-run of an old event).
        if (pullRequest.merged && current && versionOf(current) && !isPending(current)) return summary;
        // An open pull request filed under a non-version milestone keeps it until it merges.
        if (current && !versionOf(current) && !pullRequest.merged) return summary;
        // Use the pending milestone as it stands; the next sync renames it if this pull request changes the version.
        const pending = milestones
            .filter(milestone => milestone.state === 'open' && isPending(milestone))
            .sort((a, b) => compareVersions(/** @type {Version} */ (versionOf(b)), /** @type {Version} */ (versionOf(a))))[0];
        await setMilestone(pullRequest, pending ?? (await ensurePendingMilestone()), pullRequest.merged ? 'merged' : 'open pull request');
        return summary;
    }

    // ---- sync mode ----------------------------------------------------------------------------------------------------

    /** Makes a released milestone hold exactly what shipped, then closes it. @param {{ release: any, version: Version }} released */
    async function finalize(released) {
        const tag = released.release.tag_name;
        const explicit = options.releaseTag === tag;
        let milestone = findMilestone(tag) ?? milestones.find(candidate => {
            const version = versionOf(candidate);
            return version && compareVersions(version, released.version) === 0;
        });
        if (milestone && milestone.state === 'closed' && !explicit) return;
        core.info(`Finalizing milestone for release ${tag}`);
        milestone ??= await createMilestone(tag);

        const previous = stableReleases.find(entry => compareVersions(entry.version, released.version) < 0);
        if (previous) {
            const shipped = (await mergedPullRequestsBetween(previous.release.tag_name, tag, false)).pullRequests;
            await collectInto(shipped, milestone);
            const shippedNumbers = new Set(shipped.map(pullRequest => pullRequest.number));
            for (const item of await listMilestoneItems(milestone)) {
                if (item.pull_request) {
                    if (item.pull_request.merged_at) {
                        if (!shippedNumbers.has(item.number)) await setMilestone(item, await ensurePendingMilestone(), `merged after ${tag}`);
                    } else if (item.state === 'closed') {
                        await setMilestone(item, null, 'closed without merging');
                    } else {
                        await setMilestone(item, await ensurePendingMilestone(), `still open at ${tag}`);
                    }
                } else if (item.state === 'open') {
                    await setMilestone(item, await ensurePendingMilestone(), `still open at ${tag}`);
                } else if (item.state_reason === 'not_planned') {
                    await setMilestone(item, null, 'closed as not planned');
                }
            }
        } else {
            core.info(`No stable release before ${tag}; only moving its open items on.`);
            for (const item of await listMilestoneItems(milestone)) {
                if (item.state === 'open') await setMilestone(item, await ensurePendingMilestone(), `still open at ${tag}`);
            }
        }
        if (milestone.state !== 'closed') await updateMilestone(milestone, { state: 'closed' }, `Close milestone ${milestone.title}`);
    }

    // 1. The released milestones.
    const toFinalize = [latest, stableReleases.find(entry => entry.release.tag_name === options.releaseTag)].filter(
        (entry, index, all) => entry && all.indexOf(entry) === index,
    );
    for (const released of toFinalize) await finalize(/** @type {{ release: any, version: Version }} */ (released));

    // 2. Older milestones that were never closed.
    if (latest) {
        for (const milestone of milestones.filter(candidate => candidate.state === 'open' && versionOf(candidate) && !isPending(candidate))) {
            const items = await listMilestoneItems(milestone);
            for (const item of items) {
                if (item.state === 'open') await setMilestone(item, await ensurePendingMilestone(), `still open; ${milestone.title} is behind ${latest.release.tag_name}`);
            }
            // The milestone's own count also covers items the API no longer lists (deleted or transferred), so only a
            // milestone that never held a closed item is deleted.
            const remaining = items.filter(item => item.state !== 'open').length;
            if (remaining === 0 && !milestone.closed_issues) {
                await act(`Delete empty milestone ${milestone.title}`, () => github.rest.issues.deleteMilestone({ ...repo, milestone_number: milestone.number }));
                milestones = milestones.filter(candidate => candidate !== milestone);
            } else {
                await updateMilestone(milestone, { state: 'closed' }, `Close milestone ${milestone.title} (behind ${latest.release.tag_name})`);
            }
        }
    }

    // 3. The pending milestone: what has merged since the latest release, and the open pull requests.
    const range = await getPendingRange();
    const openPullRequests = /** @type {any[]} */ (await github.paginate(github.rest.pulls.list, { ...repo, state: 'open', base: defaultBranch, per_page: 100 }));
    const hasPendingMilestone = milestones.some(milestone => milestone.state === 'open' && isPending(milestone));
    if (range.commits > 0 || openPullRequests.length > 0 || hasPendingMilestone || !latest) {
        const pending = await ensurePendingMilestone();
        await collectInto(range.pullRequests, pending);
        for (const pullRequest of range.pullRequests) await ensureDefaultLabel(pullRequest);
        for (const pullRequest of openPullRequests) {
            if (pullRequest.milestone && !versionOf(pullRequest.milestone)) continue;
            await setMilestone(pullRequest, pending, 'open pull request');
        }
    } else {
        core.info('Nothing merged since the latest release and no open pull requests; no pending milestone needed.');
    }

    // 4. The draft release for the pending version, with freshly generated notes. Drafts for versions that already
    //    shipped are deleted; with nothing merged since the latest release, a pending draft waits for the next merge.
    if (options.draftRelease) {
        const wanted = range.commits > 0 || !latest;
        const title = wanted ? (await ensurePendingMilestone()).title : undefined;
        const drafts = releases.filter(release => release.draft);
        /** @type {any} */
        let draft = title ? drafts.find(release => release.tag_name === title) : undefined;
        for (const candidate of drafts) {
            if (candidate === draft) continue;
            const version = parseVersion(candidate.tag_name);
            if (!version) {
                core.warning(`Leaving draft release '${candidate.name || candidate.tag_name}' alone: its tag is not a version.`);
                continue;
            }
            const pending = !latest || compareVersions(version, latest.version) > 0;
            if (pending && !wanted) continue;
            if (pending && !draft) {
                draft = candidate;
                continue;
            }
            await act(`Delete ${pending ? 'duplicate' : 'stale'} draft release ${candidate.tag_name}`, () =>
                github.rest.repos.deleteRelease({ ...repo, release_id: candidate.id }),
            );
        }

        if (title) {
            const notes = (
                await github.rest.repos.generateReleaseNotes({
                    ...repo,
                    tag_name: title,
                    target_commitish: defaultBranch,
                    ...(latest ? { previous_tag_name: latest.release.tag_name } : {}),
                })
            ).data;
            const release = { tag_name: title, name: title, body: notes.body, target_commitish: defaultBranch, draft: true };
            if (draft) {
                await act(`Update draft release ${draft.tag_name}${draft.tag_name === title ? '' : ` → ${title}`} with regenerated notes`, () =>
                    github.rest.repos.updateRelease({ ...repo, release_id: draft.id, ...release }),
                );
            } else {
                await act(`Create draft release ${title}`, () => github.rest.repos.createRelease({ ...repo, ...release }));
            }
        }
    }

    await core.summary
        .addHeading('Release milestones', 3)
        .addList(summary.length ? summary : ['Nothing to change.'])
        .write()
        .catch(() => undefined);
    return summary;
}

module.exports = run;
module.exports.run = run;
module.exports.parseVersion = parseVersion;
module.exports.compareVersions = compareVersions;
module.exports.formatVersion = formatVersion;
module.exports.bumpFor = bumpFor;
module.exports.nextSemver = nextSemver;
module.exports.nextCalver = nextCalver;
module.exports.chooseTarget = chooseTarget;
module.exports.readOptions = readOptions;

# Release Milestones

Keeps a repository's version milestones and its draft release in step with what has merged. It replaces `sync-milestone`
and the GitVersion/GitReleaseManager steps the old `update-milestone`, `draft-release` and `close-milestone` workflows ran,
so those workflows no longer install .NET.

Repositories call the reusable workflows rather than this action:

```yaml
# .github/workflows/update-milestone.yml
on:
  pull_request_target:
    types: [opened, reopened, synchronize, closed]
jobs:
  update_milestone:
    uses: RocketSurgeonsGuild/actions/.github/workflows/update-milestone.yml@v0.4.0

# .github/workflows/draft-release.yml (push to the default branch, schedule)
# .github/workflows/close-milestone.yml (release: published)
#   uses: RocketSurgeonsGuild/actions/.github/workflows/draft-release.yml@v0.4.0 / close-milestone.yml@v0.4.0
#   secrets: { RSG_BOT_TOKEN: ${{ secrets.RSG_BOT_TOKEN }} }
```

## The next version

- **semver** (default): the latest stable release, bumped by the labels of the pull requests merged since it.
  `:boom: breaking change` bumps major (minor while the major version is 0), `:rocket: feature` or `:fire: enhancement`
  bumps minor, anything else bumps patch.
- **calver**: `<year>.<month>.<number of this month's tags>`, as MSBuildSdk's release workflow tags.

Rename the pending milestone to a higher version by hand to force a bigger release; the automation keeps the higher one.

## What a sync does

Every `sync` is an idempotent reconcile, so a missed or cancelled run is repaired by the next one:

1. The latest stable release's milestone (and the `release-tag` input's) gets every pull request between the previous
   release and it, plus the issues they close. Open items move to the pending milestone, pull requests closed without
   merging and issues closed as not planned leave it, and it is closed.
2. Older version milestones that are still open have their open items moved on and are closed (deleted when they never
   held anything).
3. The pending milestone is created, renamed or merged so there is exactly one, named after the next version. It gets
   the pull requests merged since the latest release, the issues they close and the open pull requests into the default
   branch. Merged pull requests without a label get `default-label`.
4. There is one draft release for the next version, and its notes are regenerated from `.github/release.yml` each time.
   Drafts for versions that already shipped are deleted.

The `pull-request` mode only files the event's pull request: open or merged ones go into the pending milestone, and one
closed without merging leaves it. Prereleases never close a milestone.

Pass `dry-run: true` to log the changes without making them.

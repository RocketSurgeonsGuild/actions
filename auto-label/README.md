# Auto Label

Automatically labels a pull request based on the prefix in its title (e.g. `feat:`, `fix:`, `chore:`).

Runs on `pull_request` `opened` and `reopened` events.

## Inputs

| Name           | Required | Default | Description                                                                                        |
| -------------- | -------- | ------- | --------------------------------------------------------------------------------------------------- |
| `github-token` | yes      | —       | Token used to read repo labels and add labels to the PR. Usually `${{ secrets.GITHUB_TOKEN }}`.      |
| `label-map`    | no       | `''`    | JSON object mapping a title prefix to an exact repository label name. Example: `{"feat":"feature","fix":"bug"}` |

## Behavior

The PR title is split on the first `:` and the text before it (trimmed) becomes the **prefix**.

- **With `label-map` set:** the prefix is looked up in the map.
  - No entry for the prefix -> no label applied, action logs and exits.
  - Mapped label name doesn't exist in the repo -> no label applied, action logs and exits.
  - Otherwise the exact mapped label is applied.
- **Without `label-map`:** falls back to the original behavior — every repo label whose name *contains* the prefix as a substring is applied. No match -> no label applied.

## Usage

### With a label map (recommended)

```yaml
name: Auto Label
on:
  pull_request:
    types: [opened, reopened]

jobs:
  label:
    runs-on: ubuntu-latest
    steps:
      - uses: rsg/actions/auto-label@master
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          label-map: '{"feat":"feature","fix":"bug","chore":"chore","docs":"documentation"}'
```

A PR titled `feat: add label mapping configuration` gets the `feature` label applied. A PR titled `oops: broken thing` (no map entry) gets nothing.

### Without a label map (legacy substring matching)

```yaml
      - uses: rsg/actions/auto-label@master
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

A PR titled `feat: add thing` gets any repo label containing `feat` applied (e.g. both `feature` and `feat` if both exist).

## Notes

- Labels referenced by `label-map` must already exist in the repository — this action does not create labels.
- Prefer `label-map` for predictable, one-to-one labeling; the substring fallback can apply multiple/unexpected labels if several repo labels share the prefix.

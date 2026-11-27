// eslint-disable-next-line @typescript-eslint/no-require-imports
const milestones = require('../index.js');

const options = {
  majorLabels: [':boom: breaking change'],
  minorLabels: [':rocket: feature', ':fire: enhancement'],
  initialVersion: { major: 0, minor: 1, patch: 0 },
};
const pr = (...labels: string[]) => ({ labels });

describe('parseVersion', () => {
  it('reads stable versions with or without the v prefix', () => {
    expect(milestones.parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(milestones.parseVersion('2026.11.6')).toEqual({ major: 2026, minor: 11, patch: 6 });
  });

  it('ignores prereleases and other titles', () => {
    expect(milestones.parseVersion('v2.0.1-beta.51')).toBeUndefined();
    expect(milestones.parseVersion('Backlog')).toBeUndefined();
    expect(milestones.parseVersion('v')).toBeUndefined();
  });
});

describe('nextSemver', () => {
  const latest = { major: 1, minor: 4, patch: 2 };

  it('bumps patch for unlabeled and chore pull requests', () => {
    expect(milestones.nextSemver(latest, [pr(), pr(':hammer: chore'), pr(':truck: private-dependencies')], options)).toEqual({ major: 1, minor: 4, patch: 3 });
  });

  it('bumps minor for a feature or an enhancement', () => {
    expect(milestones.nextSemver(latest, [pr(':lady_beetle: bug'), pr(':fire: enhancement')], options)).toEqual({ major: 1, minor: 5, patch: 0 });
  });

  it('bumps major for a breaking change', () => {
    expect(milestones.nextSemver(latest, [pr(':rocket: feature'), pr(':boom: breaking change')], options)).toEqual({ major: 2, minor: 0, patch: 0 });
  });

  it('bumps minor for a breaking change while the major version is 0', () => {
    expect(milestones.nextSemver({ major: 0, minor: 8, patch: 1 }, [pr(':boom: breaking change')], options)).toEqual({ major: 0, minor: 9, patch: 0 });
  });

  it('starts at the initial version without a release', () => {
    expect(milestones.nextSemver(undefined, [pr(':boom: breaking change')], options)).toEqual({ major: 0, minor: 1, patch: 0 });
  });
});

describe('nextCalver', () => {
  it("counts this month's tags", () => {
    const now = new Date(Date.UTC(2026, 10, 20));
    expect(milestones.nextCalver(now, ['v2026.10.4', 'v2026.11.0', 'v2026.11.1', 'v2026.11.2-beta'])).toEqual({ major: 2026, minor: 11, patch: 2 });
  });

  it('starts a new month at 0', () => {
    expect(milestones.nextCalver(new Date(Date.UTC(2026, 11, 1)), ['v2026.11.6'])).toEqual({ major: 2026, minor: 12, patch: 0 });
  });
});

describe('chooseTarget', () => {
  it('keeps a pending milestone renamed to a higher version by hand', () => {
    expect(milestones.chooseTarget({ major: 2, minor: 0, patch: 0 }, [{ major: 2, minor: 0, patch: 1 }])).toEqual({ major: 2, minor: 0, patch: 1 });
  });

  it('moves past lower pending milestones', () => {
    expect(milestones.chooseTarget({ major: 0, minor: 3, patch: 0 }, [{ major: 0, minor: 2, patch: 6 }])).toEqual({ major: 0, minor: 3, patch: 0 });
  });
});

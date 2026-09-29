import { addPullRequestLabel } from '../src/ensure-label';

const mockListLabelsForRepo = jest.fn();
const mockAddLabels = jest.fn();

const mockGithub = {
    rest: {
        issues: {
            listLabelsForRepo: mockListLabelsForRepo,
            addLabels: mockAddLabels,
        },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const mockRepo = { owner: 'test-owner', repo: 'test-repo' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makePR(title: string, number = 1): any {
    return { title, number, labels: [] };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockListLabelsForRepo.mockResolvedValue({
        data: [{ name: 'feature' }, { name: 'bug' }, { name: 'feat' }],
    });
    mockAddLabels.mockResolvedValue({});
});

describe('without labelMap (existing behavior)', () => {
    test('applies all repo labels that contain the prefix as a substring', async () => {
        await addPullRequestLabel(mockGithub, mockRepo, makePR('feat: add thing'));
        // Both 'feature' and 'feat' contain the substring 'feat'
        expect(mockAddLabels).toHaveBeenCalledWith({
            ...mockRepo,
            issue_number: 1,
            labels: ['feature', 'feat'],
        });
    });

    test('does not apply a label when no repo label contains the prefix', async () => {
        await addPullRequestLabel(mockGithub, mockRepo, makePR('xyz: unknown'));
        expect(mockAddLabels).not.toHaveBeenCalled();
    });
});

describe('with labelMap', () => {
    const labelMap = { feat: 'feature', fix: 'bug' };

    test('applies mapped label when prefix matches and label exists in repo', async () => {
        await addPullRequestLabel(mockGithub, mockRepo, makePR('feat: add thing'), labelMap);
        expect(mockAddLabels).toHaveBeenCalledWith({
            ...mockRepo,
            issue_number: 1,
            labels: ['feature'],
        });
    });

    test('does not apply a label when the prefix is not in the map', async () => {
        await addPullRequestLabel(mockGithub, mockRepo, makePR('docs: update readme'), labelMap);
        expect(mockAddLabels).not.toHaveBeenCalled();
    });

    test('does not apply a label when the mapped label does not exist in the repo', async () => {
        const missingMap = { chore: 'maintenance' };
        await addPullRequestLabel(mockGithub, mockRepo, makePR('chore: cleanup'), missingMap);
        expect(mockAddLabels).not.toHaveBeenCalled();
    });
});

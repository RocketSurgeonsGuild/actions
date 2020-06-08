import { mergeData } from '../src/mergeData';
import { join } from 'path';
import { execSync, ExecSyncOptions } from 'child_process';

test('returns same data if given one file', async () => {
    const data = await mergeData([join(__dirname, 'fixtures/.github.labels.yml')]);

    const question = data.find(x => x.name === ':grey_question: question')!;
    expect(question.color).not.toBe('cccccc');
});

test('merges data from parent to child', async () => {
    const data = await mergeData([join(__dirname, 'fixtures/.github.labels.yml'), join(__dirname, 'fixtures/local.labels.yml')]);

    const question = data.find(x => x.name === ':grey_question: question')!;
    expect(question.color).toBe('cccccc');
});

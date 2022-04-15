import { debug, setFailed, getInput } from '@actions/core';
import { create } from '@actions/glob';
import { dump } from 'js-yaml';
import { writeFile } from 'fs';
import { resolve } from 'path';
import { mergeData } from './mergeData';
import { bindNodeCallback, lastValueFrom } from 'rxjs';

const writeFile$ = bindNodeCallback(writeFile);

async function run(): Promise<void> {
    try {
        const globStrings: string[] = getInput('files', { required: true }).split(',');
        const output: string = getInput('output', { required: true });

        const files = [];

        for (const fileGlob of globStrings) {
            const glob = await create(fileGlob);
            files.push(...(await glob.glob()));
        }

        const data = await mergeData(files);
        debug(`writing ${output}`);
        await lastValueFrom(writeFile$(resolve(output), dump(data)));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
        setFailed(error.message);
    }
}

run();

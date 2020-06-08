import { debug, setFailed, getInput, warning } from '@actions/core';
import { create } from '@actions/glob';
import { safeDump } from 'js-yaml';
import { writeFile } from 'fs';
import { resolve } from 'path';
import { mergeData } from './mergeData';
import { bindNodeCallback } from 'rxjs';

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
        warning(`writing ${output}`);
        await writeFile$(resolve(output), safeDump(data)).toPromise();
    } catch (error) {
        setFailed(error.message);
    }
}

run();

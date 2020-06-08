import { debug, setFailed, getInput } from '@actions/core';
import { create } from '@actions/glob';
import { safeDump } from 'js-yaml';
import { writeFile } from 'fs';
import { resolve } from 'path';
import { mergeData } from './mergeData';
import { bindNodeCallback } from 'rxjs';

const writeFile$ = bindNodeCallback(writeFile);

async function run(): Promise<void> {
    try {
        const globString: string = getInput('files', { required: true });
        const output: string = getInput('output', { required: true });
        const glob = await create(globString);

        const data = mergeData(await glob.glob());
        debug(`writing ${output}`);
        await writeFile$(resolve(output), safeDump(data)).toPromise();
    } catch (error) {
        setFailed(error.message);
    }
}

run();

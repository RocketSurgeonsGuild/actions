import { debug } from '@actions/core';
import { bindNodeCallback, lastValueFrom } from 'rxjs';
import { map } from 'rxjs/operators';
import { readFile } from 'fs';
import { load } from 'js-yaml';

const readFile$ = bindNodeCallback(readFile);

export interface ILabelItem {
    name: string;
    description: string;
    from_name: string;
    color: string;
}

export async function mergeData(files: string[]) {
    const result = new Map<string, ILabelItem>();

    for (const item of files) {
        debug(`reading ${item}`);

        const content = await lastValueFrom(readFile$(item).pipe(map(z => z.toString())));
        const data = load(content) as ILabelItem[] | undefined;
        if (!Array.isArray(data)) continue;
        for (const dataItem of data) {
            result.set(dataItem.name, dataItem);
        }
    }

    return Array.from(result.values());
}

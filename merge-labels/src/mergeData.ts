import { debug, warning } from '@actions/core';
import { bindNodeCallback } from 'rxjs';
import { map } from 'rxjs/operators';
import { readFile } from 'fs';
import { safeLoad } from 'js-yaml';

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
        warning(`reading ${item}`);
        const content = await readFile$(item)
            .pipe(map(z => z.toString()))
            .toPromise();
        const data: ILabelItem[] | undefined = safeLoad(content);
        if (!Array.isArray(data)) continue;
        for (const dataItem of data) {
            result.set(dataItem.name, dataItem);
        }
    }

    return Array.from(result.values());
}

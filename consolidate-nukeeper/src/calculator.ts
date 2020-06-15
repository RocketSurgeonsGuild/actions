// import { from, toArray, count, first } from 'ix/iterable';
// import { map, groupBy, concatAll, filter, intersect, take, distinct } from 'ix/iterable/operators';

// const commonPatterns = [
//     [/^Microsoft\.Extensions\..*$/],
//     [/^System\..*$/],
//     [/^Microsoft\.AspNetCore\..*$/],
//     [/^Microsoft\.Azure\..*$/],
//     [/^Microsoft\.CodeAnalysis\..*$/],
//     [/^Microsoft\.NET\.Test\..*$/],
//     [/^NodaTime.*$/],
//     [/^App\.Metrics\..*$/],
//     [/^NuGet\..*$/],
//     [/^AutoMapper\..*$/, /^\.AutoMapper.*$/],
//     [/^Swashbuckle\..*$/, /^\.Swashbuckle.*$/],
//     [/^FakeItEasy\..*$/, /^\.FakeItEasy.*$/],
//     [/^DryIoc\..*$/, /^\.DryIoc.*$/],
//     [/^FluentValidation\..*$/, /^\.FluentValidation.*$/],
//     [/^MediatR\..*$/, /^\.MediatR.*$/],
//     [/^Nuke\..*$/, /^\.Nuke.*$/],
//     [/^coverlet\..*$/],
//     [/^xunit.*$/, /^\.xunit.*$/],
// ];

// export function consolidate() {}

// export function groupNames(names: string[]) {
//     const parts$ = from(names).pipe(map(name => ({ parts: name.split('.'), name })));
//     from(parts$)
//         .pipe(
//             map(function* ({ parts, name }) {
//                 for (let i = 0; i < parts.length - 1; i++) {
//                     const prefix = parts.slice(0, parts.length - i - 1);

//                     yield from(parts$).pipe(
//                         filter(v => v.name !== name),
//                         map(v => count(from(v.parts).pipe(intersect(prefix)))),
//                         filter(v => v > 0),
//                         take(1),
//                         map(() => ({ prefix: prefix.join('.'), parts: prefix, name })),
//                     );
//                     // yield { name, prefix };
//                 }
//             }),
//             map(z => from(z).pipe(take(1))),
//             concatAll(),
//             concatAll(),
//             distinct(),
//         )
//         .forEach(x => {
//             console.log(x);
//         });
// }

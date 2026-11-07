import sharp from 'sharp';
const [src, out] = process.argv.slice(2);
const jobs = [
  ['planner', 'planner-main', { left: 0, top: 226, width: 2336, height: 1290 }],
  ['money', 'money-main', { left: 0, top: 170, width: 1632, height: 1430 }],
  ['notes', 'notes-full', { left: 520, top: 428, width: 1592, height: 1320 }],
  ['today-side', 'today-side', { left: 0, top: 0, width: 682, height: 1610 }],
  ['meetings-side', 'meetings-side', { left: 0, top: 0, width: 720, height: 1610 }],
  ['notes-side', 'notes-side', { left: 0, top: 0, width: 720, height: 1610 }],
  ['money-side', 'money-side', { left: 0, top: 0, width: 682, height: 1610 }],
  ['planner-phone', 'phone-todo', { left: 0, top: 1005, width: 1170, height: 1260 }],
  ['money-phone', 'phone-finance', { left: 0, top: 525, width: 1170, height: 1740 }],
  ['notes-phone', 'phone-notes', { left: 0, top: 615, width: 1170, height: 1470 }],
  ['phone-light', 'iphone-today-light', null, 900],
  ['phone-paper', 'iphone-today-paper', null, 900],
  ['phone-dark', 'iphone-today-dark', null, 900],
  ['phone-notes', 'iphone-notes', null, 900],
];
let total = 0;
const only = process.argv[4] ? new RegExp(process.argv[4]) : null; // e.g. ^phone- to redo just those
for (const [name, from, box, w] of jobs) {
  if (only && !only.test(name)) continue;
  let img = sharp(`${src}/${from}.png`);
  if (box) img = img.extract(box);
  if (w) img = img.resize(w);
  const a = await img.clone().avif({ quality: 58, effort: 6 }).toFile(`${out}/${name}.avif`);
  const b = await img.clone().webp({ quality: 80 }).toFile(`${out}/${name}.webp`);
  total += a.size;
  console.log(name, a.width, a.height, Math.round(a.size / 1024) + 'K avif', Math.round(b.size / 1024) + 'K webp');
}
console.log('avif total', Math.round(total / 1024) + 'K');

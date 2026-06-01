import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const chunksDir = 'apps/web/.next/static/chunks';

function getFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFiles(file));
    } else if (file.endsWith('.js')) {
      results.push(file);
    }
  });
  return results;
}

const files = getFiles(chunksDir);
const report = files.map(file => {
  const content = fs.readFileSync(file);
  const size = content.length;
  const gzipSize = zlib.gzipSync(content).length;
  return {
    file: path.relative(chunksDir, file),
    size,
    gzipSize
  };
}).sort((a, b) => b.gzipSize - a.gzipSize);

console.log('Bundle Baseline Report');
console.log('======================');
console.log(`${'File'.padEnd(60)} | ${'Size'.padStart(10)} | ${'Gzip'.padStart(10)}`);
console.log('-'.repeat(85));
report.slice(0, 20).forEach(entry => {
  console.log(`${entry.file.padEnd(60)} | ${entry.size.toString().padStart(10)} | ${entry.gzipSize.toString().padStart(10)}`);
});

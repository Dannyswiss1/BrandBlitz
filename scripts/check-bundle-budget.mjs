import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const chunksDir = 'apps/web/.next/static/chunks';
const baselinePath = 'docs/perf/bundle-baseline.txt';

if (!fs.existsSync(baselinePath)) {
  console.log('No baseline found, skipping budget check.');
  process.exit(0);
}

const baselineText = fs.readFileSync(baselinePath, 'utf-8');
const baselineLines = baselineText.split('\n').slice(4); // Skip header

const baselineSizes = {};
let totalBaselineGzip = 0;

for (const line of baselineLines) {
  if (!line.trim()) continue;
  const parts = line.split('|').map(p => p.trim());
  if (parts.length === 3) {
    const file = parts[0];
    const gzip = parseInt(parts[2], 10);
    if (!isNaN(gzip)) {
      // For hashed files, we just look at total size for a rough budget
      totalBaselineGzip += gzip;
    }
  }
}

function getFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
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
let totalCurrentGzip = 0;

for (const file of files) {
  const content = fs.readFileSync(file);
  const gzipSize = zlib.gzipSync(content).length;
  totalCurrentGzip += gzipSize;
}

console.log(`Baseline Total Gzip: ${totalBaselineGzip} bytes`);
console.log(`Current Total Gzip: ${totalCurrentGzip} bytes`);

if (totalBaselineGzip > 0) {
  const diff = totalCurrentGzip - totalBaselineGzip;
  const percentage = (diff / totalBaselineGzip) * 100;
  console.log(`Difference: ${diff} bytes (${percentage.toFixed(2)}%)`);

  if (percentage > 10) {
    console.error('::warning::Bundle size regressed by more than 10%!');
    // If strict failure is required, we could exit 1. The AC says "CI warns"
  } else {
    console.log('Bundle size is within budget.');
  }
}

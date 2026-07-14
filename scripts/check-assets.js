#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const requiredPaths = [
  'fonts/TimesSquare-m105.ttf',
  'images/mlb',
  'images/nhl',
  'images/nfl',
  'images/nba',
  'images/oly'
];

let failures = 0;
function check(condition, message) {
  if (condition) console.log(`✅ ${message}`);
  else { console.error(`❌ ${message}`); failures += 1; }
}

for (const rel of requiredPaths) {
  check(fs.existsSync(path.join(ROOT, rel)), `${rel} exists`);
}

const requiredAssets = [
  'images/mlb/AL.png',
  'images/mlb/NL.png'
];

for (const rel of requiredAssets) {
  check(fs.existsSync(path.join(ROOT, rel)), `${rel} exists`);
}

const dirs = ['images/mlb', 'images/nhl', 'images/nfl', 'images/nba', 'images/oly'];
for (const rel of dirs) {
  const dir = path.join(ROOT, rel);
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.png'));
  check(files.length > 0, `${rel} contains PNG assets`);

  const lowerSeen = new Map();
  for (const file of files) {
    const lower = file.toLowerCase();
    if (lowerSeen.has(lower) && lowerSeen.get(lower) !== file) {
      console.warn(`⚠️ ${rel} has case-colliding files: ${lowerSeen.get(lower)} and ${file}`);
    }
    lowerSeen.set(lower, file);
  }
}

if (failures > 0) process.exitCode = 1;
else console.log('All asset checks passed.');

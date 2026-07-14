const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createModuleDefinition() {
  let definition;
  const source = fs.readFileSync(path.join(__dirname, '..', 'MMM-Scores.js'), 'utf8');
  const context = {
    Module: {
      register(_name, moduleDefinition) {
        definition = moduleDefinition;
      }
    }
  };

  vm.runInNewContext(source, context, { filename: 'MMM-Scores.js' });
  return definition;
}

test('MLB All-Star teams render as AL and NL abbreviations', () => {
  const moduleDefinition = createModuleDefinition();

  assert.equal(moduleDefinition._abbrForTeam({ displayName: 'American League All-Stars' }, 'mlb'), 'AL');
  assert.equal(moduleDefinition._abbrForTeam({ displayName: 'National League All-Stars' }, 'mlb'), 'NL');
});

test('MLB All-Star abbreviations use dedicated AL and NL logo files', () => {
  const moduleDefinition = createModuleDefinition();
  const moduleInstance = Object.assign(Object.create(moduleDefinition), {
    _getLeague() {
      return 'mlb';
    },
    file(relativePath) {
      return relativePath;
    }
  });

  assert.equal(moduleInstance.getLogoUrl('AL'), 'images/mlb/AL.png');
  assert.equal(moduleInstance.getLogoUrl('NL'), 'images/mlb/NL.png');
});

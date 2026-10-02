const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('production compose keeps Arcade private and attached to Caddy', () => {
  const base = read('compose.yaml');
  const production = read('compose.prod.yaml');

  assert.match(base, /expose:\s*\n\s*- ["']3000["']/);
  assert.doesNotMatch(base, /ports:/);
  assert.match(production, /external:\s*true/);
  assert.match(production, /name: \$\{CADDY_NETWORK:-caddy\}/);
});

test('Hostinger workflow tests before invoking the deployment script', () => {
  const workflow = read('.github/workflows/deploy-hostinger.yml');
  const testStep = workflow.indexOf('run: npm test');
  const deployStep = workflow.indexOf('< deploy/hostinger-deploy.sh');

  assert.notEqual(testStep, -1);
  assert.notEqual(deployStep, -1);
  assert.ok(testStep < deployStep);
  assert.match(workflow, /HOSTINGER_KNOWN_HOSTS/);
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /^name: Deploy production to Hostinger$/m);
  assert.match(workflow, /^    environment: production$/m);
});

test('Hostinger release includes the built browser bundle', () => {
  const workflow = read('.github/workflows/deploy-hostinger.yml');
  const buildStep = workflow.indexOf('run: npm run build');
  const packageStep = workflow.indexOf('name: Package application');

  assert.notEqual(buildStep, -1);
  assert.notEqual(packageStep, -1);
  assert.ok(buildStep < packageStep);
  assert.doesNotMatch(workflow, /--exclude=['"]public\/react-app\.js['"]/);
});

test('Hostinger current symlink exposes the built public directory', () => {
  const deployScript = read('deploy/hostinger-deploy.sh');

  assert.match(
    deployScript,
    /ln -sfn "\$release_path\/public" "\$\{deploy_path\}\/current"/,
  );
});

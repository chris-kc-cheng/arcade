const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('default compose command starts a localhost development server', () => {
  const local = read('compose.override.yaml');

  assert.match(local, /target: development/);
  assert.match(local, /command: npm run dev/);
  assert.match(local, /127\.0\.0\.1:3000:3000/);
  assert.match(local, /\.\:\/app/);
  assert.match(local, /arcade_node_modules:\/app\/node_modules/);
});

test('production compose joins the shared platform network as arcade:3000 and publishes nothing', () => {
  const base = read('compose.yaml');
  const production = read('compose.prod.yaml');

  const squash = text => text.replace(/\s+/g, ' ');
  assert.match(squash(base), /expose: - ["']3000["']/);
  assert.doesNotMatch(base, /ports:/);
  assert.doesNotMatch(production, /ports:/);
  assert.match(production, /^name: arcade-shared$/m, 'a project of its own, so it can start beside the previous container');
  assert.match(production, /container_name: arcade$/m);
  assert.match(production, /restart: unless-stopped/);
  assert.match(production, /healthcheck:/);
  assert.match(squash(production), /aliases: - arcade/);
  assert.match(squash(production), /platform-edge: external: true name: \$\{PLATFORM_EDGE_NETWORK:-platform-edge\}/);
  assert.match(production, /APPS_URL: \$\{APPS_URL-https:\/\/apps\.hedgies\.cloud\/app\.json\}/);
  assert.doesNotMatch(production, /CADDY_NETWORK|ghcr/);
});

test('the deploy script guards the platform network, validates Compose and never touches the env file', () => {
  const script = read('deploy/hostinger-deploy.sh');
  const workflow = read('.github/workflows/deploy-hostinger.yml');

  assert.match(script, /docker network inspect "\$edge_network"/);
  assert.match(script, /config --quiet/);
  assert.match(script, /up -d --build --remove-orphans/);
  assert.match(script, /project=arcade-shared/);
  assert.equal(script.split('\n').filter(line => /^\s*(rm|tee|cp|mv)\b/.test(line) && line.includes('.env')).length, 0, 'the settings file is only ever read');
  assert.match(workflow, /platform-edge/);
  assert.doesNotMatch(workflow, /CADDY_NETWORK|ghcr|docker login|docker push/);
  assert.match(workflow, /docker compose -f compose\.yaml -f compose\.prod\.yaml config --quiet/);
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

test('every arcade app loads the shared navigation and debug platform', () => {
  const pages = ['index.html', 'fighter.html', 'snake.html', 'bigtwo.html', 'typing.html', 'wordle.html', 'poll.html', 'tank.html', 'slushy.html', 'typohunt.html', 'twinspot.html'];
  for (const page of pages) assert.match(read(`public/${page}`), /<script src="\/platform\.js"><\/script>/, page);

  const platform = read('public/platform.js');
  assert.match(platform, /class DebugWebSocket extends NativeWebSocket/);
  assert.match(platform, /arcade-debug-toggle/);
  assert.match(platform, /arcade-debug-panel/);
  assert.match(platform, /arcade-debug-close/);
  assert.match(platform, /data-received-messages/);
  assert.match(platform, /data-sent-bytes/);
  assert.match(platform, /new TextEncoder\(\)/);
  assert.match(platform, /\['\/poll','poll','Quick Poll'\]/);
});

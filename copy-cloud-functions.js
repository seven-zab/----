const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'dist', 'cloudfunctions');
const destDir = path.join(__dirname, 'dist', 'build', 'mp-weixin', 'cloudfunctions');

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (let entry of entries) {
    // Dependencies are installed by the cloud deployment environment.
    // Do not package local caches, credentials, or generated reports.
    if (
      ['node_modules', '.git', 'coverage', '.baseline'].includes(entry.name) ||
      entry.name.startsWith('.env') ||
      entry.name.endsWith('.log')
    ) {
      continue;
    }
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (fs.existsSync(srcDir)) {
  try {
    // This is a generated build directory. Verify the absolute target before clearing stale artifacts.
    const distRoot = path.resolve(__dirname, 'dist') + path.sep;
    const resolvedDest = path.resolve(destDir);
    if (!resolvedDest.startsWith(distRoot) || path.basename(resolvedDest) !== 'cloudfunctions') {
      throw new Error('Refusing to clear a path outside the generated build directory');
    }
    fs.rmSync(resolvedDest, { recursive: true, force: true });
    console.log(`Copying cloudfunctions from ${srcDir} to ${destDir}...`);
    const deployment = JSON.parse(fs.readFileSync(path.join(srcDir, 'deployment.json'), 'utf8'));
    const release = require('./contracts/generated/release.json');
    const allTargets = { ...release.targets, ...release.workers };
    if (deployment.source_hash !== release.source_hash)
      throw new Error('Stale cloud deployment manifest');
    for (const artifact of deployment.functions) {
      if (
        allTargets[artifact.service] !== artifact.name ||
        !/^yzxz_v2_[a-zA-Z]+$/.test(artifact.name)
      ) {
        throw new Error('Unexpected cloud function target');
      }
      copyDir(path.join(srcDir, artifact.name), path.join(destDir, artifact.name));
    }
    fs.copyFileSync(path.join(srcDir, 'deployment.json'), path.join(destDir, 'deployment.json'));
    const event = process.env.npm_lifecycle_event || '';
    const mode = event.endsWith(':test')
      ? 'test'
      : event.endsWith(':prod')
      ? 'production'
      : 'default';
    const environmentFile = path.join(__dirname, `.env.${mode}`);
    const environment = fs.existsSync(environmentFile)
      ? require('dotenv').parse(fs.readFileSync(environmentFile))
      : {};
    fs.writeFileSync(
      path.join(path.dirname(destDir), 'build-info.json'),
      JSON.stringify(
        {
          mode,
          source_hash: release.source_hash,
          cloud_env_id: process.env.VITE_CLOUD_ENV_ID || environment.VITE_CLOUD_ENV_ID || null,
        },
        null,
        2,
      ),
    );
    console.log('Cloud functions copied successfully.');
  } catch (err) {
    console.error('Error copying cloud functions:', err);
    process.exit(1);
  }
} else {
  throw new Error('Compiled cloudfunctions not found; run npm run build:cloudfunctions first.');
}

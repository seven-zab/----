const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'cloudfunctions');
const destDir = path.join(__dirname, 'dist', 'build', 'mp-weixin', 'cloudfunctions');

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (let entry of entries) {
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
    console.log(`Copying cloudfunctions from ${srcDir} to ${destDir}...`);
    copyDir(srcDir, destDir);
    console.log('Cloud functions copied successfully.');
  } catch (err) {
    console.error('Error copying cloud functions:', err);
    process.exit(1);
  }
} else {
  console.warn('cloudfunctions directory not found, skipping copy.');
}

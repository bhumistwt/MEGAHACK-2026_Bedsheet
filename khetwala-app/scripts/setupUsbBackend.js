const { execFileSync } = require('child_process');
const http = require('http');

const PORT = Number(process.env.KHETWALA_BACKEND_PORT || 8000);
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`;

function runAdb(args) {
  return execFileSync('adb', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function getConnectedDevices() {
  const output = runAdb(['devices']);
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line && line.endsWith('\tdevice'))
    .map((line) => line.split('\t')[0]);
}

function checkHealth(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
          return;
        }
        reject(new Error(`Health check failed with status ${res.statusCode || 'unknown'}`));
      });
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error('Health check timed out'));
    });
  });
}

async function main() {
  try {
    const devices = getConnectedDevices();
    if (devices.length === 0) {
      console.error('No USB-debuggable Android device found.');
      process.exit(1);
    }

    runAdb(['reverse', `tcp:${PORT}`, `tcp:${PORT}`]);
    console.log(`ADB reverse enabled for tcp:${PORT} on ${devices.join(', ')}.`);

    try {
      const body = await checkHealth(HEALTH_URL);
      console.log(`Backend health OK at ${HEALTH_URL}.`);
      console.log(body);
    } catch (error) {
      console.warn(`ADB reverse is ready, but backend health check failed: ${error.message}`);
      console.warn('Start the FastAPI server on your computer and rerun this script if needed.');
    }
  } catch (error) {
    console.error(`USB backend setup failed: ${error.message}`);
    process.exit(1);
  }
}

main();
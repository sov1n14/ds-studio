/**
 * Phase 1: Human-assisted login into a Playwright persistent context.
 * Opens a HEADED browser, navigates to DeepSeek sign-in, and waits
 * up to 300s for the human to complete login (including any CAPTCHA).
 * Success signal: chat composer textarea visible.
 */
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WAIT_MS = 300_000;
const profileDir = resolve(__dirname, '.pw-profile');

console.log('=== Phase 1: Manual Login ===');
console.log('Launching headed Chromium with persistent profile...');
console.log('');
console.log('>>> HUMAN ACTION REQUIRED <<<');
console.log('A browser window will open to the DeepSeek sign-in page.');
console.log('Please log in manually and solve any CAPTCHA that appears.');
console.log(`You have ${WAIT_MS / 1000} seconds. The script will detect success automatically.`);
console.log('');

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  locale: 'en-US',
});

const page = context.pages()[0] || await context.newPage();

try {
  await page.goto('https://chat.deepseek.com/sign_in', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  // If already logged in, sign_in redirects to chat
  if (!page.url().includes('sign_in')) {
    console.log(`Already logged in — redirected to: ${page.url()}`);
  }

  // Wait for the composer textarea — the logged-in signal
  console.log('Waiting for chat composer textarea (up to 300s)...');
  try {
    await page.waitForSelector('textarea', { state: 'visible', timeout: WAIT_MS });
    const finalUrl = page.url();
    console.log(`Final URL: ${finalUrl}`);
    console.log('SUCCESS');
  } catch {
    console.log(`Final URL: ${page.url()}`);
    console.log('TIMEOUT');
  }
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  console.log('TIMEOUT');
} finally {
  await context.close();
  console.log('Browser closed, profile flushed.');
}

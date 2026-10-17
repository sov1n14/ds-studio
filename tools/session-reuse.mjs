/**
 * Phase 2: Test whether a previous login persists in the persistent context. First tries HEADLESS. If that fails (redirected to sign-in or no composer), retries HEADED to distinguish "cookie didn't persist" from "headless flagged".
 */
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const profileDir = resolve(__dirname, '.pw-profile');
const WAIT_MS = 30_000;

async function checkSession(headless, screenshotName) {
  const mode = headless ? 'HEADLESS' : 'HEADED';
  console.log(`\n=== Checking session (${mode}) ===`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  });

  const page = context.pages()[0] || await context.newPage();
  let composerFound = false;
  let finalUrl = '';
  let divCount = 0;

  try {
    await page.goto('https://chat.deepseek.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await page.waitForTimeout(3000);
    finalUrl = page.url();
    console.log(`URL after navigation: ${finalUrl}`);

    if (finalUrl.includes('sign_in')) {
      console.log('Redirected to sign-in — session NOT persisted.');
    } else {
      try {
        await page.waitForSelector('textarea', { state: 'visible', timeout: WAIT_MS });
        composerFound = true;
      } catch {
        console.log('Composer textarea not found within timeout.');
      }
    }

    divCount = await page.evaluate(() => document.querySelectorAll('div[class^="_"]').length);

    await page.screenshot({ path: resolve(__dirname, screenshotName), fullPage: true });
    console.log(`Screenshot saved: tools/${screenshotName}`);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    finalUrl = page.url();
  } finally {
    await context.close();
  }

  console.log(`--- ${mode} Result ---`);
  console.log(`URL: ${finalUrl}`);
  console.log(`Composer found: ${composerFound}`);
  console.log(`div[class^="_"] count: ${divCount}`);

  return { composerFound, finalUrl, divCount };
}

const headlessResult = await checkSession(true, 'session-reuse.png');

if (!headlessResult.composerFound) {
  console.log('\nHeadless failed — retrying HEADED to distinguish cookie loss from headless detection...');
  const headedResult = await checkSession(false, 'session-reuse-headed.png');

  console.log('\n=== COMPARISON ===');
  console.log(`Headless: composer=${headlessResult.composerFound}, url=${headlessResult.finalUrl}`);
  console.log(`Headed:   composer=${headedResult.composerFound}, url=${headedResult.finalUrl}`);

  if (!headedResult.composerFound) {
    console.log('VERDICT: Session did NOT persist — cookie/token expired or was not saved.');
  } else {
    console.log('VERDICT: Session persists HEADED but NOT HEADLESS — headless is detected.');
  }
} else {
  console.log('\nVERDICT: Session persists in HEADLESS — unattended runs are viable.');
}

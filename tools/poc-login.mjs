/**
 * POC: Can Playwright log into chat.deepseek.com unattended?
 * Reads credentials from tools/test_auth.txt (line1=email, line2=password).
 * Uses a persistent browser context at tools/.pw-profile.
 * Saves screenshot to tools/poc-login-result.png.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = 150_000; // 2.5 min total budget

// Read credentials
const creds = readFileSync(resolve(__dirname, 'test_auth.txt'), 'utf8')
  .replace(/\r/g, '')
  .split('\n')
  .filter(Boolean);
const [email, password] = creds;
if (!email || !password) {
  console.error('FAIL: Could not read email/password from tools/test_auth.txt');
  process.exit(1);
}
console.log(`Email: ${email}`);
console.log('Password: [REDACTED]');

// Launch with persistent context (keeps cookies/session for future runs)
const profileDir = resolve(__dirname, '.pw-profile');
const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  locale: 'en-US',
});

const page = context.pages()[0] || await context.newPage();
const deadline = Date.now() + TIMEOUT_MS;
const remaining = () => Math.max(deadline - Date.now(), 1000);

try {
  // Step 1: Navigate to sign-in
  console.log('\n--- Navigating to sign-in page ---');
  await page.goto('https://chat.deepseek.com/sign_in', {
    waitUntil: 'networkidle',
    timeout: remaining(),
  });

  // Check for Cloudflare challenge
  const cf = await page.$('#challenge-running, #challenge-form, .cf-challenge, #cf-wrapper');
  if (cf) {
    console.log('BLOCKED: Cloudflare interstitial detected');
    await page.screenshot({ path: resolve(__dirname, 'poc-login-result.png') });
    process.exit(2);
  }

  // Check if already logged in (redirected away from sign_in)
  if (!page.url().includes('sign_in')) {
    console.log(`Already logged in — redirected to: ${page.url()}`);
  } else {
    // Debug: dump what inputs exist on the page right now
    const pageInputs = await page.evaluate(() => {
      return [...document.querySelectorAll('input')].map(el => ({
        type: el.type, placeholder: el.placeholder, visible: el.offsetParent !== null,
      }));
    });
    console.log('Inputs on page:', JSON.stringify(pageInputs));

    // Step 2: Fill the login form - try multiple locator strategies
    console.log('Filling email...');
    // Try placeholder first, fall back to first visible text input
    let emailInput = page.locator('input[placeholder*="手机"], input[placeholder*="邮箱"], input[type="text"]').first();
    await emailInput.waitFor({ state: 'visible', timeout: 10000 });
    await emailInput.fill(email);

    console.log('Filling password...');
    const pwInput = page.locator('input[type="password"]').first();
    await pwInput.waitFor({ state: 'visible', timeout: 10000 });
    await pwInput.fill(password);

    // Step 3: Click login button (text varies by locale)
    console.log('Clicking login button...');
    // Dump buttons for debugging
    const btns = await page.evaluate(() => {
      return [...document.querySelectorAll('[role="button"]')].map(el => el.textContent?.trim().slice(0, 40));
    });
    console.log('Buttons on page:', JSON.stringify(btns));
    const loginBtn = page.locator('[role="button"]').filter({ hasText: /^(登录|Log [Ii]n|Sign [Ii]n)$/ });
    await loginBtn.click({ timeout: 10000 });

    // Step 4: Wait for navigation away from sign_in
    console.log('Waiting for navigation...');
    try {
      await page.waitForURL(url => !url.toString().includes('sign_in'), {
        timeout: Math.min(remaining(), 30000),
      });
    } catch {
      // Check for error messages on the page
      const errorText = await page.evaluate(() => {
        const toast = document.querySelector('.ds-toast, [class*="toast"], [class*="error"], [class*="message"]');
        return toast?.textContent?.trim() || null;
      });
      if (errorText) {
        console.log(`BLOCKED: Error message on page: "${errorText}"`);
      } else {
        console.log('BLOCKED: Still on sign_in page after submit, no error text found');
      }
      await page.screenshot({ path: resolve(__dirname, 'poc-login-result.png'), fullPage: true });
      await context.close();
      process.exit(2);
    }
  }

  // Step 5: Check for anti-automation defenses post-login
  const currentUrl = page.url();
  console.log(`\nPost-login URL: ${currentUrl}`);

  // Check for verification/CAPTCHA pages
  if (currentUrl.includes('verify') || currentUrl.includes('captcha')) {
    console.log('BLOCKED: Verification/CAPTCHA page detected');
    await page.screenshot({ path: resolve(__dirname, 'poc-login-result.png'), fullPage: true });
    await context.close();
    process.exit(2);
  }

  // Step 6: Look for the chat composer (success signal)
  console.log('Looking for chat composer...');
  let composerFound = false;
  try {
    // The composer is a textarea or contenteditable div
    const composer = page.locator('textarea, [contenteditable="true"]').first();
    await composer.waitFor({ state: 'visible', timeout: Math.min(remaining(), 15000) });
    composerFound = true;
    console.log('SUCCESS: Chat composer found!');
  } catch {
    console.log('WARNING: Composer not found within timeout');
    // Check what page we're actually on
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500));
    console.log(`Page body preview: ${bodyText}`);
  }

  // Step 7: Extra viability check - query DOM elements
  if (composerFound) {
    console.log('\n--- Extra viability checks ---');
    const hashDivCount = await page.evaluate(
      () => document.querySelectorAll('div[class^="_"]').length
    );
    console.log(`div[class^="_"] count: ${hashDivCount}`);

    // Check message list container
    const hasMsgContainer = await page.evaluate(() => {
      // Common patterns for message containers
      const candidates = document.querySelectorAll('[class*="message"], [class*="chat"], [class*="conversation"]');
      return candidates.length;
    });
    console.log(`Message/chat/conversation containers: ${hasMsgContainer}`);
  }

  // Save final screenshot
  await page.screenshot({ path: resolve(__dirname, 'poc-login-result.png'), fullPage: true });
  console.log('\nScreenshot saved to tools/poc-login-result.png');

  // Verdict
  console.log('\n========================================');
  if (composerFound) {
    console.log('VERDICT: YES — Playwright can log in unattended');
  } else {
    console.log('VERDICT: PARTIAL — Logged in but composer not confirmed');
  }
  console.log(`Final URL: ${page.url()}`);
  console.log('========================================');

} catch (err) {
  console.error(`ERROR: ${err.message}`);
  await page.screenshot({ path: resolve(__dirname, 'poc-login-result.png') }).catch(() => {});
  process.exit(1);
} finally {
  await context.close();
}

import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

await page.goto('https://chat.deepseek.com/sign_in', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);

// Screenshot the login page
await page.screenshot({ path: 'tools/recon-sign-in.png', fullPage: true });

// Dump all input elements
const inputs = await page.evaluate(() => {
  const els = document.querySelectorAll('input, button, [role="checkbox"], [role="button"]');
  return [...els].map(el => ({
    tag: el.tagName,
    type: el.type,
    placeholder: el.placeholder,
    name: el.name,
    id: el.id,
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    text: el.textContent?.trim().slice(0, 80),
    className: el.className?.slice(0, 60),
  }));
});

console.log('=== Form elements ===');
for (const inp of inputs) {
  console.log(JSON.stringify(inp));
}

// Also check for any Cloudflare challenge
const cfChallenge = await page.$('#challenge-running, #challenge-form, .cf-challenge');
if (cfChallenge) console.log('!!! CLOUDFLARE CHALLENGE DETECTED !!!');

const pageUrl = page.url();
console.log('Page URL:', pageUrl);

await browser.close();

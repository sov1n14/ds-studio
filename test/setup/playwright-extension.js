import { test as base, chromium } from '@playwright/test';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '..', '..');

const CHAT_FIXTURE_UUID = path.resolve(__dirname, '../fixtures/chat-fixtures/chat-with-uuid.html');
const CHAT_FIXTURE_NEW = path.resolve(__dirname, '../fixtures/chat-fixtures/chat-new.html');

export const test = base.extend({
    context: async ({}, use) => {
        const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsstudio-pw-'));
        const ctx = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            args: [
                `--disable-extensions-except=${EXTENSION_PATH}`,
                `--load-extension=${EXTENSION_PATH}`,
                '--no-first-run',
                '--no-default-browser-check',
            ],
        });
        // Intercept chat.deepseek.com requests and serve local fixture HTML.
        // URLs with a UUID path segment (/a/chat/s/<uuid>) get chat-with-uuid.html;
        // all others (new chat, /a/chat/s) get chat-new.html.
        await ctx.route('https://chat.deepseek.com/**', (route) => {
            const url = route.request().url();
            const hasUuid = /\/a\/chat\/s\/[0-9a-f-]{8,}/.test(url);
            const fixturePath = hasUuid ? CHAT_FIXTURE_UUID : CHAT_FIXTURE_NEW;
            route.fulfill({
                status: 200,
                contentType: 'text/html',
                body: fs.readFileSync(fixturePath, 'utf8'),
            });
        });
        await use(ctx);
        await ctx.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
    },

    extensionId: async ({}, use) => {
        const manifest = JSON.parse(
            fs.readFileSync(path.resolve(EXTENSION_PATH, 'manifest.json'), 'utf8')
        );
        const keyBuffer = Buffer.from(manifest.key.replace(/\s/g, ''), 'base64');
        const hash = crypto.createHash('sha256').update(keyBuffer).digest();
        let extensionId = '';
        for (let i = 0; i < 16; i++) {
            extensionId += String.fromCharCode(97 + (hash[i] >> 4));
            extensionId += String.fromCharCode(97 + (hash[i] & 0xf));
        }
        await use(extensionId);
    },

    popupPage: async ({ context, extensionId }, use) => {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
        await use(page);
        await page.close();
    },
});

export const expect = base.expect;

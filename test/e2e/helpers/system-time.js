// 系統時間行（docs/spec/04-features.md 第 19 節）：`Current Time: yyyy/mm/dd hh:mm:ss (UTC±hh:mm)`，獨立成行並位於送出內容的最前面。

import { expect } from '@playwright/test';

const TIME_LINE = /^Current Time: (\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2}) \(UTC([+-])(\d{2}):(\d{2})\)\n+/;
// 時間戳記只到整秒，因此送出期間產生的戳記最多可早於送出開始時間一秒。
const CLOCK_SLACK_MS = 1_000;

/** 執行 `send`（它解析出送出的提示詞），並一併解析送出發生的時間窗（epoch 毫秒）與頁面的 UTC 偏移分鐘數。 */
export async function timedSend(page, send) {
    const offsetMinutes = await page.evaluate(() => -new Date().getTimezoneOffset());
    const startedAt = Date.now();
    const prompt = await send();
    return { prompt, startedAt, endedAt: Date.now(), offsetMinutes };
}

/** 斷言 `prompt` 以文件記載的時間行開頭，時間落在送出時間窗內並使用頁面時區；解析出時間行之後的其餘內容。 */
export function expectTimeLine({ prompt, startedAt, endedAt, offsetMinutes }) {
    const match = TIME_LINE.exec(prompt);
    expect(match, `the prompt opens with "Current Time: yyyy/mm/dd hh:mm:ss (UTC±hh:mm)" on its own line; got ${JSON.stringify(prompt.slice(0, 80))}`).not.toBeNull();
    const [line, year, month, day, hour, minute, second, sign, offsetHours, offsetMins] = match;
    const statedOffset = (sign === '-' ? -1 : 1) * (Number(offsetHours) * 60 + Number(offsetMins));
    expect(statedOffset, 'the stated UTC offset is the local timezone offset').toBe(offsetMinutes);
    const stampedAt = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) - statedOffset * 60_000;
    expect(stampedAt, `the stated time ${line.trim()} is the moment of the send`).toBeGreaterThanOrEqual(startedAt - CLOCK_SLACK_MS);
    expect(stampedAt, `the stated time ${line.trim()} is the moment of the send`).toBeLessThanOrEqual(endedAt);
    return prompt.slice(line.length);
}

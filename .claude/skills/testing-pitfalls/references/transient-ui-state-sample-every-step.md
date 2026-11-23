# Transient UI State: Sample Every Step, Not Only the Settled Result

**Cause**: through v4.39.24, fixed in v4.39.25 — on a fresh load of a chat bound to prompt group B, the overlay rendered the stored global `activePresetId` A synchronously at overlay start and showed B only after an async settings read. On SPA navigation from a chat bound to A to a chat bound to B, the overlay kept showing A until the async reads finished. Every existing test asserted only the shown value after settling, so a wrong group shown for a moment never failed a test.

**Solution**: the overlay starts with the group resolved for the chat in the URL, and navigation updates the overlay at once, except while a new chat is waiting for its uuid. `test/unit/content-script.overlay-flash.scenario.spec.js` wraps `chrome.storage.*.get` with a 5 ms delay and samples the shown group at every storage delivery. On pre-fix code 2 of 3 cases failed with "chat X is bound to B, so the overlay must never show A ... expected [ …(21) ] to deeply equal []".

**Prevention**: UI that resolves its value through async reads (prompt group label, toggle state, width) MUST have a test that records the shown value at every async step, from first render through settling, and asserts that the record holds no wrong value. A final-state assertion alone is not enough. Delay the boundary reads so intermediate renders become observable, and cover each entry path: fresh load and SPA navigation.

**Check**: For each async-resolved UI value, confirm a test samples it at each storage delivery or render and asserts on the whole sample list. Then make the first render use the stored global default and confirm that test goes red.

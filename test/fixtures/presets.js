/**
 * Factory functions for creating PromptPreset objects in tests.
 */

/**
 * Create a preset with the given overrides.
 */
export function createPreset(overrides = {}) {
    const now = Date.now();
    return {
        id: overrides.id || 'preset-' + now,
        name: overrides.name || 'Test Preset',
        content: overrides.content || 'You are a helpful assistant.',
        createdAt: overrides.createdAt || now,
        updatedAt: overrides.updatedAt || now,
    };
}

/**
 * Create a list of preset objects, each with auto-generated IDs.
 */
export function createPresets(count, baseOverrides = {}) {
    return Array.from({ length: count }, (_, i) =>
        createPreset({ ...baseOverrides, id: `preset-${i}`, name: `Preset ${i}` })
    );
}

/**
 * Create a preset with a specific age (updatedAt set to `now - ageMs`).
 */
export function createAgedPreset(overrides = {}, ageMs = 3600000) {
    const now = Date.now();
    return createPreset({
        ...overrides,
        updatedAt: now - ageMs,
    });
}

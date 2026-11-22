// The manifest of the extension copy the offline E2E lane loads (see offline-lane.js).

/**
 * Returns a copy of `manifest` whose optional permissions are required ones.
 * A fresh browser profile holds no optional permission, so without this `chrome.permissions.contains` answers false and turning a popup toggle on opens a permission prompt.
 * The input is not changed.
 */
export function grantOptionalPermissions(manifest) {
    const { optional_permissions: optional = [], ...rest } = manifest;
    if (optional.length === 0) return structuredClone(rest);
    return structuredClone({ ...rest, permissions: [...new Set([...(rest.permissions ?? []), ...optional])] });
}

import * as vegaLite from "vega-lite";

export function extractBase64(dataUrl: string | null): string | null {
    if (!dataUrl) return null;
    if (typeof dataUrl !== 'string') return null;
    // strip data:image/...;base64, prefix if present
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    if (match) return match[2];
    // if it already looks like base64, return it
    const maybe = dataUrl.trim();
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(maybe)) return maybe.replace(/\r?\n/g, '');
    return null;
}

export function validateVegaLiteSpec(spec: unknown): { valid: boolean; errors: string[] } {
    try {
        // Basic shape guard first
        if (!spec || typeof spec !== "object") {
            return { valid: false, errors: ["Spec must be an object"] };
        }

        // Official validation path
        vegaLite.compile(spec as any);

        return { valid: true, errors: [] };
    } catch (err) {
        return {
            valid: false,
            errors: [err instanceof Error ? err.message : String(err)],
        };
    }
}

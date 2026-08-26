import * as vegaLite from "vega-lite";
import {logger, Warn} from "vega";

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

function validateVegaLiteSpec(specString: string) {
    const warnings: string[] = [];
    const errors: string[] = [];

    let spec;
    try {
        spec = JSON.parse(specString);
    } catch (err) {
        return {
            valid: false,
            errors: [`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`],
            warnings
        };
    }

    const log = logger(Warn);
    log.warn = (...args) => {
        warnings.push(args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
        return log;
    };

    try {
        vegaLite.compile(spec, { logger: log });
        return { valid: errors.length === 0, errors, warnings };
    } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        return { valid: false, errors, warnings };
    }
}

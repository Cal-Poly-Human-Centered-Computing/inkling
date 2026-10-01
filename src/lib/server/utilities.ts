import * as vegaLite from "vega-lite";
import {logger, Warn} from "vega";

export function validateVegaLiteSpec(specString: string) {
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

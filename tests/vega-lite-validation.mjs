import * as vegaLite from "vega-lite";
import { logger, Warn } from "vega";

function validateVegaLiteSpec(specString) {
    const warnings = [];
    const errors = [];

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
    };

    try {
        vegaLite.compile(spec, { logger: log });
        return { valid: errors.length === 0, errors, warnings };
    } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        return { valid: false, errors, warnings };
    }
}

const validSpec1 = {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    data: { values: [{ a: "A", b: 28 }, { a: "B", b: 55 }] },
    mark: "bar",
    encoding: {
        x: { field: "a", type: "nominal" },
        y: { field: "b", type: "quantitative" }
    }
};

const validSpec2 = {
    mark: "bar",
    encoding: {
        x: { field: "a", type: "nominal" },
        y: { field: "b", type: "quantitative" }
    }
};

const invalidMarkTypeObject = {
    data: { values: [{ a: "A", b: 1 }] },
    mark: 123,
    encoding: {
        x: { field: "a", type: "nominal" },
        y: { field: "b", type: "quantitative" }
    }
};

const invalidTopLevelArray = [
    { mark: "bar" }
];

const invalidMissingMarkType = {
    data: { values: [{ a: "A", b: 1 }] },
    encoding: {
        x: { field: "a", type: "nominal" },
        y: { field: "b", type: "quantitative" }
    }
};

const invalidChannelDefType = {
    data: { values: [{ a: "A", b: 1 }] },
    mark: "bar",
    encoding: {
        x: "a", // NOTE: this should be an object; however, the vega-lite compiler treats strings as iterable objects, so this is not a valid spec but will not throw an error
        y: { field: "b", type: "quantitative" }
    }
};

const invalidFieldType = {
    data: { values: [{ a: "A", b: 1 }] },
    mark: "bar",
    encoding: {
        x: { field: 42, type: "nominal" },
        y: { field: "b", type: "quantitative" }
    }
};

const invalidAggregate = {
    data: { values: [{ a: "A", b: 1 }] },
    mark: "bar",
    encoding: {
        x: { field: "a", type: "nominal" },
        y: { field: "b", type: "quantitative", aggregate: "totallyNotReal" }
    }
};

const invalidDataValuesType = {
    data: { values: { a: "A", b: 1 } },
    mark: "point",
    encoding: {
        x: { field: "a", type: "nominal" },
        y: { field: "b", type: "quantitative" }
    }
};

const invalidTransformType = {
    data: { values: [{ a: "A", b: 1 }] },
    transform: { filter: "datum.b > 0" },
    mark: "point",
    encoding: {
        x: { field: "a", type: "nominal" },
        y: { field: "b", type: "quantitative" }
    }
};

const invalidLayerType = {
    layer: {
        mark: "point",
        encoding: {
            x: { field: "a", type: "nominal" },
            y: { field: "b", type: "quantitative" }
        }
    },
    data: { values: [{ a: "A", b: 1 }] }
};

const invalidLayerItem = {
    layer: [
        { data: { values: [{ a: "A", b: 1 }] } }
    ]
};

const invalidRepeatType = {
    repeat: 3,
    spec: {
        mark: "bar",
        encoding: {
            x: { field: { repeat: "column" }, type: "nominal" },
            y: { field: "value", type: "quantitative" }
        }
    }
};

for (const [name, spec] of [
    ["validSpec1", JSON.stringify(validSpec1)],
    ["validSpec2", JSON.stringify(validSpec2)],
    ["invalidMarkTypeObject", JSON.stringify(invalidMarkTypeObject)],
    ["invalidTopLevelArray", JSON.stringify(invalidTopLevelArray)],
    ["invalidMissingMarkType", JSON.stringify(invalidMissingMarkType)],
    ["invalidChannelDefType", JSON.stringify(invalidChannelDefType)],
    ["invalidFieldType", JSON.stringify(invalidFieldType)],
    ["invalidAggregate", JSON.stringify(invalidAggregate)],
    ["invalidDataValuesType", JSON.stringify(invalidDataValuesType)],
    ["invalidTransformType", JSON.stringify(invalidTransformType)],
    ["invalidLayerType", JSON.stringify(invalidLayerType)],
    ["invalidLayerItem", JSON.stringify(invalidLayerItem)],
    ["invalidRepeatType", JSON.stringify(invalidRepeatType)],
    ["notJson", "hello"],
]) {
    const result = validateVegaLiteSpec(spec);
    console.log(`\n=== ${name} ===`);
    console.log(JSON.stringify(result, null, 2));
}
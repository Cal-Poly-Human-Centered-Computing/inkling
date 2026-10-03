const prompts = {
    // --- New pipelines (see the plan in from-scratch-pipeline.md); not used yet ---

    // Generating a spec from a sketch on a blank canvas
    fromScratch: {
        // Role, Vega-Lite guidance, chat > sketch > spec precedence, never include `data`
    system: `Your job is to generate a Vega-Lite specification based on a user's inputs. The inputs will include any or all of the following: a chat instruction, a sketch image, and the user's current Vega-Lite spec. In addition, you will be given the schema of the user's data set (column names and data types). Instructions in any of the inputs may complement or reference instructions in other inputs, so consider them all together. If there are contradictions within the inputs, resolve conflicting elements with the following precedence: chat > sketch > current spec. Never include the \`data\` field in the output spec. Placeholder data will be generated in a later verification step, and the client's real data is in their browser; in both cases, a later step will inject the \`data\` field. Fields in the output specification must match the provided column names, or must come from transformations that are applied within the spec. Target Vega-Lite version 6. The output spec should always include the schema string "https://vega.github.io/schema/vega-lite/v6.json".`,
        // First turn: the flowchart questions about the sketch, then the spec. Inputs (image, code, chat, columns) are added around it.
    withSketch: `
The image is a rough, hand-drawn sketch of a data visualization, drawn on a blank canvas. Before writing the spec, work through the questions below about the sketch and record your answers in \`observations\`, in plain language rather than Vega-Lite terms. Skip any question that does not apply. Then write the spec in \`spec\`, based on your answers and on any other inputs.
      
Because the sketch is hand-drawn, read it for intent rather than precision: wobbly lines, uneven spacing, and stroke thickness or colour are not meaningful unless they clearly distinguish one element from another. Do not mistake axis lines, tick marks, or gridlines for data marks. Text in the sketch (axis titles, legend entries, chart titles) will often approximate a column name rather than match it exactly; map it to the closest column in \`<columns>\`.

If a <chat_instruction> or <current_spec> is present, use it while answering the questions as well as when writing the spec: the chat may clarify what part of the sketch means, and the current spec may already contain elements the sketch builds on.

1. How many charts are drawn? Count the separate charts in the sketch. Each chart has its own plotting area, usually with its own axes. Several sets of marks drawn on the same axes form one chart with layers, not several charts; layers are covered in the next question. Legends, titles and notes are not separate charts. If there is more than one chart, describe how they are arranged (side by side, stacked vertically, or in a grid) and refer to them in reading order, as Chart 1, Chart 2 and so on, for the rest of your answers. If there is only one chart, skip the composition question at the end.
2. What layers does each chart have? A layer is one set of marks within a chart’s plotting area. Signs of more than one layer include different mark types on the same axes (for example bars with a line over them), a reference line or text annotation drawn over the data, or groups of marks that show different quantities. Be careful with colour: marks in several colours that correspond to categories of one field (often shown in a legend) are usually a single layer with a colour encoding, not several layers.
3. For each layer, describe:
Mark: the kind of mark (bar, line, point, area, rule, text, and so on). If no standard mark fits, describe the shape; it may need to be built by combining simpler marks in layers.
Fields: which columns the layer uses, based on axis titles, legend entries and chart titles, mapped to <columns>.
Encodings: which visual properties vary with the data (x or y position, colour, size, shape, opacity, and so on), which field each one represents, and that field’s type. Properties that are the same for every mark are styling, not encodings.
Transforms: whether the data has been transformed. Compare the sketch’s text with the column names: for example, a title like “Average price” suggests a mean of a price column, “Number of orders” suggests a count, an axis grouped into ranges suggests binning, “by month” suggests a time unit, and a trend line over points suggests a regression. Only include a transform when the sketch indicates one.
4. If there is more than one chart, how are they combined? Work through these in order:
If every chart has the same marks and encodings and each shows a different subset of the data, the charts are a facet. Typically the panels share axis titles and each is labelled with a category value. Facet on the field those labels come from, using rows, columns or a wrapped grid to match the arrangement.
If every chart has the same marks and encodings but each shows the whole dataset with different fields, the charts are a repeat. Typically the panels have the same structure but different axis titles. Repeat over those fields.
Otherwise, concatenate the charts in the arrangement described in question 1: \`hconcat\` for side by side, \`vconcat\` for stacked, and \`concat\` with \`columns\` for a grid.
5. Output. In \`observations\`, give your answers to the questions above in very brief plain language. Leave out questions you skipped. Where the sketch is ambiguous, choose the most likely reading and say in a few words what you assumed. In \`spec\`, write the complete Vega-Lite spec that implements the instructions specified by your answers, any chat instruction, and the current spec.
    `,
        // Turn 1 when there is no sketch (chat and/or code only): a short prompt, no flowchart questions
    withoutSketch: `
The provided inputs, containing a <chat_instruction>, <current_spec>, or both, describe a desired Vega-Lite specification. Produce the specification based on the provided instructions and the columns in <columns>. The <current_spec> may be an incomplete or broken spec that must be completed based on <chat_instruction>, or an old spec that must be replaced based on <chat_instruction>. Columns in <chat_instruction> will often approximate a column name rather than match it exactly; map them to the closest _plausible_ column in <columns>. If nothing matches, say that in \`observations\`. Put the resulting specification in \`spec\`. Very briefly note any assumptions made about the intended chart in \`observations\`.
`
    },

    // Checking a candidate spec. Compile and runtime checks are code; only the visual review and the retry turns need prompts.
    verify: {
        // The separate review call: sketch vs spec, structure only; any chat instruction may override the sketch
      reviewSystem: `
Your job is to check if a candidate Vega-Lite specification matches a user's instructions. The user's instructions are provided through an image, optionally accompanied by a chat instruction. You are checking for structural similarity, i.e., does the specification contain ONLY the marks, visual encodings, transformations, layers, facets, repeats, or concatenations that are present in the provided image or described in the provided chat instruction? The chat instruction may refer to elements from the image. The image may contain rough hand-drawn sketch marks, possibly drawn alongside a rendered visualization. For this reason sketch marks should be interpreted for intent rather than precision. Column labels in the sketch or chat will only approximate existing column names, so may not match exactly the field names seen in the specification. You will only report a verdict and list any issues if present. If the chat instruction and image contradict each other, favour the chat instruction. Note that the \`data\` property will not be present in the specification; the data injected in a later step.
`,
      review: `
Check in both directions: everything the sketch or <chat_instruction> calls for should be in <spec>, and <spec> should not add structure that neither of them calls for. Do not flag styling such as colours, sizes or exact positions unless they show a data field, and do not flag defaults that Vega-Lite fills in, such as axis titles. Set matches to true if there are no structural differences. Otherwise set it to false and list each difference as one item in issues, saying what the sketch or chat calls for and what the specification does instead, specifically enough that someone could fix the specification from that item alone.`,
        // Retry turns in the generation conversation (shared by fromScratch and refine)
      fixErrors: `
The previous specification caused errors (e.g., invalid JSON, invalid Vega-Lite, references to non-existent columns). The errors are provided in <errors>. Consider the errors and revise the specification, making the smallest changes required to address the errors, while still preserving the user's intent (gleaned from the user's inputs). Return the revised specification in \`spec\`.
`,        // the latest compile/runtime errors follow it
        reviseFromReview: "TODO"  // the reviewer's issues follow it
    },

    // --- Old prompts, still used by the current pipelines. Delete each when its replacement lands. ---

    systemPrompt: "You are an expert in data visualization and Vega-Lite.",
    matchColumnNames: `Given the above COLUMN_NAMES, update the above Vega-Lite specification to use the closest matching column names as the field names.
ONLY modify the field names in the Vega-Lite specification, do not modify any other part of the spec. If there are multiple columns that could match a field name, choose the one that is most likely to be correct based on the context of the visualization.
Output only the updated Vega-Lite specification.`,

    reviewSpec: `Does this Vega-Lite spec accomplish what it's intended to do? If not, modify it. 
    Also consider any issues that will prevent the visualization components from displaying properly. 
    Only make changes that are necessary to correct these issues. `,

    compareSpecToAnnotations: `The attached image is a rendering of a Vega-Lite specification, with annotations (pen strokes and/or typed text) an author has made to indicate their desired changes.
    The above Vega-Lite spec is the resulting specification, updated with the changes indicated by the annotations.
    Your job is to determine: Does the above spec accurately represent the annotated visualization? 
    In other words, ignoring specific styling details like color and size, are all components that are present in the sketch also present in the spec, and vice versa? 
    Also consider any issues that will prevent the components in the Vega-Lite spec from displaying properly.
    If there are issues, modify the spec as needed. 
    
    OUTPUT RULES:
    If you modified the spec, output ONLY the spec (no explanations).
    If you did not modify the spec, output 'NO CHANGES' and nothing else.`,

    compareSpecToInstructions: `Does the above Vega-Lite spec correctly implement the given instructions?
    Also consider any issues that will prevent the components in the Vega-Lite spec from displaying properly.
    If not, modify it as needed. 
    
    OUTPUT RULES:
    If you modified the spec, output ONLY the spec (no explanations).
    If you did not modify the spec, output 'NO CHANGES' and nothing else.`,

    analyzeAnnotatedSketch: `The attached image is a rendering of the above Vega-Lite spec, with annotations on top. Your job is to determine the author's intended modifications, and translate those into updates to the spec.
To do this, consider what additions or edits have been made in the image (can be hand-drawn pen strokes and/or typed text) that are not present in the spec. 
Do not be strict when interpreting detail in the hand-drawn annotated strokes (curvature, thickness, etc).
For elements already present in the spec, assume styling (color, size, etc.) should not be changed, unless it has been explicitly annotated. 
When adding new elements, assume default styling is desired unless explicitly indicated otherwise. Make the simplest changes possible while accomplishing the goal of the annotations.
For any new field names, use the closest match in the column names provided below.        
    
OUTPUT RULES:
Respond with only the corresponding spec and nothing else. If the intention of the annotations cannot be determined, do not make any changes.
If no changes were made to the spec, return the original spec and nothing else.`,

    applyChatMessage: `When implementing the above instructions:
    - Apply the smallest possible structural change(s) that satisfy the instructions.
    - Preserve unrelated transforms/encodings/scales/config as much as possible. Do NOT apply any unnecessary changes that were not specified.
    - Prefer editing existing properties over introducing new layers/transforms.
    - If you introduce layers/transforms/concatenation to add something new, move the existing top-level view down into the layers to avoid duplicating code.
    - For elements already present in the spec, assume styling (color, size, etc.) should not be changed, unless it has been explicitly annotated. 
    - When adding new elements, assume default styling is desired unless explicitly indicated otherwise. 
    
    For any new field names, use the closest match in the column names provided below.
    
    Respond with only the updated spec. If the intention of the instructions cannot be determined, respond with only the original spec, unchanged.`
};

export default prompts;
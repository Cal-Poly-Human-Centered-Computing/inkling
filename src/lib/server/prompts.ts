// Shared prompt pieces. Prompts below are composed from these, so each piece of logic is written once.

// Role, Vega-Lite guidance, chat > sketch > spec precedence, never include `data`. Used by fromScratch and refine.
const system = `Your job is to generate or update a Vega-Lite specification based on a user's inputs. The inputs will include any or all of the following: a chat instruction, a sketch image, and the user's current Vega-Lite spec. In addition, you will be given the schema of the user's data set (column names and data types). Instructions in any of the inputs may complement or reference instructions in other inputs, so consider them all together. If there are contradictions within the inputs, resolve conflicting elements with the following precedence: chat > sketch > current spec. Never include the \`data\` field in the output spec. Placeholder data will be generated in a later verification step, and the client's real data is in their browser; in both cases, a later step will inject the \`data\` field. Fields in the output specification must match the provided column names, or must come from transformations that are applied within the spec. Target Vega-Lite version 6. The output spec should always include the schema string "https://vega.github.io/schema/vega-lite/v6.json".`;

// How to read hand-drawn strokes. Used by fromScratch.withSketch and refine.withSketch.
const readingSketch = `Because the sketch is hand-drawn, read it for intent rather than precision: wobbly lines, uneven spacing, and stroke thickness or colour are not meaningful unless they clearly distinguish one element from another. Do not mistake axis lines, tick marks, or gridlines for data marks. Text in the sketch (axis titles, legend entries, chart titles) will often approximate a column name rather than match it exactly; map it to the closest column in \`<columns>\`.`;

// Questions for analysing a whole figure: charts, layers, per-layer details, composition. Used by fromScratch.withSketch and refine.withSketch.
const figureQuestions = `1. How many charts are drawn? Count the separate charts in the sketch. Each chart has its own plotting area, usually with its own axes. Several sets of marks drawn on the same axes form one chart with layers, not several charts; layers are covered in the next question. Legends, titles and notes are not separate charts. If there is more than one chart, describe how they are arranged (side by side, stacked vertically, or in a grid) and refer to them in reading order, as Chart 1, Chart 2 and so on, for the rest of your answers. If there is only one chart, skip the composition question at the end.
2. What layers does each chart have? A layer is one set of marks within a chart’s plotting area. Signs of more than one layer include different mark types on the same axes (for example bars with a line over them), a reference line or text annotation drawn over the data, or groups of marks that show different quantities. Be careful with colour: marks in several colours that correspond to categories of one field (often shown in a legend) are usually a single layer with a colour encoding, not several layers.
3. For each layer, describe:
Mark: the kind of mark (bar, line, point, area, rule, text, and so on). If no standard mark fits, describe the shape; it may need to be built by combining simpler marks in layers.
Fields: which columns the layer uses, based on axis titles, legend entries and chart titles, mapped to <columns>.
Encodings: which visual properties vary with the data (x or y position, colour, size, shape, opacity, and so on), which field each one represents, and that field’s type. Properties that are the same for every mark are styling, not encodings.
Transforms: whether the data has been transformed. Compare the sketch’s text with the column names: for example, a title like “Average price” suggests a mean of a price column, “Number of orders” suggests a count, an axis grouped into ranges suggests binning, “by month” suggests a time unit, and a trend line over points suggests a regression. Only include a transform when the sketch indicates one.
4. If there is more than one chart, how are they combined? Work through these in order:
If every chart has the same marks and encodings and each shows a different subset of the data, the charts are a facet. Typically the panels share axis titles and each is labelled with a category value. Facet on the field those labels come from, using rows, columns or a wrapped grid to match the arrangement.
If every chart has the same marks and encodings but each shows the whole dataset with different fields, the charts are a repeat. Typically the panels have the same structure but different axis titles. Repeat over those fields.
Otherwise, concatenate the charts in the arrangement described in question 1: \`hconcat\` for side by side, \`vconcat\` for stacked, and \`concat\` with \`columns\` for a grid.`;

// How to edit an existing spec. Seeded from the old applyChatMessage rules. Used by refine.
const editingRules = `- Apply the smallest possible structural change(s) that satisfy the instructions.
- Preserve unrelated transforms/encodings/scales/config as much as possible. Do NOT apply any unnecessary changes that were not specified.
- Prefer editing existing properties over introducing new layers/transforms.
- If you introduce layers/transforms/concatenation to add something new, move the existing top-level view down into the layers to avoid duplicating code.
- For elements already present in the spec, assume styling (color, size, etc.) should not be changed, unless it has been explicitly annotated.
- When adding new elements, assume default styling is desired unless explicitly indicated otherwise.`;

const prompts = {
  // The system prompt for generating or revising a spec (shared by the generation pipelines)
  system,

  // --- New pipelines (see the plan in from-scratch-pipeline.md) ---

  // Generating a spec from a sketch on a blank canvas
  fromScratch: {
    // First turn: the flowchart questions about the sketch, then the spec. Inputs (image, code, chat, columns) are added around it.
    withSketch: [
      `The image is a rough, hand-drawn sketch of a data visualization, drawn on a blank canvas. Before writing the spec, work through the questions below about the sketch and record your answers in \`observations\`, in plain language rather than Vega-Lite terms. Skip any question that does not apply. Then write the spec in \`spec\`, based on your answers and on any other inputs.`,
      readingSketch,
      `If a <chat_instruction> or <current_spec> is present, use it while answering the questions as well as when writing the spec: the chat may clarify what part of the sketch means, and the current spec may already contain elements the sketch builds on.`,
      `${figureQuestions}\n5. Output. In \`observations\`, give your answers to the questions above in very brief plain language. Leave out questions you skipped. Where the sketch is ambiguous, choose the most likely reading and say in a few words what you assumed. In \`spec\`, write the complete Vega-Lite spec that implements the instructions specified by your answers, any chat instruction, and the current spec.`
    ].join('\n\n'),
    // Turn 1 when there is no sketch (chat and/or code only): a short prompt, no flowchart questions
    withoutSketch: `
The provided inputs, containing a <chat_instruction>, <current_spec>, or both, describe a desired Vega-Lite specification. Produce the specification based on the provided instructions and the columns in <columns>. The <current_spec> may be an incomplete or broken spec that must be completed based on <chat_instruction>, or an old spec that must be replaced based on <chat_instruction>. Columns in <chat_instruction> will often approximate a column name rather than match it exactly; map them to the closest _plausible_ column in <columns>. If nothing matches, say that in \`observations\`. Put the resulting specification in \`spec\`. Very briefly note any assumptions made about the intended chart in \`observations\`.
`
  },

  // Changing a rendered chart: from annotations drawn on or beside it (plus any chat), or from chat only
  refine: {
    // Annotations: the combined image (chart + strokes), code, chat and columns come before these instructions
    withSketch: [
      "The image shows the chart rendered from <current_spec>, with the user’s annotations accompanying it: hand-drawn strokes, typed text, or both. The annotations describe changes the user wants made to that chart. Use <current_spec> to tell the two apart: anything in the image that the current spec would not draw was added by the user. In the guidance that follows, 'the sketch' means these annotations, not the rendered chart. Work out what change each annotation asks for, using the <chat_instruction>, if present, to clarify what an annotation means, and apply those changes to <current_spec>. Note that annotations may be desired chart elements, or may be expressions of intent, like an arrow indicating that something should be moved, or a circle around an element that is referenced in the <chat_instruction>.", // work out the intended changes from annotations
      readingSketch,
      editingRules,
      `If the annotations draw a new chart, or change how charts are arranged or combined (for example, a second chart drawn beside the existing one), work through the questions below for the new charts before writing the spec, and record your answers in observations. When working out how the charts are combined, include the existing rendered chart or charts along with the new ones. If the annotations only change the existing chart, for example by adding a trend line, changing a mark or an encoding, or adding a title, skip these questions entirely.\n${figureQuestions}`, // answer the questions only for new charts drawn in the annotations, or changes to how charts are combined
      'Output. In `observations`, describe each annotation in a few words, followed by the change you made for it, for example “circle around the 2019 bar: highlighted that bar”. If you worked through the questions above, add your answers after that list. Where an annotation is ambiguous, choose the most likely reading and say in a few words what you assumed. If you cannot tell what an annotation asks for, leave the specification unchanged for that annotation and say so in `observations`. In `spec`, write the complete updated Vega-Lite specification, not just the changed parts.' // observations: each annotation and the change it was read as, plus assumptions; unclear intent: leave the spec unchanged and say so
    ].join('\n\n'),
    // Chat only, no image: code, chat and columns come before these instructions
    withoutSketch: [
      'The <chat_instruction> asks for changes to the chart described by <current_spec>, which the user can currently see rendered. Work out what the instruction asks for and apply it to <current_spec>. The instruction may refer to parts of the chart by how they look rather than by their names in the specification (for example, “the red bars” or “the line at the top”); use <current_spec> to work out which marks, encodings or fields it means. Column names in the instruction will often only approximate a column name; map them to the closest plausible column in <columns>.', // the <chat_instruction> asks for changes to the working chart in <current_spec>; apply them
      editingRules,
      'Output. In observations, say in a few words how you read the instruction and what you changed, for example “make it horizontal: swapped the x and y encodings”. Note any assumptions, such as which column you mapped a name to. If no column in <columns> plausibly matches one the instruction mentions, or you cannot tell what part of the instruction asks for, leave the specification unchanged for that part and say so in observations. In spec, write the complete updated Vega-Lite specification, not just the changed parts.' // observations: how the request was read, plus assumptions; unclear intent: leave the spec unchanged and say so. Then the complete updated spec
    ].join('\n\n')
  },

  // Checking a candidate spec. Compile and runtime checks are code; only the review and the retry turn need prompts.
  verify: {
    // The separate review call: sketch vs spec, structure only; any chat instruction may override the sketch
    reviewSystem: `
Your job is to check if a candidate Vega-Lite specification matches a user's instructions. The user's instructions are provided through an image, optionally accompanied by a chat instruction. You are checking for structural similarity, i.e., does the specification contain ONLY the marks, visual encodings, transformations, layers, facets, repeats, or concatenations that are present in the provided image or described in the provided chat instruction? The chat instruction may refer to elements from the image. The image may contain rough hand-drawn sketch marks, possibly drawn alongside a rendered visualization. For this reason sketch marks should be interpreted for intent rather than precision. Column labels in the sketch or chat will only approximate existing column names, so may not match exactly the field names seen in the specification. You will only report a verdict and list any issues if present. If the chat instruction and image contradict each other, favour the chat instruction. Note that the \`data\` property will not be present in the specification; the data injected in a later step.
`,
    review: `
Check in both directions: everything the sketch or <chat_instruction> calls for should be in <spec>, and <spec> should not add structure that neither of them calls for. Do not flag styling such as colours, sizes or exact positions unless they show a data field, and do not flag defaults that Vega-Lite fills in, such as axis titles. Set matches to true if there are no structural differences. Otherwise set it to false and list each difference as one item in issues, saying what the sketch or chat calls for and what the specification does instead, specifically enough that someone could fix the specification from that item alone.`,
    // Retry turn in the generation conversation (shared by fromScratch and refine)
    fixErrors: `
The previous specification caused errors (e.g., invalid JSON, invalid Vega-Lite, etc.). The errors are provided in <errors>. Consider the errors and revise the specification, making the smallest changes required to address the errors, while still preserving the user's intent (gleaned from the user's inputs). Return the revised specification in \`spec\`.
` // the latest compile/runtime errors follow it
  }
};

export default prompts;

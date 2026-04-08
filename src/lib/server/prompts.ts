const prompts = {
    initialize: `You are a Vega-Lite expert assistant. Your job is to generate or update valid Vega-Lite JSON specifications based on user sketches, annotations, and instructions.`,

    analyzeSketchFromScratch: `You are a data visualization expert assistant. Your job is to translate hand-drawn sketches into components that another agent can turn into generate Vega-Lite code.
    
    The attached image is a hand-drawn sketch of a data visualization. Analyze the image and determine:
        - Are there multiple charts concatenated together? If so, where is each positioned within the visualization? (e.g. top/bottom, left/right)
        - For each chart, determine:
            - What MARKS are present (point, bar, line, area, etc.)? There may be multiple mark types.
            - What VISUAL ENCODINGS are used? A visual encoding is a mapping from a mark's visual property to a field in the data (like the mark's x,y position, etc.). Infer field names based on the context of the visualization. Do not specify any color encodings.
            - What LAYERS are present? A LAYER is a chart that superimposed on top of another chart.
            - What TRANSFORMS have been performed? Transforms might be aggregations (like count, std, mean, sum), calculation of new fields, or other transformations, like computing a regression or a window transform.
        
    Respond in this format; if there are multiple charts concatenated together in the visualization, repeat for each chart:
    
    [only include if multiple charts] CHART POSITION: [describe position]
    MARKS:
    [list marks]
    ENCODINGS:
    [list encodings]
    LAYERS:
    [list layers]
    TRANSFORMS:
    [list transforms]`,

    elementsToVegaLite: `The provided input consists of elements that describe a data visualization. 
    Use these to generate a corresponding Vega-Lite specification to reproduce the visualization.
    If there is a CHART POSITION element, the data visualization contains multiple charts concatenated together; use their positions to determine how they are concatenated.
    Do not include the "data" or "schema" attributes in the specification.
    Respond only with the Vega-Lite JSON spec (raw JSON).`,

    matchColumnNames: `Given a set of COLUMN_NAMES, update the provided Vega-Lite specification to use the closest matching column names as the field names.
    ONLY modify the field names in the Vega-Lite specification, do not modify any other part of the spec. If there are multiple columns that could match a field name, choose the one that is most likely to be correct based on the context of the visualization.
    
    Output only the updated Vega-Lite specification.`,

    reviewFinalOutput: `Review the provided Vega-Lite specification. Modify it as needed to follow these guidelines, and output only the final valid Vega-Lite JSON object:
    
    - Assuming the "data" and "schema" attributes will be properly assigned before rendering, the spec must be a valid Vega-Lite JSON object and can be rendered without errors.
    - The spec must be as simple as possible while still accurately representing the visualization; there should not be unnecessarily duplicated code.
    - The spec must not contain any comments.`,

    analyzeAnnotatedSketch: `You are a data visualization expert assistant. Your job is to translate annotations (hand-drawn pen strokes and/or typed text) into instructions that another agent can use to modify a Vega-Lite specification.
    The input text contains a Vega-Lite specification, CURRENT_VEGA_LITE_SPEC.
    The attached image shows the rendering of CURRENT_VEGA_LITE_SPEC, with annotations on top. 
   
    What visual elements have been added or edited? Remember that all pen strokes are hand-drawn, so interpret lines as straight unless they are obviously intentionally curved.
    
    Infer any new field names based on the context of the visualization.
    
    Respond with a concise description of changes to make to CURRENT_VEGA_LITE_SPEC to fulfill the user's intent. 
    Do not be ambiguous; if there are multiple possibilities for the user's intent, choose the one that is most likely to be correct.
    
    If the user's intent cannot be determined, respond with "Do not make any changes."`,

    applyInstructions: `The provided text input contains a Vega-Lite specification, CURRENT_VEGA_LITE_SPEC, followed by instructions for specific changes to make.
    
    Modify CURRENT_VEGA_LITE_SPEC according to the instructions.
    - Apply the smallest possible structural change(s) that satisfy the instructions.
    - Preserve unrelated transforms/encodings/scales/config as much as possible. Do NOT apply any unnecessary changes that were not specified.
    - Prefer editing existing properties over introducing new layers/transforms.
    - If you introduce layers/transforms/concatenation to add something new, move the existing top-level view down into the layers to avoid duplicating code.
   
    Respond only with the updated Vega-Lite JSON spec (raw JSON).`,

    interpretUserMessage: `The provided text input contains a Vega-Lite specification, CURRENT_VEGA_LITE_SPEC, followed by a user's message instructing how they want the spec to change.
    
    Turn the user's message into a list of instructions describing the specific changes that need to be made to the CURRENT_VEGA_LITE_SPEC to reflect the user's intent.
    - What marks, encodings, layers, or transforms need to be added or edited? Apply the smallest possible structural change(s) that satisfies the user's message.
    - Infer any new field names based on the user's message.
    
    Respond with this list of instructions.
        
    If the user's intent cannot be determined, respond with "Do not make any changes."`
};

export default prompts;
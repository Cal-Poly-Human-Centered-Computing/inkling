const prompts = {
    initialize: `You are a Vega-Lite expert assistant. Your job is to generate or update valid Vega-Lite JSON specifications based on user sketches, annotations, and instructions.`,

    analyzeSketchFromScratch: `The attached image is a sketch of a data visualization.
  
    Analyze the image and determine:
        - Are there multiple charts concatenated together? If so, where is each positioned within the visualization? (e.g. top/bottom, left/right)
        - For each chart, determine:
            - What MARKS are present (point, bar, line, area, etc.)? There may be multiple mark types.
            - What VISUAL ENCODINGS are used? A visual encoding is a mapping from a mark's visual property to a field in the data (like the mark's color, x,y position, etc.). Infer field names based on the context of the visualization.
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

    elementsToVegaLite: `Below are elements that describe a data visualization. 
    Use these to generate a corresponding Vega-Lite specification to reproduce the visualization.
    If there is a CHART POSITION element, the data visualization contains multiple charts concatenated together; use their positions to determine how they are concatenated.
    Do not include the "data" or "schema" attributes in the specification.
    Respond only with the Vega-Lite JSON spec (raw JSON).`,

    matchColumnNames: `Given the following COLUMN_NAMES, update the below Vega-Lite specification to use the closest matching column names as the field names.
    ONLY modify the field names in the Vega-Lite specification, do not modify any other part of the spec. If there are multiple columns that could match a field name, choose the one that is most likely to be correct based on the context of the visualization.
    
    COLUMN_NAMES:`,

    reviewFinalOutput: `Review the below Vega-Lite specification. Modify it as needed to follow these guidelines, and output only the final valid Vega-Lite JSON object:
    
    - Assuming the "data" and "schema" attributes will be properly assigned before rendering, the spec must be a valid Vega-Lite JSON object and can be rendered without errors.
    - The spec must be as simple as possible while still accurately representing the visualization; there should not be unnecessarily duplicated code.
    - The spec must not contain any comments.`,

    analyzeAnnotatedSketch: `Below is a Vega-Lite specification, CURRENT_VEGA_LITE_SPEC.
    The attached image shows the CURRENT_VEGA_LITE_SPEC rendered, with user annotations on top of it (pen strokes and/or typed text).
    
    Analyze the image and determine the user's intent. What visual elements has the user added or edited? Infer any new field names based on the context of the visualization.
    
    Respond with a list of instructions describing the specific changes that need to be made to the CURRENT_VEGA_LITE_SPEC to reflect the user's intent.
    What marks, encodings, layers, or transforms need to be added or edited?
    
    Do NOT instruct to add or modify keys that specify pixel positions (x/y coordinates of title/legend) unless the user explicitly indicated so.
    
    If the user's intent cannot be determined, respond with "Do not make any changes."
    
    CURRENT_VEGA_LITE_SPEC:`,

    applyInstructions: `Below is a Vega-Lite specification, CURRENT_VEGA_LITE_SPEC, followed by instructions for specific changes to make.
    
    Modify CURRENT_VEGA_LITE_SPEC according to the instructions.
    - Apply the smallest possible structural change(s) that satisfy the instructions.
    - Preserve unrelated transforms/encodings/scales/config as much as possible. Do NOT apply any unnecessary changes that were not specified.
    - Prefer editing existing properties over introducing new layers/transforms.
    - If you introduce layers/transforms/concatenation to add something new, move the existing top-level view down into the layers to avoid duplicating code.
   
    Respond only with the updated Vega-Lite JSON spec (raw JSON).
    
    CURRENT_VEGA_LITE_SPEC:`,

    interpretUserMessage: `Below is a Vega-Lite specification, CURRENT_VEGA_LITE_SPEC, followed by a user's message instructing how they want the spec to change.
    
    Turn the user's message into a list of instructions describing the specific changes that need to be made to the CURRENT_VEGA_LITE_SPEC to reflect the user's intent.
    - What marks, encodings, layers, or transforms need to be added or edited? Apply the smallest possible structural change(s) that satisfies the user's message.
    - Infer any new field names based on the user's message.
    
    Respond with this list of instructions.
        
    If the user's intent cannot be determined, respond with "Do not make any changes."
    
    CURRENT_VEGA_LITE_SPEC:`
};

export default prompts;
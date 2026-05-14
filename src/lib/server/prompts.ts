const prompts = {
    system: `You are an expert in data visualization and Vega-Lite.`,

    initialize: `You are a Vega-Lite expert assistant. Your job is to generate or update valid Vega-Lite JSON specifications based on user sketches, annotations, and instructions.`,

    analyzeSketchFromScratch: `You are a data visualization expert assistant. Your job is to translate hand-drawn sketches into components that another agent can turn into Vega-Lite code.
    
    The attached image is a hand-drawn sketch of a data visualization. Translate it into a structured, deterministic description using the guidelines below. 
    Since it is hand-drawn, do not be strict when interpreting stroke detail (curvature, thickness, etc).
    Do not include optional or excessive styling suggestions; allow default values unless the sketch explicitly indicates otherwise.
        - Are there multiple charts concatenated together? If so, where is each positioned within the visualization? (e.g. top/bottom, left/right)
        - For each chart, determine:
            - What MARKS are present (point, bar, line, area, etc.)? There may be multiple mark types.
            - What VISUAL ENCODINGS are used? A visual encoding is a mapping from a mark's visual property to a field in the data (like the mark's x,y position, etc.). Infer field names based on the context of the visualization. Do not specify any color encodings.
            - What LAYERS are present? A LAYER is a chart that superimposed on top of another chart.
            - What TRANSFORMS have been performed? Transforms might be aggregations (like count, std, mean, sum), calculation of new fields, or other transformations, like computing a regression or a window transform.
            
    Output ONLY the structured description.`,

    elementsToVegaLite: `You are a data visualization expert assistant. Your job is to use the provided elements, which describe a data visualization, to generate a corresponding Vega-Lite specification that will reproduce the visualization. 
Do not add any extra detail (sizing, color, etc.) that was not specified in the input.
If there are multiple charts in the visualization, use their positions to determine how they are concatenated. 
Do not include the "data" or "schema" attributes in the specification. 
Respond only with the Vega-Lite JSON spec.`,

    matchColumnNames: `Given a set of COLUMN_NAMES, update the provided Vega-Lite specification to use the closest matching column names as the field names.
    ONLY modify the field names in the Vega-Lite specification, do not modify any other part of the spec. If there are multiple columns that could match a field name, choose the one that is most likely to be correct based on the context of the visualization.
    
    Output only the updated Vega-Lite specification.`,

    reviewFinalOutput: `Review the provided Vega-Lite specification. Modify it as needed to follow these guidelines, and output only the final valid Vega-Lite JSON object:
    
    - Assuming the "data" and "schema" attributes will be properly assigned before rendering, the spec must be a valid Vega-Lite JSON object and can be rendered without errors.
    - The spec must be as simple as possible while still accurately representing the visualization and preserving any specified styling; there should not be unnecessarily duplicated code.
    - The spec must not contain any comments.`,

    analyzeAnnotatedSketch: `The attached image is a rendering of the below Vega-Lite spec, with annotations on top (can be hand-drawn pen strokes and/or typed text). 
    Your job is to translate the annotations into a high-level description of what the author intends to change about the visualization.
    To do this, observe each element present in the image. For each element, determine whether it is already present in CURRENT_VEGA_LITE_SPEC.
    Any element that is not present in CURRENT_VEGA_LITE_SPEC, or is present but has been explicitly modified in the image, is an intended change.
    
    Respond with only a high-level, concise description of the overall intended changes to the visualization.`,

    applyInstructions: `The provided text input contains a Vega-Lite specification, CURRENT_VEGA_LITE_SPEC, followed by instructions for specific changes to make.
    
    Modify CURRENT_VEGA_LITE_SPEC according to the instructions.
    - Apply the smallest possible structural change(s) that satisfy the instructions.
    - Preserve unrelated transforms/encodings/scales/config as much as possible. Do NOT apply any unnecessary changes that were not specified.
    - Prefer editing existing properties over introducing new layers/transforms.
    - If you introduce layers/transforms/concatenation to add something new, move the existing top-level view down into the layers to avoid duplicating code.
   
    Respond only with the updated Vega-Lite JSON spec (raw JSON).`,

    interpretInstructions: `The provided text input contains a Vega-Lite specification, CURRENT_VEGA_LITE_SPEC, followed by a description of modifications to make.
    
    Generate a list of instructions for specific changes that need to be made to CURRENT_VEGA_LITE_SPEC to reflect the intent.
    - What marks, encodings, layers, or transforms need to be added or edited? Apply the smallest possible structural change(s) that satisfies the user's message.
    - Infer any new field names based on the message.
    
    Respond with this list of instructions.
        
    If the user's intent cannot be determined, respond with "Do not make any changes."`
};

export default prompts;
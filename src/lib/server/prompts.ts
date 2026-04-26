const prompts = {
    systemPrompt: "You are an expert in data visualization and Vega-Lite.",
    analyzeSketchFromScratch: `The attached image is a hand-drawn sketch of a data visualization. Translate it into a Vega-Lite specification using the guidelines below.
Do not fill in the "data" value in the spec; this will be handled later.
Since it is hand-drawn, do not be strict when interpreting stroke detail (curvature, thickness, etc).
Do not include optional or excessive styling specifications; allow default values unless the sketch explicitly indicates otherwise.
    - Are there multiple charts concatenated together? If so, are they concatenated vertically or horizontally?
    - For each chart, determine:
        - What MARKS are present (point, bar, line, area, etc.)? There may be multiple mark types.
        - What VISUAL ENCODINGS are used? A visual encoding is a mapping from a mark's visual property to a field in the data (like the mark's x,y position, etc.). Do not specify any color encodings.
        - What LAYERS are present? A LAYER is a chart that superimposed on top of another chart.
        - What TRANSFORMS have been performed? Transforms might be aggregations (like count, std, mean, sum), calculation of new fields, or other transformations, like computing a regression or a window transform.
Make sure not to confuse axis lines with marks/transforms.
For field names, use the closest match in the column names provided below.        
        
Output only the Vega-Lite specification in JSON format, without any explanations.`,

    matchColumnNames: `Given the above COLUMN_NAMES, update the above Vega-Lite specification to use the closest matching column names as the field names.
ONLY modify the field names in the Vega-Lite specification, do not modify any other part of the spec. If there are multiple columns that could match a field name, choose the one that is most likely to be correct based on the context of the visualization.
Output only the updated Vega-Lite specification.`,

    reviewSpec: `Does this Vega-Lite spec accomplish what it's intended to do? If not, modify it. 
    Also consider any issues that will prevent the visualization components from displaying properly. 
    Only make changes that are necessary to correct these issues. `,

    compareSpecToSketch: `The attached image is a hand-drawn sketch of a data visualization.
    Does the above Vega-Lite spec accurately represent the attached sketch, assuming the "data" element will be handled later and all specified fields are valid? 
    In other words, ignoring specific styling details like color and size, are all components that are present in the sketch also present in the spec, and vice versa? 
    Also consider any issues that will prevent the components in the Vega-Lite spec from displaying properly.
    If there are issues, modify the spec as needed. 
    
    OUTPUT RULES:
    If you modified the spec, output ONLY the spec (no explanations).
    If you did not modify the spec, output 'NO CHANGES' and nothing else.`,

    compareSpecToAnnotations: `The attached image is a rendering of a Vega-Lite specification, with annotations (pen strokes and/or typed text) an author has made to indicate their desired changes.
    The above Vega-Lite spec is the resulting specification, updated with the changes indicated by the annotations.
    Your job is to determine: Does the above spec accurately represent the annotated visualization? 
    In other words, ignoring specific styling details like color and size, are all components that are present in the sketch also present in the spec, and vice versa? 
    Also consider any issues that will prevent the components in the Vega-Lite spec from displaying properly.
    Use the web search tool as needed to determine issues.
    If there are issues, modify the spec as needed. 
    
    OUTPUT RULES:
    If you modified the spec, output ONLY the spec (no explanations).
    If you did not modify the spec, output 'NO CHANGES' and nothing else.`,

    compareSpecToInstructions: `Does the above Vega-Lite spec correctly implement the given instructions?
    Also consider any issues that will prevent the components in the Vega-Lite spec from displaying properly.
    Use the web search tool as needed to determine issues.
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
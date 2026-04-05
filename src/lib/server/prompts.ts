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
    Respond only with the Vega-Lite specification.`,

    matchColumnNames: `Given the following COLUMN_NAMES, update the below Vega-Lite specification to use the closest matching column names as the field names.
    ONLY modify the field names in the Vega-Lite specification, do not modify any other part of the spec. If there are multiple columns that could match a field name, choose the one that is most likely to be correct based on the context of the visualization.
    
    COLUMN_NAMES:`,

    reviewFinalOutput: `Review the below Vega-Lite specification. Modify it as needed to follow these guidelines, and output only the final valid Vega-Lite JSON object:
    
    - Assuming the "data" and "schema" attributes will be properly added before rendering, the spec must be a valid Vega-Lite JSON object and can be rendered without errors.
    - The spec must be as simple as possible while still accurately representing the visualization; there should not be unnecessarily duplicated code.
    - The spec must not contain any comments.`
};

export default prompts;
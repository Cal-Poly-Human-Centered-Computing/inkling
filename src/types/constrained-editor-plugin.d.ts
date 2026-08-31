declare module 'constrained-editor-plugin' {
    import type * as Monaco from 'monaco-editor';

    type Restriction = {
        range: [number, number, number, number];
        allowMultiline?: boolean;
        label?: string;
        validate?: (currentlyTypedValue: string, newRange: unknown, info: unknown) => boolean;
    };

    type ConstrainedInstance = {
        initializeIn: (editor: Monaco.editor.IStandaloneCodeEditor) => void;
        addRestrictionsTo: (model: Monaco.editor.ITextModel, restrictions: Restriction[]) => unknown;
        removeRestrictionsIn?: (model: Monaco.editor.ITextModel) => void;
    };

    export default function constrainedEditor(monaco: typeof Monaco): ConstrainedInstance;
}

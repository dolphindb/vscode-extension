import {
    DefinitionParams,
    Position,
    Range
} from 'vscode-languageserver/node';

import { connection } from "./connection";
import { documents } from './documents';
import { getWordAtPosition } from './utils/texts';

connection.onDefinition((params: DefinitionParams) => {

    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }

    const text = document.getText();
    const lines = text.split('\n');
    const position = params.position;

    const word = getWordAtPosition(lines[position.line], position.character);
    if (!word) {
        return null;
    }

    const definition = findDefinitionOrDeclaration(lines, word, position.line);
    if (!definition) {
        return null;
    }

    return {
        uri: params.textDocument.uri,
        range: definition.range
    };
});


function findDefinitionOrDeclaration(lines: string[], word: string, currentLine: number): { range: Range } | null {
    const functionRegex = new RegExp(`def\\s+${word}\\s*\\(`);
    const declarationRegex = new RegExp(`\\b${word}\\b\\s*=`);

    // First, look for function definition
    for (let i = 0; i < lines.length; i++) {
        if (functionRegex.test(lines[i])) {
            return {
                range: {
                    start: Position.create(i, 0),
                    end: Position.create(i, lines[i].length)
                }
            };
        }
    }

    // Then, look for variable declaration (from the current line upwards)
    for (let i = currentLine; i >= 0; i--) {
        if (declarationRegex.test(lines[i])) {
            return {
                range: {
                    start: Position.create(i, 0),
                    end: Position.create(i, lines[i].length)
                }
            };
        }
    }

    return null;
}
import {
    DefinitionParams,
    Location,
    Position,
    Range
} from 'vscode-languageserver/node';

import { connection } from "./connection";
import { documents } from './documents';
import { getWordAtPosition } from './utils/texts';
import { ddbModules } from './modules';
import * as fsp from 'fs/promises';

connection.onDefinition(async (params: DefinitionParams) => {

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

    // Check for local definition
    let definition = findDefinitionOrDeclaration(lines, word, position.line);
    if (definition) {
        return {
            uri: params.textDocument.uri,
            range: definition.range
        };
    }

    // Check for module definition
    const moduleDefinition = await findDefinitionInModules(word);
    if (moduleDefinition) {
        return moduleDefinition;
    }

    return null;
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

async function findDefinitionInModules(word: string, moduleNames: string[] = []): Promise<Location | null> {
    const modules = ddbModules.getModules();
    for (const module of modules) {
        const modulePath = module.path;
        try {
            const moduleContent = await fsp.readFile(modulePath, 'utf-8');
            const lines = moduleContent.split('\n');
            const definition = await findDefinitionOrDeclaration(lines, word, 0);
            if (definition) {
                return {
                    uri: `file:///${modulePath}`,
                    range: definition.range
                };
            }
        } catch (error) {
            console.error(`Error reading module file ${module.path}:`, error);
        }
    }
    return null;
}
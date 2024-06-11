import {
    DefinitionParams,
    Location,
    Position,
    Range
} from 'vscode-languageserver/node';

import { connection } from "./connection";
import { documents } from './documents';
import { extractModuleName, getWordAtPosition } from './utils/texts';
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
    const moduleDefinition = await findDefinitionInModules(word, text);
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
            const startIdx = lines[i].indexOf(word);
            const endIdx = startIdx + word.length;
            return {
                range: {
                    start: Position.create(i, startIdx),
                    end: Position.create(i, endIdx)
                }
            };
        }
    
        // Check if the line contains a function definition
        const match = functionRegex.exec(lines[i]);
        if (match) {
            const params = match[1].split(',').map(param => param.trim());
            if (params.includes(word)) {
                const startIdx = lines[i].indexOf(word);
                const endIdx = startIdx + word.length;
                return {
                    range: {
                        start: Position.create(i, startIdx),
                        end: Position.create(i, endIdx)
                    }
                };
            }
        }

    }

    return null;
}

async function findDefinitionInModules(word: string, code: string): Promise<Location | null> {
    const lines = code.split('\n');
    const moduleImported: string[] = [];
    for (const ln of lines) {
        const moduleName = extractModuleName(ln);
        if (moduleName) {
            moduleImported.push(moduleName)
        }
    }
    // 只检查导入的模块
    const modules = ddbModules.getModules().filter(e => moduleImported.includes(e.moduleName));
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
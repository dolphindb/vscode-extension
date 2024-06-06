export function getWordAtPosition(line: string, character: number): string | null {
    const regex = /\b\w+\b/g;
    let match;
    while ((match = regex.exec(line)) !== null) {
        if (match.index <= character && regex.lastIndex >= character) {
            return match[0];
        }
    }
    return null;
}

export function extractModuleName(line: string): string | null {
    const regex = /use\s+([\w:]+)\s*[:;]?/;
    const match = line.match(regex);
    return match ? match[1] : null;
}
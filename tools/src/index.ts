import * as fs from 'fs'
import * as parse from 'csv-parse'
import * as path from 'path'

type SnippetUnit = {
    body: string | string[],
    prefix: string,
    description?: string,
    scope?: string,
}

type FnInfo = {
    name: string,
    isCommand: boolean,
    userDefined: boolean,
    minParamCount: number,
    maxParamCount: number,
    syntax: string,
}

function csvToFnInfos(data: string[][]): FnInfo[] {
    let data2 = []
    for(let i = 2; i < data.length; i++) {
        data2.push(data[i])
    }
    return data2.map(info => ({
        name: info[0],
        isCommand: info[1] == '1' ? true : false,
        userDefined: info[2] == '1' ? true : false,
        minParamCount: +info[3],
        maxParamCount: +info[4],
        syntax: info[5],
    }))
}

function parseSyntaxToBody(syntax: string): string {
    // remove whitespace
    syntax =  syntax.trim()
    // remove parens
    syntax = syntax.slice(1, syntax.length-1)
    let segments = syntax.split(/,[ ]*/)
    let res = ''
    for(let i = 1; i <= segments.length; i++) {
        res += '${' + i + ':' + segments[i-1] + '}' + ', '
    }

    return res.slice(0, res.length - 2)
}

function fnInfosToSnippets(fnInfos: FnInfo[], scope: string = 'source.dolphindb'): SnippetUnit[] {
    return fnInfos.map(info => {
        let prefix = info.name
        let body = `${prefix}(${parseSyntaxToBody(info.syntax)})`
        return {
            prefix,
            body,
            scope,
        }
    })
}

const output: string[][] = []

const parser = new parse.Parser({
    delimiter: ',',
    skip_empty_lines: true,
})

parser.on('readable', function () {
    let record
    while (record = parser.read()) {
        output.push(record)
    }
})

parser.on('error', function (err) {
    console.error(err.message)
})

parser.on('end', function () {
    let fnInfos = csvToFnInfos(output)
    let snippets = fnInfosToSnippets(fnInfos)
    let data: any = {} 
    snippets.forEach(elem => {
        data[elem.prefix] = elem
    })
    fs.writeFileSync('data/dolphindb-functions.snippets.json', JSON.stringify(data, null, 2))
})


parser.write(fs.readFileSync('data/functions.csv'))

// Close the readable stream
parser.end()
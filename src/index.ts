#!/usr/bin/env ts-node

import { program } from 'commander'
import * as fs from 'fs'
import * as path from 'path'
import { Gridifier, GridifierOptions } from './gridifier'

/*
Debugging command:
# without scaling
npx ts-node src/index.ts \
  --input ./examples/Container-Input.stl \
  -g 4x2 \
  -r 10 -h 45 \
  -o 2x6 \
  -d 0 -f ./debug/out.stl

python3 -c "import trimesh; mesh = trimesh.load('debug/merged.stl'); mesh.fix_normals(); mesh.remove_degenerate_faces(); mesh.remove_duplicate_faces(); mesh.remove_unreferenced_vertices(); mesh.fill_holes(); mesh.export('debug/merged-fixed.stl')"
*/


interface CLIOptions extends GridifierOptions {
    input: string              // Path to the 1×2 STL
    outputFile: string         // output file path
}

program
    .requiredOption('-i, --input <file>', 'Path to input 1×2 STL file')
    .requiredOption('-g, --input-grids <NxM>', 'Input grid size (NxM)', parseGridSize)
    .requiredOption('-r, --input-corner-radius <mm>', 'Size in mm for the corner radius', parseFloat)
    .requiredOption('-h, --height <mm>', 'Container height in mm', parseFloat)
    .requiredOption('-o, --output-grids <NxM>', 'Output grid size (NxM)', parseGridSize)
    .requiredOption('-f, --output-file <file>', 'Output STL file name')
    .option('-s, --output-grid-size <mm>', 'Size in mm for output grid side', parseFloat)
    .option('-d, --divider-thickness <mm>', 'Divider thickness in mm (0 = none)', parseFloat, 0)
    .option('-u, --union-all', 'Union all parts into a single geometry')
    .parse(process.argv)

const opts = program.opts<CLIOptions>()

function parseGridSize(input: string): [number, number] {
    const [n, m] = input.split('x').map(Number)
    if (n < 1 || m < 1) {
        throw new Error('Invalid grid size. Expected format: NxM, where N and M are positive integers.')
    }
    return [n, m]
}

// Add debug logging utility
function debugLog(message: string, ...args: any[]) {
    console.log(`[DEBUG] ${message}`, ...args)
}

function isDebug(): boolean {
    return process.env.NODE_ENV !== 'production'
}

//-------------------------------------
async function main(options: CLIOptions) {
    debugLog('Starting with options:', options)
    const {
        input,
        outputFile
    } = options

    console.log('Loading STL:', input)
    if (!fs.existsSync(input)) {
        throw new Error(`Input file not found: ${input}`)
    }
    const fileBuf = fs.readFileSync(input)

    const stlString = await Gridifier(fileBuf, options)

    // Ensure output directory exists
    const outDir = path.dirname(outputFile)
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true })
    }

    fs.writeFileSync(outputFile, stlString)
    console.log(`Exported STL to: ${outputFile}`)
}

//-------------------------------------
main(opts).catch((err) => {
    console.error('Error:', err)
    process.exit(1)
})

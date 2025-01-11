'use server'

import { Gridifier, GridifierOptions } from "@/../src/gridifier"
import path from "path"
import fs from "fs"

export async function GridifierAction(inputBuffer: Buffer | undefined, params: GridifierOptions) {
    if (!inputBuffer) {
        const modelPath = path.join(process.cwd(), 'public', 'default.stl')
        const fileBuffer = await fs.promises.readFile(modelPath)
        inputBuffer = fileBuffer
    }
    return Gridifier(inputBuffer, params)
}

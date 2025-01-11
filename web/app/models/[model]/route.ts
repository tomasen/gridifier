import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET(
    request: Request,
    { params }: { params: Promise<{ model: string }> }
) {
    const { model } = await params

    if (model === 'default') {
        const modelPath = path.join(process.cwd(), 'public', `${model}.stl`)

        try {
            const fileBuffer = await fs.promises.readFile(modelPath)

            return new NextResponse(fileBuffer, {
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'Content-Disposition': `attachment; filename="${model}.stl"`
                }
            })
        } catch (error) {
            console.error('Error reading default model:', error)
            return new NextResponse('Model not found', { status: 404 })
        }
    }

    return new NextResponse('Model not found', { status: 404 })
} 

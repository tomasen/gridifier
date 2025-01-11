'use client'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import ModelViewer from "@/components/ModelViewer"
import { useState } from "react"
import { GridifierAction } from "@/lib/gridifier-action"
import { ParameterSlider } from "@/components/ui/parameter-slider"

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | undefined>(undefined)
  const [useDefaultModel, setUseDefaultModel] = useState(true)
  const [generatedSTL, setGeneratedSTL] = useState<ArrayBuffer | undefined>(undefined)
  const [isGenerating, setIsGenerating] = useState(false)
  const [gridifierParams, setGridifierParams] = useState({
    inputGrids: [4, 2] as [number, number],
    inputCornerRadius: 10,
    height: 45,
    outputGrids: [1, 3] as [number, number],
    outputGridSize: undefined as number | undefined,
    dividerThickness: undefined as number | undefined,
    unionAll: false,
  })
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setUseDefaultModel(false)
      setGeneratedSTL(undefined)
    }
  }

  const handleGenerateModel = async () => {
    try {
      setIsGenerating(true)
      setErrorMessage(null)

      // Get the input STL file
      let inputBuffer: Buffer | undefined = undefined
      if (selectedFile) {
        // Use the uploaded file
        const arrayBuffer = await selectedFile.arrayBuffer()
        inputBuffer = Buffer.from(arrayBuffer)
      }

      const options = {
        inputGrids: gridifierParams.inputGrids,
        inputCornerRadius: gridifierParams.inputCornerRadius,
        height: gridifierParams.height,
        outputGrids: gridifierParams.outputGrids,
        outputGridSize: gridifierParams.outputGridSize,
        dividerThickness: gridifierParams.dividerThickness,
        unionAll: gridifierParams.unionAll,
      }
      // Call the Gridifier function
      const stlString = await GridifierAction(inputBuffer, options)

      console.log('Generated STL:', options)

      // Convert the output to ArrayBuffer for the ModelViewer
      setGeneratedSTL(stlString.buffer as ArrayBuffer)
    } catch (error) {
      console.error('Error generating model:', error)
      setErrorMessage(error instanceof Error ? error.message : 'An unexpected error occurred')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-8">

      <main className="max-w-7xl mx-auto gap-8">
        <section className="p-6 mb-8 space-y-4 w-full">
          <div className="space-y-4">
            <h1 className="text-4xl font-bold flex items-baseline bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Gridifier
              <p className="text-sm ml-4 flex text-gray-600 dark:text-gray-300">
                Customizable grid system based on your own 3D models.
              </p>
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-300">
              Gridifier takes a pre-modeled container (at least 2×2) and cut, scale, and recontruct into a customized grid of storage compartments.
              Its primary goal is to eliminate the need for time-consuming manual CAD work when you want to create multi-cell organizers at different sizes or heights.
            </p>
          </div>
        </section>
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {errorMessage && (
            <div className="lg:col-span-2 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
              <span className="block sm:inline">{errorMessage}</span>
            </div>
          )}

          {/* Upload Section */}
          <Card className="p-6 space-y-4">
            <h2 className="text-2xl font-bold">Input Base Model</h2>
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Use the default model or upload your own STL as base model.
              </p>
              <div className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 text-center">
                <Input
                  type="file"
                  accept=".stl"
                  className="hidden"
                  id="stl-upload"
                  onChange={handleFileUpload}
                />
                <Button asChild className={`w-full ${useDefaultModel ? "bg-gray-600 hover:bg-gray-800" : ""}`} disabled={useDefaultModel}>
                  <label htmlFor="stl-upload" className={useDefaultModel ? "text-gray-500" : ""}>
                    {selectedFile ? selectedFile.name : "Upload STL File"}
                  </label>
                </Button>
              </div>
              <div className="flex items-center space-x-2">
                <Input
                  type="checkbox"
                  id="use-default"
                  className="w-4 h-4"
                  checked={useDefaultModel}
                  onChange={(e) => {
                    setUseDefaultModel(e.target.checked)
                    setGeneratedSTL(undefined)
                  }}
                />
                <label htmlFor="use-default" className="text-sm">
                  Use Default Model
                </label>
              </div>
            </div>
            <div className="h-[400px] bg-gray-100 dark:bg-gray-800 rounded-lg">
              <ModelViewer
                model="input"
                stlFile={!useDefaultModel ? selectedFile : undefined}
              />
            </div>
            <div className="space-y-4">
              <ParameterSlider
                label="Input Grids (N) in X direction"
                min={2}
                value={gridifierParams.inputGrids[0]}
                onChange={(value: number) => {
                  setGridifierParams(prev => ({
                    ...prev,
                    inputGrids: [value, prev.inputGrids[1]]
                  }))
                  setGeneratedSTL(undefined)
                }}
                explanation="The number of horizontal divisions in the input grid."
              />

              <ParameterSlider
                label="Input Grids (M) in Y direction"
                value={gridifierParams.inputGrids[1]}
                min={2}
                onChange={(value) => {
                  setGridifierParams(prev => ({
                    ...prev,
                    inputGrids: [prev.inputGrids[0], value]
                  }))
                  setGeneratedSTL(undefined)
                }}
                explanation="The number of vertical divisions in the input grid."
              />

              <ParameterSlider
                label="Corner Radius (mm)"
                value={gridifierParams.inputCornerRadius}
                min={2}
                step={0.5}
                onChange={(value) => {
                  setGridifierParams(prev => ({
                    ...prev,
                    inputCornerRadius: value
                  }))
                  setGeneratedSTL(undefined)
                }}
                explanation="The radius of the corners of the input grid."
              />
            </div>
          </Card>

          {/* Parameters Section */}
          <Card className="p-6 space-y-4">
            <h2 className="text-2xl font-bold">Output Parameters</h2>
            <div className="space-y-4">
              <ParameterSlider
                label="Output Grids (N) in X direction"
                value={gridifierParams.outputGrids[0]}
                onChange={(value) => {
                  setGridifierParams(prev => ({
                    ...prev,
                    outputGrids: [value, prev.outputGrids[1]]
                  }))
                  setGeneratedSTL(undefined)
                }}
                explanation="The number of horizontal divisions in the output grid."
              />

              <ParameterSlider
                label="Output Grids (M) in Y direction"
                value={gridifierParams.outputGrids[1]}
                onChange={(value) => {
                  setGridifierParams(prev => ({
                    ...prev,
                    outputGrids: [prev.outputGrids[0], value]
                  }))
                  setGeneratedSTL(undefined)
                }}
                explanation="The number of vertical divisions in the output grid."
              />

              <ParameterSlider
                label="Height (mm)"
                value={gridifierParams.height}
                min={10}
                max={200}
                onChange={(value) => {
                  setGridifierParams(prev => ({
                    ...prev,
                    height: value
                  }))
                  setGeneratedSTL(undefined)
                }}
                explanation="The height of the output container."
              />

              <ParameterSlider
                label="Output Grid Size (mm)"
                value={gridifierParams.outputGridSize}
                min={10}
                max={200}
                onChange={(value) => {
                  setGridifierParams(prev => ({
                    ...prev,
                    outputGridSize: value
                  }))
                  setGeneratedSTL(undefined)
                }}
                explanation="The side length of each output grid. Will use the size from base model if not set."
              />

              <Button
                className="w-full"
                size="lg"
                onClick={handleGenerateModel}
                disabled={isGenerating}
              >
                {isGenerating ? "Generating..." : "Generate Model"}
              </Button>
            </div>
            <div className="h-[400px] bg-gray-100 dark:bg-gray-800 rounded-lg">
              <ModelViewer
                model="output"
                stlBuffer={generatedSTL}
              />
            </div>
            <Button
              variant="outline"
              className="w-full"
              disabled={!generatedSTL}
              onClick={() => {
                if (generatedSTL) {
                  const blob = new Blob([generatedSTL], { type: 'application/octet-stream' })
                  const url = URL.createObjectURL(blob)

                  // Generate filename using template
                  const baseModelName = selectedFile ? selectedFile.name.replace('.stl', '') : 'default'
                  const filename = `${baseModelName}-${gridifierParams.outputGrids[0]}x${gridifierParams.outputGrids[1]}-${gridifierParams.height}-${gridifierParams.outputGridSize || 'auto'}.stl`

                  const a = document.createElement('a')
                  a.href = url
                  a.download = filename
                  document.body.appendChild(a)
                  a.click()
                  document.body.removeChild(a)
                  URL.revokeObjectURL(url)
                }
              }}
            >
              Download Generated Model
            </Button>
          </Card>
        </section>
      </main>

      <footer className="mt-16 text-center text-gray-600 dark:text-gray-400">
        <div className="max-w-7xl mx-auto px-4 text-sm">
          <p>© {new Date().getFullYear()} Gridifier. All rights reserved.</p>
          <p className="mt-2 text-sm">
            Created with ❤️ by{' '}
            <a
              href="https://tomasen.org"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              Tomasen
            </a>
          </p>
        </div>
      </footer>
    </div>
  )
}

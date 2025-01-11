#!/usr/bin/env ts-node

import * as fs from 'fs'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { INTERSECTION, ADDITION, Brush, Evaluator } from 'three-bvh-csg'
import { MeshBVH } from 'three-mesh-bvh'

/**
 * This TypeScript program designed to "cut" or "slice" an STL file
 * then re-assemble it into a customized container.
 * 
 * At First, this script loads a single "1×2" STL file, which represents a container made of two adjacent 1×1 sections.
 * Using the constructive solid geometry (CSG) library (three-csg-ts), it slices out distinct sub-parts:
 *
 * 1. **Bottom Corner With 2 Walls**  
 *    - The rounded, external corner at the bottom boundary of the container.
 *    - Connects to 2 side walls in 90 degree angle, one on each side.
 *    - Visible from the outside and typically more decorative or curved.
 *
 * 2. **Top Corner With 2 Walls**  
 *    - The rounded, external corner at the top boundary of the container.
 *    - Connects to 2 side walls in 90 degree angle, one on each side.
 *    - Similar to the bottom outer corner, but at the upper perimeter.
 *
 * 3. **Bottom Corner With 1 Wall**  
 *    - Internal corner at the bottom where the two 1×1 sections meet.
 *    - Connects to 1 side wall, connect to the next grid section on the other side.
 *    - Lacks the rounded exterior shape since it's not on the outer boundary; may have a small raised edge for functionality (e.g., rail fitting).
 *
 * 4. **Top Corner With 1 Wall**  
 *    - Internal corner at the top where the two 1×1 sections meet.
 *    - Connects to 1 side wall, connect to the next grid section on the other side.
 *    - Again, not rounded like an outer corner, often a flat or raised interface for connecting the compartments.
 *
 * 5. **Bottom Corner With No(0) Wall**  
 *    - Internal corner at the bottom where the 4 1×1 sections meet.
 *    - No walls, just a flat bottom.
 *
 * 6. **Side Top Edges**  
 *    - The top edges of the side walls.
 * 
 * 7. **Side Bottom Edges**  
 *    - The bottom edges of the side walls.
 *
 * 8. **Side Wall (Side Segment)**  
 *    - The vertical wall without the top and bottom edges.
 *    - May include straight segments or small fillets, depending on the container design.
 *
 * 9. **Bottom Floor**  
 *    - The flat (or slightly raised) flooring piece at the bottom of each 1×1 section.
 *    - Sometimes includes details like rails or grooves for stability.
 *
 * 10. ** Divider (if any) **  
 *    - A vertical divider that separates the container into smaller compartments.
 *    - This is optional, and can be specified by the user in the output.
 *
 * By isolating these sub-parts via plane-based or box-based boolean cutting, we can
 * separately manipulate or reassemble them to build larger containers while preserving
 * the unique geometry of outer corners, internal junctions, side walls, and floor pieces.
 *
 * For debug purposes, we will have option to exports each region as a separate STL file.
 *
 * Then we'll re-assembled to a larger containers that in the size user specified. 
 * Output a single merged geometry without distinct named sub-meshes.
 */

const OVERLAP_THICKNESS = 0.01 // mm
const MERGE_VERTICES_TOLERANCE = 0.001 // mm
const MIN_TRIANGLE_AREA = 0.001

interface Subparts {
    bottomCorner2W: THREE.BufferGeometry
    topCorner2W: THREE.BufferGeometry
    bottomCorner1WRightNear: THREE.BufferGeometry
    bottomCorner1WLeftFar: THREE.BufferGeometry
    topCorner1W: THREE.BufferGeometry
    bottomCorner0W: THREE.BufferGeometry
    sideTopEdges: THREE.BufferGeometry
    sideBottomEdges: THREE.BufferGeometry
    sideEdge2W: THREE.BufferGeometry
    sideWall: THREE.BufferGeometry
    bottomFloor: THREE.BufferGeometry
    bottomEdge0W: THREE.BufferGeometry
}


interface GridResult {
    geometry: THREE.BufferGeometry
    sizeX: number
    sizeY: number
    sizeZ: number
}

export interface GridifierOptions {
    inputGrids: [number, number]     // NxM grid size
    inputCornerRadius: number        // mm for the corner radius
    height: number                   // mm for container height
    outputGrids: [number, number]    // NxM grid size
    outputGridSize?: number          // mm for the output grid side length
    dividerThickness?: number        // thickness of internal dividers, 0 = none
    unionAll?: boolean              // union all parts into a single geometry
    debug?: boolean                 // enable debug logging
}


// Add debug logging utility
function debugLog(message: string, ...args: any[]) {
    console.log(`[DEBUG] ${message}`, ...args)
}

// Add this helper function near the top
function validateGeometry(geometry: THREE.BufferGeometry, context: string): void {
    // Clear any groups to ensure we have a single unified geometry
    geometry.clearGroups()

    if (!geometry.attributes.position) {
        throw new Error(`${context}: Geometry has no position attribute`)
    }

    const positions = geometry.attributes.position.array
    for (let i = 0; i < positions.length; i++) {
        if (isNaN(positions[i])) {
            throw new Error(`${context}: Found NaN in position array at index ${i}`)
        }
    }

    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()

    if (!geometry.boundingSphere || isNaN(geometry.boundingSphere.radius)) {
        throw new Error(`${context}: Invalid bounding sphere`)
    }

    // Get number of groups/parts
    const numGroups = geometry.groups.length
    // Get number of triangles (faces)
    const numTriangles = positions.length / 9  // 3 vertices per triangle, 3 components (x,y,z) per vertex
    // Get number of vertices
    const numVertices = positions.length / 3   // 3 components (x,y,z) per vertex

    debugLog(`${context}: Geometry validated`, {
        vertices: numVertices,
        triangles: numTriangles,
        groups: numGroups || 1, // If no groups defined, it's one single object
        hasNonManifoldEdges: hasNonManifoldEdges(geometry)
    })
}

function isDebug(): boolean {
    // if 'debug' folder exists, then we are in debug mode 
    return fs.existsSync('./debug')
}

//-------------------------------------
export async function Gridifier(input: Buffer, options: GridifierOptions) {
    // check node version
    const nodeVersion = process.version
    // throw error if node version is less than 22
    if (nodeVersion < 'v22.0.0') {
        console.warn('Node.js version needs to be at least 22.0.0')
    }

    debugLog('Starting with options:', options)
    const {
        inputGrids,
        inputCornerRadius,
        height,
        outputGrids,
        outputGridSize,
        dividerThickness,
        unionAll,
    } = options
    const [n, m] = inputGrids

    const fileBuf = input

    // 1) Load the base n × m geometry
    const loader = new STLLoader()
    let baseGeom = loader.parse(Buffer.from(fileBuf).buffer)

    if (isDebug()) {
        baseGeom.computeBoundingBox()
        trimBufferGeometryToOrigin(baseGeom)

        const meshBox = makeBoxMesh(
            baseGeom.boundingBox!.min.x,
            baseGeom.boundingBox!.max.x,
            baseGeom.boundingBox!.min.y,
            baseGeom.boundingBox!.max.y,
            baseGeom.boundingBox!.min.z,
            baseGeom.boundingBox!.max.z
        )
        const result = cutByMeshBox(baseGeom, meshBox)
        baseGeom = result
        const baseExporter = new STLExporter()
        const baseStlString = baseExporter.parse(new THREE.Mesh(result, basicMaterial()))
        fs.writeFileSync('./debug/base.stl', baseStlString)
    }

    // cut the 1x1 grid out in the corner
    debugLog('Cutting to 1x1 grid...')
    const originalGridResult = cutToGrid(baseGeom, n, m)
    validateGeometry(originalGridResult.geometry, 'cutToGrid output')

    let gridResult = originalGridResult
    let cornerCuttingRadius = inputCornerRadius
    // scale the grid size by the outputGridSize
    if (outputGridSize != undefined) {
        const scale = outputGridSize / originalGridResult.sizeX
        debugLog('Scaling grid by', scale)
        const scaledGeometry = originalGridResult.geometry.clone().scale(scale, scale, scale)
        trimBufferGeometryToOrigin(scaledGeometry)
        validateGeometry(scaledGeometry, 'cutToGrid scaled output')
        const scaledGridResult = {
            geometry: scaledGeometry,
            sizeX: originalGridResult.sizeX * scale,
            sizeY: originalGridResult.sizeY * scale,
            sizeZ: originalGridResult.sizeZ * scale
        }
        gridResult = scaledGridResult
        cornerCuttingRadius = inputCornerRadius * scale
    }

    if (isDebug()) {
        // output the gridGeom to a file
        const gridMesh = new THREE.Mesh(gridResult.geometry, basicMaterial())
        const gridExporter = new STLExporter()
        const gridStlString = gridExporter.parse(gridMesh)
        fs.writeFileSync('./debug/grid.stl', gridStlString)
    }


    // cut the 1x1 grid to sub-parts
    debugLog('Cutting to parts..., cornerRadius:', cornerCuttingRadius)
    const subparts = cutToParts(gridResult.geometry, cornerCuttingRadius)

    if (isDebug()) {
        // output each subpart to a file
        Object.entries(subparts).forEach(([name, geometry]) => {
            const mesh = new THREE.Mesh(geometry, basicMaterial())
            const exporter = new STLExporter()
            const stlString = exporter.parse(mesh)
            fs.writeFileSync(`./debug/${name}.stl`, stlString)
        })
    }

    // re-assemble the sub-parts into a larger container
    debugLog('Reassembling...')
    const [rows, cols] = outputGrids
    const merged = reassemble(subparts, gridResult, cornerCuttingRadius, height, rows, cols, dividerThickness, unionAll)

    debugLog('Exporting...')
    const stlString = exportGeometry(merged)

    if (isDebug()) {
        // output the mergedGeom to a file
        fs.writeFileSync('./debug/merged.stl', stlString)
    }

    return stlString
}

function exportGeometry(geometry: THREE.BufferGeometry) {
    debugLog('Exporting geometry...', {
        vertices: geometry.attributes.position.count / 3
    })

    const mesh = new THREE.Mesh(geometry, basicMaterial())
    const exporter = new STLExporter()
    const stlString = exporter.parse(mesh, {
        binary: true
    })
    return stlString
}

function basicMaterial(): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, wireframe: false })
}

function cutToGrid(baseGeom: THREE.BufferGeometry, n: number, m: number): GridResult {
    if (n < 2 || m < 2) {
        throw new Error('Grid size must be at least 2x2')
    }

    debugLog('Starting cutToGrid with dimensions:', { n, m })
    trimBufferGeometryToOrigin(baseGeom)

    validateGeometry(baseGeom, 'cutToGrid input')

    // First center and orient the geometry
    baseGeom.computeBoundingBox()
    const bb = baseGeom.boundingBox!

    // Get dimensions
    const sizeX = bb.max.x - bb.min.x
    const sizeY = bb.max.y - bb.min.y
    const sizeZ = bb.max.z - bb.min.z

    console.log('Base geometry dimensions:', { sizeX, sizeY, sizeZ })

    // Calculate grid cell sizes
    const gridSizeX = sizeX / n
    const gridSizeY = sizeY / m

    debugLog('Grid cell size:', { gridSizeX, gridSizeY })

    // then cut the corner of cellSizeX x cellSizeY x sizeZ
    const cornerPart = cutByMeshBox(baseGeom, makeBoxMesh(bb.min.x, bb.min.x + gridSizeX, bb.min.y, bb.min.y + gridSizeY, bb.min.z, bb.min.z + sizeZ))
    trimBufferGeometryToOrigin(cornerPart)

    // Return both the geometry and the grid sizes
    return {
        geometry: cornerPart,
        sizeX: gridSizeX,
        sizeY: gridSizeY,
        sizeZ: sizeZ
    }
}

function cutToParts(baseGeom: THREE.BufferGeometry, cornerRadius: number): Subparts {

    debugLog('Starting cutToParts with cornerRadius:', cornerRadius)
    validateGeometry(baseGeom, 'cutToParts input')

    // First center and orient the geometry
    baseGeom.computeBoundingBox()
    const bb = baseGeom.boundingBox!

    // Get dimensions
    const sizeX = bb.max.x - bb.min.x
    const sizeY = bb.max.y - bb.min.y
    const sizeZ = bb.max.z - bb.min.z

    debugLog('grid dimensions:', { sizeX, sizeY, sizeZ })
    debugLog('cornerRadius:', cornerRadius)


    // Cut bottom corner with 2 walls (outer corner)
    const bottomCorner2WBox = makeBoxMesh(
        bb.min.x,
        bb.min.x + cornerRadius,
        bb.min.y,
        bb.min.y + cornerRadius,
        bb.min.z,
        bb.min.z + cornerRadius)
    const bottomCorner2WMesh = cutByMeshBox(baseGeom.clone(), bottomCorner2WBox)

    // Cut top corner with 2 walls (outer corner)
    const topCorner2WBox = makeBoxMesh(
        bb.min.x,                  // Changed from 0
        bb.min.x + cornerRadius,     // Changed from cornerRadius
        bb.min.y,                  // Changed from 0
        bb.min.y + cornerRadius,     // Changed from cornerRadius
        bb.min.z + sizeZ - cornerRadius,
        bb.min.z + sizeZ
    )
    const topCorner2WMesh = cutByMeshBox(baseGeom.clone(), topCorner2WBox)

    // Cut bottom corner with 1 wall on the right 
    const bottomCorner1WRightBox = makeBoxMesh(
        bb.min.x + sizeX - cornerRadius,  // Added bb.min.x
        bb.min.x + sizeX,               // Added bb.min.x
        bb.min.y,                       // Added bb.min.y
        bb.min.y + cornerRadius,          // Added bb.min.y
        bb.min.z,                       // Added bb.min.z
        bb.min.z + cornerRadius           // Added bb.min.z
    )
    const bottomCorner1WRightMesh = cutByMeshBox(baseGeom.clone(), bottomCorner1WRightBox)

    // Cut bottom corner with 1 wall on the left
    const bottomCorner1WLeftBox = makeBoxMesh(
        bb.min.x,  // Added bb.min.x
        bb.min.x + cornerRadius,               // Added bb.min.x
        bb.min.y + sizeY - cornerRadius,       // Added bb.min.y
        bb.min.y + sizeY,                    // Added bb.min.y
        bb.min.z,                            // Added bb.min.z
        bb.min.z + cornerRadius                 // Added bb.min.z
    )
    const bottomCorner1WLeftMesh = cutByMeshBox(baseGeom.clone(), bottomCorner1WLeftBox)

    // Cut top corner with 1 wall (inner corner)
    const topCorner1WBox = makeBoxMesh(
        bb.min.x + sizeX - cornerRadius,  // Added bb.min.x
        bb.min.x + sizeX,               // Added bb.min.x
        bb.min.y,                       // Added bb.min.y
        bb.min.y + cornerRadius,          // Added bb.min.y
        bb.min.z + sizeZ - cornerRadius,  // Added bb.min.z
        bb.min.z + sizeZ                // Added bb.min.z
    )
    const topCorner1WMesh = cutByMeshBox(baseGeom.clone(), topCorner1WBox)


    // Cut bottom corner with no walls (center corner)
    const bottomCorner0WBox = makeBoxMesh(
        bb.min.x + sizeX - cornerRadius,
        bb.min.x + sizeX,
        bb.min.y + sizeY - cornerRadius,
        bb.min.y + sizeY,
        bb.min.z,
        bb.min.z + cornerRadius
    )
    const bottomCorner0WMesh = cutByMeshBox(baseGeom.clone(), bottomCorner0WBox)

    // Cut side top edges
    const sideTopEdgesBox = makeBoxMesh(
        bb.min.x + cornerRadius,
        bb.min.x + sizeX - cornerRadius,
        bb.min.y,
        bb.min.y + cornerRadius,
        bb.min.z + sizeZ - cornerRadius,
        bb.min.z + sizeZ
    )

    const sideTopEdgesMesh = cutByMeshBox(baseGeom.clone(), sideTopEdgesBox)

    // Cut side bottom edges
    const sideBottomEdgesBox = makeBoxMesh(
        bb.min.x + cornerRadius,
        bb.min.x + sizeX - cornerRadius,
        bb.min.y,
        bb.min.y + cornerRadius,
        bb.min.z,
        bb.min.z + cornerRadius
    )
    const sideBottomEdgesMesh = cutByMeshBox(baseGeom.clone(), sideBottomEdgesBox)

    // Cut side edge between walls
    const sideEdge2WBox = makeBoxMesh(
        bb.min.x,
        bb.min.x + cornerRadius,
        bb.min.y,
        bb.min.y + cornerRadius,
        bb.min.z + cornerRadius,
        bb.min.z + sizeZ - cornerRadius
    )
    const sideEdge2WMesh = cutByMeshBox(baseGeom.clone(), sideEdge2WBox)

    // Cut side wall
    const sideWallBox = makeBoxMesh(
        bb.min.x + cornerRadius,
        bb.min.x + sizeX - cornerRadius,
        bb.min.y,
        bb.min.y + cornerRadius,
        bb.min.z + cornerRadius,
        bb.min.z + sizeZ - cornerRadius
    )
    const sideWallMesh = cutByMeshBox(baseGeom.clone(), sideWallBox)

    // Cut bottom floor
    const bottomFloorBox = makeBoxMesh(
        bb.min.x + cornerRadius,
        bb.min.x + sizeX - cornerRadius,
        bb.min.y + cornerRadius,
        bb.min.y + sizeY - cornerRadius,
        bb.min.z,
        bb.min.z + cornerRadius
    )
    const bottomFloorMesh = cutByMeshBox(baseGeom.clone(), bottomFloorBox)

    // Cut bottom edge with 0 walls
    const bottomEdge0WBox = makeBoxMesh(
        bb.min.x + sizeX - cornerRadius,
        bb.min.x + sizeX,
        bb.min.y + cornerRadius,
        bb.min.y + sizeY - cornerRadius,
        bb.min.z,
        bb.min.z + cornerRadius
    )
    const bottomEdge0WMesh = cutByMeshBox(baseGeom.clone(), bottomEdge0WBox)

    // Trim all the cut parts to start from origin
    trimBufferGeometryToOrigin(bottomCorner2WMesh)
    trimBufferGeometryToOrigin(topCorner2WMesh)
    trimBufferGeometryToOrigin(bottomCorner1WRightMesh)
    trimBufferGeometryToOrigin(bottomCorner1WLeftMesh)
    trimBufferGeometryToOrigin(topCorner1WMesh)
    trimBufferGeometryToOrigin(bottomCorner0WMesh)
    trimBufferGeometryToOrigin(sideTopEdgesMesh)
    trimBufferGeometryToOrigin(sideBottomEdgesMesh)
    trimBufferGeometryToOrigin(sideEdge2WMesh)
    trimBufferGeometryToOrigin(sideWallMesh)
    trimBufferGeometryToOrigin(bottomFloorMesh)
    trimBufferGeometryToOrigin(bottomEdge0WMesh)

    // Validate each part before returning
    const parts = {
        bottomCorner2W: bottomCorner2WMesh as THREE.BufferGeometry,
        topCorner2W: topCorner2WMesh as THREE.BufferGeometry,
        bottomCorner1WRightNear: bottomCorner1WRightMesh as THREE.BufferGeometry,
        bottomCorner1WLeftFar: bottomCorner1WLeftMesh as THREE.BufferGeometry,
        topCorner1W: topCorner1WMesh as THREE.BufferGeometry,
        bottomCorner0W: bottomCorner0WMesh as THREE.BufferGeometry,
        sideTopEdges: sideTopEdgesMesh as THREE.BufferGeometry,
        sideBottomEdges: sideBottomEdgesMesh as THREE.BufferGeometry,
        sideEdge2W: sideEdge2WMesh as THREE.BufferGeometry,
        sideWall: sideWallMesh as THREE.BufferGeometry,
        bottomFloor: bottomFloorMesh as THREE.BufferGeometry,
        bottomEdge0W: bottomEdge0WMesh as THREE.BufferGeometry,
    } as Subparts

    // Validate all parts
    Object.entries(parts).forEach(([name, geometry]) => {
        validateGeometry(geometry, `cutToParts ${name}`)
    })

    return parts

}

function reassemble(subparts: Subparts, gridResult: GridResult, cornerCuttingRadius: number, height: number, rows: number, cols: number, dividerThickness?: number, unionAll?: boolean): THREE.BufferGeometry {

    debugLog('Starting reassemble with dimensions:', { height, rows, cols, dividerThickness })

    // Validate input parts
    Object.entries(subparts).forEach(([name, geometry]) => {
        validateGeometry(geometry, `reassemble input ${name}`)
    })

    // Create arrays to store all the geometries we'll merge
    const geometries: THREE.BufferGeometry[] = []

    // calculate the size of the container
    const containerSizeX = gridResult.sizeX * cols
    const containerSizeY = gridResult.sizeY * rows
    const containerSizeZ = height

    // put in the 4 bottom and top corners and side edges, use bottomCorner2W and topCorner2W
    // they should position themselves to 4 bottom/top corners
    // rotate 90 degrees around Z for each corner so that they are all "facing" inside
    for (let i = 0; i < 4; i++) {
        const bottomCorner2W = subparts.bottomCorner2W.clone()
        rotateZWithTrim(bottomCorner2W, Math.PI / 2 * i)

        const topCorner2W = subparts.topCorner2W.clone()
        rotateZWithTrim(topCorner2W, Math.PI / 2 * i)

        const topZposition = containerSizeZ - cornerCuttingRadius

        const sideEdge2W = subparts.sideEdge2W.clone()
        // scale sideEdge2W to the height of the container - 2 * cornerCuttingRadius
        sideEdge2W.scale(1, 1, (containerSizeZ - 2 * cornerCuttingRadius) / sideEdge2W.boundingBox!.max.z)
        rotateZWithTrim(sideEdge2W, Math.PI / 2 * i)
        const sideEdge2WZposition = bottomCorner2W.boundingBox!.max.z
        // move and align to the corner it belongs to
        switch (i) {
            case 0: // near-left corner
                bottomCorner2W.translate(0, 0, 0)
                topCorner2W.translate(0, 0, topZposition)
                sideEdge2W.translate(0, 0, sideEdge2WZposition)
                break
            case 1: // near-right
                bottomCorner2W.translate(containerSizeX - cornerCuttingRadius, 0, 0)
                topCorner2W.translate(containerSizeX - cornerCuttingRadius, 0, topZposition)
                sideEdge2W.translate(containerSizeX - cornerCuttingRadius, 0, sideEdge2WZposition)
                break
            case 2: // far-right 
                bottomCorner2W.translate(containerSizeX - cornerCuttingRadius, containerSizeY - cornerCuttingRadius, 0)
                topCorner2W.translate(containerSizeX - cornerCuttingRadius, containerSizeY - cornerCuttingRadius, topZposition)
                sideEdge2W.translate(containerSizeX - cornerCuttingRadius, containerSizeY - cornerCuttingRadius, sideEdge2WZposition)
                break
            case 3: // far-left
                bottomCorner2W.translate(0, containerSizeY - cornerCuttingRadius, 0)
                topCorner2W.translate(0, containerSizeY - cornerCuttingRadius, topZposition)
                sideEdge2W.translate(0, containerSizeY - cornerCuttingRadius, sideEdge2WZposition)
                break
        }
        geometries.push(bottomCorner2W)
        geometries.push(topCorner2W)
        geometries.push(sideEdge2W)
    }

    // fill the near / far edges with sideBottomEdges and corner1W
    const xIterations = Math.round(containerSizeX / gridResult.sizeX)
    console.log('iterations for near/far side edges:', xIterations)
    {
        for (let j = 0; j < xIterations; j++) {
            // assemble the edges
            // line up edge + corner1W + corner1W(mirrored) + edge + ....
            const sideBottomEdge = subparts.sideBottomEdges.clone()
            const sideBottomEdgeFar = sideBottomEdge.clone()
            rotateZWithTrim(sideBottomEdgeFar, Math.PI)

            sideBottomEdge.translate(j * gridResult.sizeX + cornerCuttingRadius, 0, 0)
            geometries.push(sideBottomEdge)

            sideBottomEdgeFar.translate(j * gridResult.sizeX + cornerCuttingRadius, containerSizeY - cornerCuttingRadius, 0)
            geometries.push(sideBottomEdgeFar)


            const corner1WNearLeft = subparts.bottomCorner1WRightNear.clone()
            const corner1WNearRight = corner1WNearLeft.clone()
            flipGeometryWithTrim(corner1WNearRight, 'x')

            const corner1WFarLeft = corner1WNearRight.clone()
            rotateZWithTrim(corner1WFarLeft, Math.PI)
            const corner1WFarRight = corner1WNearLeft.clone()
            rotateZWithTrim(corner1WFarRight, Math.PI)

            if (j > 0) {
                corner1WNearLeft.translate(j * gridResult.sizeX - cornerCuttingRadius, 0, 0)
                corner1WNearRight.translate(j * gridResult.sizeX, 0, 0)
                geometries.push(corner1WNearLeft)
                geometries.push(corner1WNearRight)

                corner1WFarLeft.translate(j * gridResult.sizeX - cornerCuttingRadius, containerSizeY - cornerCuttingRadius, 0)
                corner1WFarRight.translate(j * gridResult.sizeX, containerSizeY - cornerCuttingRadius, 0)
                geometries.push(corner1WFarLeft)
                geometries.push(corner1WFarRight)
            }

        }
    }

    const yIterations = Math.round(containerSizeY / gridResult.sizeY)
    console.log('iterations for near/far edges:', yIterations)

    // fill the left / right edges with sideBottomEdges and corner1W
    {
        for (let j = 0; j < yIterations; j++) {
            // assemble the edges
            const sideBottomLeftEdge = subparts.sideBottomEdges.clone()
            rotateZWithTrim(sideBottomLeftEdge, -Math.PI / 2)
            const sideBottomRightEdge = sideBottomLeftEdge.clone()
            rotateZWithTrim(sideBottomRightEdge, Math.PI)

            sideBottomLeftEdge.translate(0, j * gridResult.sizeY + cornerCuttingRadius, 0)
            geometries.push(sideBottomLeftEdge)

            sideBottomRightEdge.translate(containerSizeX - cornerCuttingRadius, j * gridResult.sizeY + cornerCuttingRadius, 0)
            geometries.push(sideBottomRightEdge)

            const cornerLeft1WNear = subparts.bottomCorner1WLeftFar.clone()
            const cornerLeft1WFar = cornerLeft1WNear.clone()
            flipGeometryWithTrim(cornerLeft1WFar, 'y')

            const cornerRight1WNear = cornerLeft1WFar.clone().rotateZ(Math.PI)
            trimBufferGeometryToOrigin(cornerRight1WNear)
            const cornerRight1WFar = cornerLeft1WNear.clone().rotateZ(Math.PI)
            trimBufferGeometryToOrigin(cornerRight1WFar)

            if (j > 0) {
                cornerLeft1WNear.translate(0, j * gridResult.sizeY - cornerCuttingRadius, 0)
                cornerLeft1WFar.translate(0, j * gridResult.sizeY, 0)
                geometries.push(cornerLeft1WNear)
                geometries.push(cornerLeft1WFar)

                cornerRight1WNear.translate(containerSizeX - cornerCuttingRadius, j * gridResult.sizeY - cornerCuttingRadius, 0)
                cornerRight1WFar.translate(containerSizeX - cornerCuttingRadius, j * gridResult.sizeY, 0)
                geometries.push(cornerRight1WNear)
                geometries.push(cornerRight1WFar)
            }
        }
    }

    {

        for (let x = 0; x < xIterations; x++) {
            for (let y = 0; y < yIterations; y++) {
                // fill the floors
                const bottomFloor = subparts.bottomFloor.clone()
                bottomFloor.translate(x * gridResult.sizeX + cornerCuttingRadius, y * gridResult.sizeY + cornerCuttingRadius, 0)
                geometries.push(bottomFloor)

                if (y > 0) {
                    // fill left to right floor edges with 0 walls
                    const bottomEdge0WLeftNear = subparts.bottomEdge0W.clone()
                    rotateZWithTrim(bottomEdge0WLeftNear, Math.PI / 2)
                    const bottomEdge0WLeftFar = subparts.bottomEdge0W.clone()
                    rotateZWithTrim(bottomEdge0WLeftFar, -Math.PI / 2)

                    bottomEdge0WLeftFar.translate(x * gridResult.sizeX + cornerCuttingRadius, y * gridResult.sizeY, 0)
                    bottomEdge0WLeftNear.translate(x * gridResult.sizeX + cornerCuttingRadius, y * gridResult.sizeY - cornerCuttingRadius, 0)

                    geometries.push(bottomEdge0WLeftNear)
                    geometries.push(bottomEdge0WLeftFar)
                }

                if (x > 0) {
                    // fill near to far floor edges with 0 walls
                    const bottomEdge0WNearLeft = subparts.bottomEdge0W.clone()
                    const bottomEdge0WNearRight = bottomEdge0WNearLeft.clone()
                    rotateZWithTrim(bottomEdge0WNearRight, Math.PI)

                    bottomEdge0WNearLeft.translate(x * gridResult.sizeX - cornerCuttingRadius, y * gridResult.sizeY + cornerCuttingRadius, 0)
                    bottomEdge0WNearRight.translate(x * gridResult.sizeX, y * gridResult.sizeY + cornerCuttingRadius, 0)

                    geometries.push(bottomEdge0WNearLeft)
                    geometries.push(bottomEdge0WNearRight)
                }

                if (x > 0 && y > 0) {
                    // bottom corners with 0 walls
                    const bottomCorner0WLeftNear = subparts.bottomCorner0W.clone()
                    const bottomCorner0WLeftFar = bottomCorner0WLeftNear.clone()
                    rotateZWithTrim(bottomCorner0WLeftFar, -Math.PI / 2)
                    const bottomCorner0WRightFar = bottomCorner0WLeftNear.clone()
                    rotateZWithTrim(bottomCorner0WRightFar, Math.PI)
                    const bottomCorner0WRightNear = bottomCorner0WLeftNear.clone()
                    rotateZWithTrim(bottomCorner0WRightNear, Math.PI / 2)
                    bottomCorner0WLeftNear.translate(x * gridResult.sizeX - cornerCuttingRadius, y * gridResult.sizeY - cornerCuttingRadius, 0)
                    bottomCorner0WLeftFar.translate(x * gridResult.sizeX - cornerCuttingRadius, y * gridResult.sizeY, 0)
                    bottomCorner0WRightFar.translate(x * gridResult.sizeX, y * gridResult.sizeY, 0)
                    bottomCorner0WRightNear.translate(x * gridResult.sizeX, y * gridResult.sizeY - cornerCuttingRadius, 0)
                    geometries.push(bottomCorner0WLeftNear)
                    geometries.push(bottomCorner0WLeftFar)
                    geometries.push(bottomCorner0WRightFar)
                    geometries.push(bottomCorner0WRightNear)
                }
            }
        }
    }

    // fill the side walls
    const nearSideWall = subparts.sideWall.clone()
    nearSideWall.scale((containerSizeX - 2 * cornerCuttingRadius) / nearSideWall.boundingBox!.max.x, 1,
        (height - 2 * cornerCuttingRadius) / nearSideWall.boundingBox!.max.z)
    trimBufferGeometryToOrigin(nearSideWall)
    nearSideWall.translate(cornerCuttingRadius, 0, cornerCuttingRadius)
    geometries.push(nearSideWall)

    const farSideWall = nearSideWall.clone()
    rotateZWithTrim(farSideWall, Math.PI)
    farSideWall.translate(cornerCuttingRadius, containerSizeY - farSideWall.boundingBox!.max.y, cornerCuttingRadius)
    geometries.push(farSideWall)

    const nearSideTopEdge = subparts.sideTopEdges.clone()
    nearSideTopEdge.scale((containerSizeX - 2 * cornerCuttingRadius) / nearSideTopEdge.boundingBox!.max.x, 1, 1)
    trimBufferGeometryToOrigin(nearSideTopEdge)
    nearSideTopEdge.translate(cornerCuttingRadius, 0, containerSizeZ - cornerCuttingRadius)
    geometries.push(nearSideTopEdge)

    const farSideTopEdge = nearSideTopEdge.clone()
    rotateZWithTrim(farSideTopEdge, Math.PI)
    farSideTopEdge.translate(cornerCuttingRadius, containerSizeY - farSideTopEdge.boundingBox!.max.y, containerSizeZ - cornerCuttingRadius)
    geometries.push(farSideTopEdge)

    const leftSideWall = subparts.sideWall.clone()
    rotateZWithTrim(leftSideWall, -Math.PI / 2)
    leftSideWall.scale(1, (containerSizeY - 2 * cornerCuttingRadius) / leftSideWall.boundingBox!.max.y,
        (height - 2 * cornerCuttingRadius + OVERLAP_THICKNESS) / leftSideWall.boundingBox!.max.z)
    trimBufferGeometryToOrigin(leftSideWall)
    leftSideWall.translate(0, cornerCuttingRadius, cornerCuttingRadius)
    geometries.push(leftSideWall)

    const rightSideWall = leftSideWall.clone()
    rotateZWithTrim(rightSideWall, Math.PI)
    rightSideWall.translate(containerSizeX - rightSideWall.boundingBox!.max.x, cornerCuttingRadius, cornerCuttingRadius)
    geometries.push(rightSideWall)

    const leftSideTopEdge = subparts.sideTopEdges.clone()
    rotateZWithTrim(leftSideTopEdge, -Math.PI / 2)
    leftSideTopEdge.scale(1, (containerSizeY - 2 * cornerCuttingRadius) / leftSideTopEdge.boundingBox!.max.y, 1)
    trimBufferGeometryToOrigin(leftSideTopEdge)
    leftSideTopEdge.translate(0, cornerCuttingRadius, containerSizeZ - cornerCuttingRadius)
    geometries.push(leftSideTopEdge)

    const rightSideTopEdge = leftSideTopEdge.clone()
    rotateZWithTrim(rightSideTopEdge, Math.PI)
    rightSideTopEdge.translate(containerSizeX - rightSideTopEdge.boundingBox!.max.x, cornerCuttingRadius, containerSizeZ - cornerCuttingRadius)
    geometries.push(rightSideTopEdge)


    if (geometries.length === 0) {
        throw new Error('No geometries to merge')
    }


    const merged = unionAll ? unionAllGeometry(geometries) : BufferGeometryUtils.mergeGeometries(geometries, true)
    if (!merged) {
        throw new Error('Failed to merge geometries')
    }

    // Fix any non-manifold edges
    const fixed = fixNonManifoldGeometry(merged)

    validateGeometry(fixed, 'reassemble output')
    return fixed
}

function trimBufferGeometryToOrigin(geometry: THREE.BufferGeometry) {
    const bbox = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position as THREE.BufferAttribute)
    geometry.translate(
        -bbox.min.x,
        -bbox.min.y,
        -bbox.min.z
    )
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
}

function cutByMeshBox(geometry: THREE.BufferGeometry, meshBox: THREE.Mesh) {
    geometry.computeBoundingBox()
    geometry.computeVertexNormals()
    geometry.computeTangents()
    geometry.computeBoundingSphere()
    trimBufferGeometryToOrigin(geometry)

    const bvh1 = new MeshBVH(geometry)
    const bvh2 = new MeshBVH(meshBox.geometry)

    if (!geometry.attributes.uv) {
        const vertexCount = geometry.attributes.position.count
        // Create a Float32Array of size (vertexCount * 2)
        // to store placeholder (u,v) pairs for each vertex
        const dummyUVs = new Float32Array(vertexCount * 2)
        // For example, we could just set them all to (0,0) 
        // or some repeating pattern as needed.

        // Now set it as the uv attribute
        geometry.setAttribute(
            'uv',
            new THREE.BufferAttribute(dummyUVs, 2)
        )

        // // Generate UVs based on the bounding box
        // const bbox = geometry.boundingBox!
        // const positions = geometry.attributes.position
        // const uvs = new Float32Array(positions.count * 2)

        // for (let i = 0; i < positions.count; i++) {
        //     const x = positions.getX(i)
        //     const y = positions.getY(i)
        //     const z = positions.getZ(i)

        //     // Project UVs based on position relative to bounding box
        //     uvs[i * 2] = (x - bbox.min.x) / (bbox.max.x - bbox.min.x)
        //     uvs[i * 2 + 1] = (y - bbox.min.y) / (bbox.max.y - bbox.min.y)
        // }

        // geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    }


    if (geometry.index === null) {
        console.log('Adding index to baseGeom')
        const indices = []
        const positions = geometry.attributes.position
        for (let i = 0; i < positions.count; i++) {
            indices.push(i)
        }
        geometry.setIndex(indices)
    }

    const brush1 = new Brush(geometry)
    brush1.updateMatrixWorld()

    const brush2 = new Brush(meshBox.geometry)
    brush2.updateMatrixWorld()

    const evaluator = new Evaluator()
    const result = evaluator.evaluate(brush1, brush2, INTERSECTION)

    let geometry2 = result.geometry
    // Suppose you have a BufferGeometry called geometry
    // (Make sure you remove or recompute normals if needed)
    geometry2.deleteAttribute('normal')

    // Attempt to merge close vertices so you don't have edges 
    // that appear separate but are actually the same
    geometry2 = BufferGeometryUtils.mergeVertices(geometry2, MERGE_VERTICES_TOLERANCE)

    // Recompute normals afterwards
    geometry2.computeVertexNormals()

    return geometry2
}

// A helper to build a "cutter" box mesh covering [xMin..xMax, yMin..yMax, zMin..zMax].
function makeBoxMesh(
    xMin: number, xMax: number,
    yMin: number, yMax: number,
    zMin: number, zMax: number
): THREE.Mesh {
    const sizeX = xMax - xMin + OVERLAP_THICKNESS
    const sizeY = yMax - yMin + OVERLAP_THICKNESS
    const sizeZ = zMax - zMin + OVERLAP_THICKNESS

    const boxGeom = new THREE.BoxGeometry(sizeX, sizeY, sizeZ)
    // shift it so that the box is exactly in [xMin..xMax, yMin..yMax, zMin..zMax]
    boxGeom.translate(
        xMin - OVERLAP_THICKNESS / 2 + sizeX / 2,
        yMin - OVERLAP_THICKNESS / 2 + sizeY / 2,
        zMin - OVERLAP_THICKNESS / 2 + sizeZ / 2
    )

    const mesh = new THREE.Mesh(boxGeom, basicMaterial())
    mesh.updateMatrix()
    return mesh
}

function rotateZWithTrim(geometry: THREE.BufferGeometry, angle: number) {
    geometry.rotateZ(angle)
    trimBufferGeometryToOrigin(geometry)
}

function flipGeometryWithTrim(geometry: THREE.BufferGeometry, axis: ('x' | 'y' | 'z')) {
    const positionAttribute = geometry.attributes.position

    for (let i = 0; i < positionAttribute.count; i++) {
        switch (axis) {
            case 'x':
                positionAttribute.setX(i, -positionAttribute.getX(i))
                break
            case 'y':
                positionAttribute.setY(i, -positionAttribute.getY(i))
                break
            case 'z':
                positionAttribute.setZ(i, -positionAttribute.getZ(i))
                break
        }
    }

    // Reverse indices to maintain correct face orientation when flipping
    geometry.setIndex(Array.from(geometry.index?.array || []).reverse())

    // Update normals
    geometry.computeVertexNormals()

    trimBufferGeometryToOrigin(geometry)
}

function unionTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
    const brush1 = new Brush(a)
    brush1.updateMatrixWorld()

    const brush2 = new Brush(b)
    brush2.updateMatrixWorld()

    const evaluator = new Evaluator()
    const result = evaluator.evaluate(brush1, brush2, ADDITION)
    return result.geometry
}

function unionAllGeometry(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
    if (!geoms.length) throw new Error('No geometry to union')
    if (geoms.length === 1) return geoms[0]

    let result = geoms[0]
    for (let i = 1; i < geoms.length; i++) {
        result = unionTwo(result, geoms[i])
    }

    return result
}

function fixNonManifoldGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {

    let output = geometry
    do {
        const verticesLengthBegin = output.attributes.position.array.length
        // Optionally remove existing normals if they're invalid
        output.deleteAttribute('normal')

        // 1. Merge vertices that are very close to each other
        output = BufferGeometryUtils.mergeVertices(output, MERGE_VERTICES_TOLERANCE)

        // 2. Remove duplicate faces
        output = removeDuplicateFaces(output)

        // Remove any degenerate triangles (optional but helpful)
        output = removeDegenerateTriangles(output)

        output = BufferGeometryUtils.mergeVertices(output, MERGE_VERTICES_TOLERANCE)

        // 3. Ensure consistent face orientation
        output.computeVertexNormals()

        const verticesLengthAfter = output.attributes.position.array.length
        if (verticesLengthAfter == verticesLengthBegin) {
            break
        }
    } while (true)

    return geometry
}

function removeDegenerateTriangles(geometry: THREE.BufferGeometry) {
    // Ensure we're working with an indexed geometry
    if (!geometry.index) {
        geometry = BufferGeometryUtils.mergeVertices(geometry)
    }

    const positions = geometry.attributes.position
    const indices = Array.from(geometry.index!.array)
    const newIndices: number[] = []

    // Track which vertices are actually used
    const usedVertices = new Set<number>()

    // Check each triangle
    for (let i = 0; i < indices.length - 2; i += 3) {
        const a = indices[i]
        const b = indices[i + 1]
        const c = indices[i + 2]

        // Get vertex positions
        const ax = positions.getX(a), ay = positions.getY(a), az = positions.getZ(a)
        const bx = positions.getX(b), by = positions.getY(b), bz = positions.getZ(b)
        const cx = positions.getX(c), cy = positions.getY(c), cz = positions.getZ(c)

        const area = triangleArea(ax, ay, az, bx, by, bz, cx, cy, cz)

        // Keep non-degenerate triangles
        if (area > MIN_TRIANGLE_AREA) {
            newIndices.push(a, b, c)
            usedVertices.add(a)
            usedVertices.add(b)
            usedVertices.add(c)
        }
    }

    // Create new geometry with only used vertices and remapped indices
    const newPositions: number[] = []
    const oldToNewIndex = new Map<number, number>()
    let nextIndex = 0

    // Build new position array and index mapping
    usedVertices.forEach(oldIndex => {
        newPositions.push(
            positions.getX(oldIndex),
            positions.getY(oldIndex),
            positions.getZ(oldIndex)
        )
        oldToNewIndex.set(oldIndex, nextIndex++)
    })

    // Remap indices to new positions
    const remappedIndices = newIndices.map(oldIndex => oldToNewIndex.get(oldIndex)!)

    // Create new geometry
    const newGeometry = new THREE.BufferGeometry()
    newGeometry.setAttribute('position',
        new THREE.Float32BufferAttribute(newPositions, 3))
    newGeometry.setIndex(remappedIndices)

    // Copy any other attributes (UVs, etc.) if they exist
    Object.entries(geometry.attributes).forEach(([name, attribute]) => {
        if (name !== 'position') {
            const newAttrArray: number[] = []
            usedVertices.forEach(oldIndex => {
                for (let i = 0; i < attribute.itemSize; i++) {
                    newAttrArray.push(attribute.array[oldIndex * attribute.itemSize + i])
                }
            })
            newGeometry.setAttribute(name,
                new THREE.Float32BufferAttribute(newAttrArray, attribute.itemSize))
        }
    })

    // Recompute bounds and normals
    newGeometry.computeBoundingBox()
    newGeometry.computeBoundingSphere()
    newGeometry.computeVertexNormals()

    return newGeometry
}

function triangleArea(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) {
    // Cross product approach
    const ABx = bx - ax, ABy = by - ay, ABz = bz - az
    const ACx = cx - ax, ACy = cy - ay, ACz = cz - az
    // Cross product magnitude is area * 2
    const crossX = ABy * ACz - ABz * ACy
    const crossY = ABz * ACx - ABx * ACz
    const crossZ = ABx * ACy - ABy * ACx
    return 0.5 * Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ)
}

function removeDuplicateFaces(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
    const positions = geometry.attributes.position.array
    const indices = geometry.index ? Array.from(geometry.index.array) : null

    if (!indices) return geometry // Can't process non-indexed geometry

    const uniqueFaces = new Set<string>()
    const newIndices: number[] = []

    // Process each triangle
    for (let i = 0; i < indices.length - 2; i += 3) {
        const a = indices[i]
        const b = indices[i + 1]
        const c = indices[i + 2]

        // Create a unique key for this face (sorted to handle different rotations)
        const key = [a, b, c].sort().join(',')

        if (!uniqueFaces.has(key)) {
            uniqueFaces.add(key)
            newIndices.push(a, b, c)
        }
    }

    // Create new geometry with unique faces
    const newGeometry = geometry.clone()
    newGeometry.setIndex(newIndices)

    return newGeometry
}


/**
 * Returns true if the geometry has any non‐manifold edges, false otherwise.
 */
function hasNonManifoldEdges(geometry: THREE.BufferGeometry): boolean {
    // Ensure it's indexed. If unindexed, convert it.
    let indices: number[]

    if (geometry.index) {
        // If already indexed, use existing indices
        indices = Array.from(geometry.index.array)
    } else {
        // If not indexed, create indices (3 per triangle)
        indices = []
        const positions = geometry.attributes.position
        for (let i = 0; i < positions.count; i++) {
            indices.push(i)
        }
    }

    // Map of "edgeKey" -> number of faces that share this edge
    const edgeCount: Record<string, number> = {}

    // Helper to record an edge in the map, ensuring the key is sorted
    const addEdge = (i1: number, i2: number) => {
        // Sort so that edge AB == BA
        if (i2 < i1) {
            const tmp = i1
            i1 = i2
            i2 = tmp
        }
        const edgeKey = `${i1}_${i2}`
        edgeCount[edgeKey] = (edgeCount[edgeKey] || 0) + 1
    }

    // Iterate over the triangles (3 indices at a time)
    for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i]
        const b = indices[i + 1]
        const c = indices[i + 2]
        addEdge(a, b)
        addEdge(b, c)
        addEdge(c, a)
    }

    // Now check the counts for each edge
    // - If an edge is used by > 2 faces => non‐manifold
    // - If an edge is used by only 1 face => boundary (open) edge
    //   (may or may not be considered “non‐manifold” depending on your definition)
    for (const key in edgeCount) {
        const count = edgeCount[key]
        if (count > 2) {
            // Definitely non‐manifold
            return true
        }
        //If you require a fully closed mesh, then check for count < 2 as well
        if (count < 2) {
            return true
        }
    }

    // If we made it here, no edge is used by >2 (and possibly not <2 if you checked that)
    return false
}
'use client'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

interface ModelViewerProps {
    model: "input" | "output"
    stlFile?: File
    stlBuffer?: ArrayBuffer
}

export default function ModelViewer({ model, stlFile, stlBuffer }: ModelViewerProps) {
    const mountRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!mountRef.current) return

        // Store ref in a variable to use in cleanup
        const mount = mountRef.current

        const scene = new THREE.Scene()
        scene.background = new THREE.Color(0xf0f0f0)
        const camera = new THREE.PerspectiveCamera(75, mountRef.current.clientWidth / mountRef.current.clientHeight, 0.1, 1000)
        const renderer = new THREE.WebGLRenderer({ antialias: true })

        renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight)
        mount.appendChild(renderer.domElement)

        const controls = new OrbitControls(camera, renderer.domElement)
        camera.position.set(4, 4, 4)
        camera.lookAt(0, 0, 0)

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8)
        scene.add(ambientLight)
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
        directionalLight.position.set(1, 1, 1)
        scene.add(directionalLight)

        const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5)
        directionalLight2.position.set(-1, -1, -1)
        scene.add(directionalLight2)

        const animate = () => {
            requestAnimationFrame(animate)
            controls.update()
            renderer.render(scene, camera)
        }

        animate()

        // Load STL file
        const loader = new STLLoader()
        if (stlFile) {
            stlFile.arrayBuffer().then(loadGeometry)
        } else {
            if (model === 'input') {
                // Fetch default STL file from server
                fetch(`/models/default`)
                    .then(response => response.arrayBuffer())
                    .then(loadGeometry)
                    .catch(error => console.error('Error loading default model:', error))
            } else {
                // use stlBuffer
                if (stlBuffer) {
                    loadGeometry(stlBuffer)
                    console.log('Loaded STL buffer: ', stlBuffer.byteLength)
                } else {
                    // console.error('No STL buffer provided')
                }
            }
        }

        function loadGeometry(buffer: ArrayBuffer) {
            const geometry = loader.parse(buffer)
            geometry.center()

            const material = new THREE.MeshPhongMaterial({
                color: 0xcccccc,
                specular: 0x444444,
                shininess: 30,
                flatShading: false
            })
            const mesh = new THREE.Mesh(geometry, material)

            geometry.computeBoundingBox()
            const boundingBox = geometry.boundingBox
            if (boundingBox) {
                const size = new THREE.Vector3()
                boundingBox.getSize(size)
                const maxDim = Math.max(size.x, size.y, size.z)
                const scale = 5 / maxDim
                mesh.scale.set(scale, scale, scale)
            }

            scene.add(mesh)

            camera.position.set(4, 4, 4)
            controls.update()
        }

        return () => {
            mount.removeChild(renderer.domElement)
            renderer.dispose()
        }
    }, [stlFile, model, stlBuffer])

    return <div ref={mountRef} className="w-full h-full" />
} 
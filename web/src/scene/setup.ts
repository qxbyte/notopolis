import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

class SoftBox extends RoundedBoxGeometry {
  constructor(w = 1, h = 1, d = 1) {
    super(w, h, d, 2, Math.min(0.14, Math.min(w, h, d) * 0.24))
  }
}
;(THREE as any).BoxGeometry = SoftBox

export function createScene(container: HTMLElement): {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  startLoop: (cb: (t: number) => void) => void
} {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setSize(container.clientWidth, container.clientHeight)
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x8ecbf2)

  const hemi = new THREE.HemisphereLight(0xffffff, 0x5a8a3f, 0.5)
  scene.add(hemi)

  const dirLight = new THREE.DirectionalLight(0xfff0d4, 1.18)
  dirLight.castShadow = true
  dirLight.shadow.bias = -0.0005
  dirLight.position.set(60, 80, 30)
  scene.add(dirLight)

  window.addEventListener('resize', () => {
    renderer.setSize(container.clientWidth, container.clientHeight)
  })

  function startLoop(cb: (t: number) => void): void {
    function animate(t: number) {
      requestAnimationFrame(animate)
      cb(t)
    }
    requestAnimationFrame(animate)
  }

  return { scene, renderer, startLoop }
}

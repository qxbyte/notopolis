import * as THREE from 'three'
import { createScene } from './scene/setup'

const container = document.getElementById('app') as HTMLElement
const { scene, renderer, startLoop } = createScene(container)

// 相机（F8 再抽出）
const camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 2000)
camera.position.set(8, 6, 8)
camera.lookAt(0, 0, 0)

window.addEventListener('resize', () => {
  camera.aspect = container.clientWidth / container.clientHeight
  camera.updateProjectionMatrix()
})

// 测试用圆角盒（BoxGeometry 已被 SoftBox 替换）
const box = new THREE.Mesh(
  new THREE.BoxGeometry(2, 2, 2),
  new THREE.MeshLambertMaterial({ color: 0xc0453a })
)
box.castShadow = true
scene.add(box)

// 地面平面
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.MeshLambertMaterial({ color: 0x5a8a3f })
)
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

// 渲染循环
startLoop((t) => {
  box.rotation.y = t * 0.0003
  renderer.render(scene, camera)
})

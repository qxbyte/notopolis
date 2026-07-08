import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

export class SoftBox extends RoundedBoxGeometry {
  constructor(w = 1, h = 1, d = 1) {
    super(w, h, d, 2, Math.min(0.14, Math.min(w, h, d) * 0.24))
  }
}

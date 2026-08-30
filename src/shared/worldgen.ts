import type { ObjectSpec, SceneDefinition } from './scene.js'
import { generateVoxelWorld, type VoxelWorld } from './voxel.js'

/**
 * Turns a scene document into contents the world can load.
 *
 * Everything here is a pure function of the document, which is the property the
 * rest of the app leans on: a scenario stores a seed and a short prop list, and
 * the same document rebuilds the identical world on any machine — so a score
 * stays attributable to a world that can be regenerated rather than to one that
 * happened to be on disk.
 */

export interface ResolvedScene {
  objects: ObjectSpec[]
  voxel: VoxelWorld
}

/** Builds the volume, then stands the listed props on top of it. */
export function resolveScene(scene: SceneDefinition): ResolvedScene {
  const voxel = generateVoxelWorld(scene.voxel)
  return {
    voxel,
    // Exactly on the blocks, not dropped from above and left to settle: a
    // column scan returns the true top face, so there is nothing to settle.
    objects: (scene.objects ?? []).map((spec) => ({
      ...spec,
      position: [
        spec.position[0],
        voxel.groundHeightAt(spec.position[0], spec.position[2]) + spec.size[1] / 2,
        spec.position[2]
      ] as [number, number, number]
    }))
  }
}

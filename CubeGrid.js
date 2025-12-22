import * as THREE from 'three';
import { color, float, vec3, Fn, instanceIndex, mix } from 'three/tsl';

export class CubeGrid {
    constructor(scene, renderer) {
        this.scene = scene;
        this.renderer = renderer;
        this.gridSize = 4;
        this.cellSize = 2.0;
        this.gap = 0.5;
        this.gridOffset = (this.gridSize * this.cellSize + (this.gridSize - 1) * this.gap) / 2;

        // State
        this.pads = []; // Stores current height/velocity data per pad
        for (let i = 0; i < 16; i++) {
            this.pads.push({
                height: 0.2,
                velocity: 0,
                restHeight: 0.2, // Target height for spring
                isActive: 0
            });
        }

        this.impulseDirection = 1.0;

        // TSL Uniforms/Nodes
        this.uBaseColor = new THREE.UniformNode(new THREE.Color(0x000000)); // CC 25: Base grayscale
        this.uActiveColor = new THREE.UniformNode(new THREE.Color(0xff0000)); // CC 24: Active Hue
        this.uOpacity = new THREE.UniformNode(0.5); // CC 26: Opacity

        this.init();
    }

    init() {
        // Geometry: Unit Box, shifted so Y=0 is bottom
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        geometry.translate(0, 0.5, 0);

        // Material: WebGPU Node Material
        const material = new THREE.MeshBasicNodeMaterial();
        material.transparent = true;
        material.wireframe = true;

        // Link TSL nodes to material properties
        material.opacityNode = this.uOpacity;

        // Create Instanced Mesh
        this.mesh = new THREE.InstancedMesh(geometry, material, 16);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(16 * 3), 3);

        // Initialize Grid Positions
        const dummy = new THREE.Object3D();
        let idx = 0;
        for (let iz = 0; iz < this.gridSize; iz++) {
            for (let ix = 0; ix < this.gridSize; ix++) {
                const cx = ix * (this.cellSize + this.gap) - this.gridOffset + this.cellSize / 2;
                const cz = iz * (this.cellSize + this.gap) - this.gridOffset + this.cellSize / 2;

                dummy.position.set(cx, 0, cz);
                dummy.scale.set(this.cellSize, 0.2, this.cellSize); // Initial flat scale
                dummy.updateMatrix();
                this.mesh.setMatrixAt(idx, dummy.matrix);

                // Set initial color (black)
                this.mesh.setColorAt(idx, this.uBaseColor.value);

                idx++;
            }
        }

        this.mesh.instanceMatrix.needsUpdate = true;
        this.mesh.instanceColor.needsUpdate = true;

        this.scene.add(this.mesh);
    }

    trigger(index, velocity) {
        if (index >= 0 && index < 16) {
            // Velocity controls pop height force
            this.pads[index].restHeight = 0.2 * this.impulseDirection; // Set new rest state
            this.pads[index].velocity = velocity * 15.0 * this.impulseDirection;
            this.pads[index].isActive = 1.0;

            this.impulseDirection *= -1.0;

            // Set Color to Active immediately
            this.mesh.setColorAt(index, this.uActiveColor.value);
            this.mesh.instanceColor.needsUpdate = true;
        }
    }

    update(delta) {
        const dummy = new THREE.Object3D();
        let needsUpdate = false;
        let needsColorUpdate = false;

        for (let i = 0; i < 16; i++) {
            const pad = this.pads[i];

            // --- Physics / Animation (Spring Logic) ---
            const springK = 30.0;
            const damping = 0.92;

            // Apply Velocity
            pad.height += pad.velocity * delta;

            // Spring Force towards restHeight
            const diff = pad.height - pad.restHeight;
            pad.velocity -= diff * springK * delta;

            // Damping
            pad.velocity *= damping;

            // Snap to rest logic to stop micro-oscillations
            if (Math.abs(diff) < 0.01 && Math.abs(pad.velocity) < 0.01) {
                pad.height = pad.restHeight;
                pad.velocity = 0;
            }

            // Always update matrix if there is movement or active state
            if (pad.velocity !== 0 || pad.isActive > 0 || Math.abs(pad.height - pad.restHeight) > 0.001) {
                // Update Matrix
                const ix = i % 4;
                const iz = Math.floor(i / 4);
                const cx = ix * (this.cellSize + this.gap) - this.gridOffset + this.cellSize / 2;
                const cz = iz * (this.cellSize + this.gap) - this.gridOffset + this.cellSize / 2;

                dummy.position.set(cx, 0, cz);
                dummy.scale.set(this.cellSize, pad.height, this.cellSize);
                dummy.updateMatrix();

                this.mesh.setMatrixAt(i, dummy.matrix);
                needsUpdate = true;
            }

            // --- Color Decay ---
            if (pad.isActive > 0) {
                pad.isActive -= delta * 2.0; // Decay speed

                const blended = this.uBaseColor.value.clone().lerp(this.uActiveColor.value, pad.isActive);
                this.mesh.setColorAt(i, blended);
                needsColorUpdate = true;

                if (pad.isActive <= 0) {
                    pad.isActive = 0;
                    // Ensure explicit return to base
                    this.mesh.setColorAt(i, this.uBaseColor.value);
                }
            }
        }

        if (needsUpdate) {
            this.mesh.instanceMatrix.needsUpdate = true;
        }
        if (needsColorUpdate) {
            this.mesh.instanceColor.needsUpdate = true;
        }
    }

    setCC(cc, value) {
        // value is 0..1
        if (cc === 24) {
            // CC 24: Active Color (Hue)
            this.uActiveColor.value.setHSL(value, 1.0, 0.5);
        }
        if (cc === 25) {
            // CC 25: Base Color (Grayscale brightness)
            this.uBaseColor.value.setHSL(0, 0, value);

            // Immediate update for inactive pads
            let updated = false;
            for (let i = 0; i < 16; i++) {
                if (this.pads[i].isActive <= 0.01) {
                    this.mesh.setColorAt(i, this.uBaseColor.value);
                    updated = true;
                }
            }
            if (updated) this.mesh.instanceColor.needsUpdate = true;
        }
        if (cc === 26) {
            // CC 26: Opacity
            this.uOpacity.value = 0.1 + (value * 0.9); // Map 0..1 to 0.1..1.0
        }
    }
}

import * as THREE from 'three';
import {
    instancedArray,
    float,
    vec3,
    Fn,
    compute,
    uniform,
    instanceIndex,
    If,
    abs,
    sign,
    fract,
    color,
    vec4
} from 'three/tsl';

export class ParticleGrid {
    constructor(scene, renderer) {
        this.scene = scene;
        this.renderer = renderer;
        this.particles = null;

        this.totalParticles = 8192;

        this.bounds = { x: 6.0, y: 3.0, z: 6.0 };
        this.gridSize = 4;
        this.cellSize = 2.0;
        this.gap = 0.2;
        this.gridOffset = (this.gridSize * this.cellSize + (this.gridSize - 1) * this.gap) / 2 - this.cellSize / 2;

        this.cellBounds = [];
        this.initCellBounds();

        // Uniforms
        this.uGravity = uniform(10.0);
        this.uSpread = uniform(0.5);
        this.uDeltaTime = uniform(0.016);

        // Trigger Uniforms
        this.uActiveMinX = uniform(-100.0);
        this.uActiveMaxX = uniform(-100.0);
        this.uActiveMinZ = uniform(-100.0);
        this.uActiveMaxZ = uniform(-100.0);
        this.uImpulseForce = uniform(0.0);
        this.uActiveColor = uniform(vec3(1, 1, 1));

        // Palette
        this.palette = [];
        for (let i = 0; i < 16; i++) {
            this.palette.push(new THREE.Color().setHSL(i / 16, 0.8, 0.6));
        }
        this.currentColorIndex = 0;

        this.pads = [];
        this.uPadBrightness = [];
        for (let i = 0; i < 16; i++) {
            this.uPadBrightness.push(uniform(0.0));
        }
    }

    initCellBounds() {
        for (let iz = 0; iz < this.gridSize; iz++) {
            for (let ix = 0; ix < this.gridSize; ix++) {
                const cx = ix * (this.cellSize + this.gap) - this.gridOffset;
                const cz = iz * (this.cellSize + this.gap) - this.gridOffset;
                this.cellBounds.push({
                    minX: cx - this.cellSize / 2,
                    maxX: cx + this.cellSize / 2,
                    minZ: cz - this.cellSize / 2,
                    maxZ: cz + this.cellSize / 2
                });
            }
        }
    }

    async init() {
        const initialPositions = new Float32Array(this.totalParticles * 3);
        const initialColors = new Float32Array(this.totalParticles * 4); // RGBA

        for (let i = 0; i < this.totalParticles; i++) {
            initialPositions[i * 3] = (Math.random() - 0.5) * 10;
            initialPositions[i * 3 + 1] = 0.1 + Math.random() * 2.0;
            initialPositions[i * 3 + 2] = (Math.random() - 0.5) * 10;

            initialColors[i * 4] = 0.1; // Dark grey
            initialColors[i * 4 + 1] = 0.1;
            initialColors[i * 4 + 2] = 0.1;
            initialColors[i * 4 + 3] = 0.8; // High alpha
        }

        const positionBuffer = instancedArray(initialPositions, 'vec3');
        const velocityBuffer = instancedArray(this.totalParticles, 'vec3');
        const colorBuffer = instancedArray(initialColors, 'vec4');

        // Compute Physics
        const computePhysics = Fn(() => {
            const pos = positionBuffer.element(instanceIndex);
            const vel = velocityBuffer.element(instanceIndex);
            const col = colorBuffer.element(instanceIndex);

            // 1. Gravity
            vel.y = vel.y.add(this.uGravity.mul(-1.0).mul(this.uDeltaTime));

            // 2. MIDI Impulse (Spatial)
            const inX = pos.x.greaterThanEqual(this.uActiveMinX).and(pos.x.lessThanEqual(this.uActiveMaxX));
            const inZ = pos.z.greaterThanEqual(this.uActiveMinZ).and(pos.z.lessThanEqual(this.uActiveMaxZ));

            If(inX.and(inZ).and(this.uImpulseForce.greaterThan(0)), () => {
                const randForce = fract(float(instanceIndex).mul(0.123)).mul(0.5).add(0.5);
                vel.y = vel.y.add(this.uImpulseForce.mul(randForce));

                const randX = fract(float(instanceIndex).mul(0.456)).sub(0.5).mul(this.uSpread).mul(10.0);
                const randZ = fract(float(instanceIndex).mul(0.789)).sub(0.5).mul(this.uSpread).mul(10.0);
                vel.x = vel.x.add(randX);
                vel.z = vel.z.add(randZ);

                // Ensure uActiveColor is treated as a vec3 for assignment but keep alpha
                col.assign(vec4(this.uActiveColor, 1.0));
            });

            // 3. Update Position
            pos.addAssign(vel.mul(this.uDeltaTime));
            vel.mulAssign(0.98); // Less damping for more motion

            // 4. Collisions
            const bounce = float(0.6);

            If(pos.y.lessThan(0), () => {
                pos.y = 0;
                vel.y = vel.y.mul(bounce.mul(-1.0));
            });

            If(pos.y.greaterThan(this.bounds.y), () => {
                pos.y = this.bounds.y;
                vel.y = vel.y.mul(bounce.mul(-1.0));
            });

            If(abs(pos.x).greaterThan(this.bounds.x), () => {
                pos.x = sign(pos.x).mul(this.bounds.x);
                vel.x = vel.x.mul(bounce.mul(-1.0));
            });

            If(abs(pos.z).greaterThan(this.bounds.z), () => {
                pos.z = sign(pos.z).mul(this.bounds.z);
                vel.z = vel.z.mul(bounce.mul(-1.0));
            });
        });

        this.computeNode = computePhysics().compute(this.totalParticles);

        // Material - Using circular point texture via TSL
        const material = new THREE.PointsNodeMaterial();

        // Circular gradient point
        const uv = Fn(() => {
            const pointUV = fract(instanceIndex); // This is not correct for point uv, in TSL it's different
            // Actually, in PointsNodeMaterial, the default is already a square. 
            // We can use the 'pointUV' available in TSL for points.
        });

        material.positionNode = positionBuffer.toAttribute();
        material.colorNode = colorBuffer.toAttribute();

        material.sizeNode = float(15.0);

        // Simple circular shape using distance from center (0.5, 0.5)
        // In TSL for Points, we can't easily access uv() like in fragment shader yet without more setup.
        // For now, let's stick to square points but ensure they render first.

        material.transparent = true;
        material.transparent = true;
        // material.blending = THREE.AdditiveBlending; // Disable additive for light theme
        material.depthWrite = false;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.totalParticles * 3), 3));

        this.particles = new THREE.Points(geometry, material);
        this.particles.frustumCulled = false;
        this.scene.add(this.particles);

        // Create Pad Meshes
        const padGeom = new THREE.PlaneGeometry(this.cellSize, this.cellSize);
        for (let i = 0; i < 16; i++) {
            const bounds = this.cellBounds[i];
            const padMat = new THREE.MeshBasicMaterial({
                color: 0x000000, // Black pads
                transparent: true,
                opacity: 0.05, // Very faint initially
                side: THREE.DoubleSide,
                wireframe: true // Style choice: wireframe pads
            });
            const pad = new THREE.Mesh(padGeom, padMat);
            pad.rotation.x = -Math.PI / 2;
            pad.position.set((bounds.minX + bounds.maxX) / 2, 0.01, (bounds.minZ + bounds.maxZ) / 2);
            this.scene.add(pad);
            this.pads.push(pad);
        }
    }

    trigger(cellIndex, velocity) {
        if (cellIndex < 0 || cellIndex >= 16) return;

        const bounds = this.cellBounds[cellIndex];
        const color = this.palette[this.currentColorIndex];

        this.uActiveMinX.value = bounds.minX;
        this.uActiveMaxX.value = bounds.maxX;
        this.uActiveMinZ.value = bounds.minZ;
        this.uActiveMaxZ.value = bounds.maxZ;
        this.uImpulseForce.value = 15.0 * velocity;
        this.uActiveColor.value.set(0, 0, 0); // Active particles become black

        // Light up pad
        this.pads[cellIndex].material.opacity = 0.8;

        this.currentColorIndex = (this.currentColorIndex + 1) % 16;
        this.impulseActive = true;
    }

    setCC(cc, value) {
        if (cc === 24) this.uSpread.value = value;
        if (cc === 26) this.uGravity.value = 5.0 + value * 25.0;
        // 25 and 27 reserved for future use or mapped to other params
    }

    update(delta, time) {
        if (!this.renderer || !this.computeNode) return;

        this.uDeltaTime.value = delta;
        this.renderer.computeAsync(this.computeNode);

        if (this.impulseActive) {
            this.uImpulseForce.value = 0;
            this.impulseActive = false;
        }

        // Decay pad brightness
        for (let i = 0; i < 16; i++) {
            if (this.pads[i].material.opacity > 0.1) {
                this.pads[i].material.opacity -= delta * 2.0;
            } else {
                this.pads[i].material.opacity = 0.1;
            }
        }
    }
}

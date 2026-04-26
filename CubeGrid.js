import * as THREE from 'three';
import { attribute, mix, color as tslColor, float } from 'three/tsl';

export class CubeGrid {
    constructor(scene, renderer) {
        this.scene = scene;
        this.renderer = renderer;
        this.gridSize = 4;
        this.cellSize = 0.9;
        this.gap = 0.25;
        this.gridOffset = (this.gridSize * this.cellSize + (this.gridSize - 1) * this.gap) / 2;

        this.pads = [];
        for (let i = 0; i < 16; i++) {
            this.pads.push({
                height: 0.2,
                velocity: 0,
                restHeight: 0.2,
                isActive: 0
            });
        }

        this.impulseDirection = 1.0;

        this.springK      = 30.0;
        this.damping      = 0.92;
        this.decaySpeed   = 2.0;
        this.impulseForce = 15.0;

        this.uBaseColor = new THREE.Color(0x111111);
        this.uOpacity = 0.9;

        this.padColors = Array.from({ length: 16 }, (_, i) =>
            new THREE.Color().setHSL(i / 16, 1.0, 0.5)
        );

        this.init();
    }

    init() {
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        geometry.translate(0, 0.5, 0);

        this.brightnessData = new Float32Array(16).fill(0);
        this.instanceBrightness = new THREE.InstancedBufferAttribute(this.brightnessData, 1);
        geometry.setAttribute('aBrightness', this.instanceBrightness);

        this.padColorData = new Float32Array(16 * 3);
        for (let i = 0; i < 16; i++) {
            this.padColorData[i * 3]     = this.padColors[i].r;
            this.padColorData[i * 3 + 1] = this.padColors[i].g;
            this.padColorData[i * 3 + 2] = this.padColors[i].b;
        }
        this.instancePadColor = new THREE.InstancedBufferAttribute(this.padColorData, 3);
        geometry.setAttribute('aPadColor', this.instancePadColor);

        this.volData = new Float32Array(16).fill(1.0);
        this.instanceVol = new THREE.InstancedBufferAttribute(this.volData, 1);
        geometry.setAttribute('aVol', this.instanceVol);

        const aBrightness = attribute('aBrightness', 'float');
        const aPadColor   = attribute('aPadColor',   'vec3');
        const aVol        = attribute('aVol',        'float');
        const baseColorNode = tslColor(this.uBaseColor);
        const dimmedBase = baseColorNode.mul(aVol);
        const hdrColor = aPadColor.mul(float(4.0));
        const colorNode = mix(dimmedBase, hdrColor, aBrightness);

        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            opacity: this.uOpacity,
            wireframe: true,
        });
        material.colorNode = colorNode;

        this.mesh = new THREE.InstancedMesh(geometry, material, 16);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        const dummy = new THREE.Object3D();
        for (let i = 0; i < 16; i++) {
            const ix = i % 4;
            const iz = Math.floor(i / 4);
            const cx = ix * (this.cellSize + this.gap) - this.gridOffset + this.cellSize / 2;
            const cz = iz * (this.cellSize + this.gap) - this.gridOffset + this.cellSize / 2;

            dummy.position.set(cx, 0, cz);
            dummy.scale.set(this.cellSize, 0.2, this.cellSize);
            dummy.updateMatrix();
            this.mesh.setMatrixAt(i, dummy.matrix);
        }

        this.mesh.instanceMatrix.needsUpdate = true;
        this.scene.add(this.mesh);
    }

    trigger(index, velocity, hue) {
        if (index >= 0 && index < 16) {
            this.pads[index].restHeight = 0.2 * this.impulseDirection;
            this.pads[index].velocity = velocity * this.impulseForce * this.impulseDirection;
            this.pads[index].isActive = 1.0;
            this.impulseDirection *= -1.0;

            const c = new THREE.Color().setHSL(hue, 1.0, 0.5);
            this.padColors[index].copy(c);
            this.padColorData[index * 3]     = c.r;
            this.padColorData[index * 3 + 1] = c.g;
            this.padColorData[index * 3 + 2] = c.b;
            this.instancePadColor.needsUpdate = true;
        }
    }

    update(delta) {
        const dummy = new THREE.Object3D();
        let needsMatrixUpdate = false;
        let needsBrightnessUpdate = false;

        for (let i = 0; i < 16; i++) {
            const pad = this.pads[i];

            pad.height += pad.velocity * delta;
            const diff = pad.height - pad.restHeight;
            pad.velocity -= diff * this.springK * delta;
            pad.velocity *= this.damping;

            if (Math.abs(diff) < 0.01 && Math.abs(pad.velocity) < 0.01) {
                pad.height = pad.restHeight;
                pad.velocity = 0;
            }

            if (pad.velocity !== 0 || pad.isActive > 0 || Math.abs(pad.height - pad.restHeight) > 0.001) {
                const ix = i % 4;
                const iz = Math.floor(i / 4);
                const cx = ix * (this.cellSize + this.gap) - this.gridOffset + this.cellSize / 2;
                const cz = iz * (this.cellSize + this.gap) - this.gridOffset + this.cellSize / 2;

                dummy.position.set(cx, 0, cz);
                dummy.scale.set(this.cellSize, pad.height, this.cellSize);
                dummy.updateMatrix();
                this.mesh.setMatrixAt(i, dummy.matrix);
                needsMatrixUpdate = true;
            }

            if (pad.isActive > 0) {
                pad.isActive -= delta * this.decaySpeed;
                if (pad.isActive < 0) pad.isActive = 0;
                this.brightnessData[i] = pad.isActive;
                needsBrightnessUpdate = true;
            } else if (this.brightnessData[i] !== 0) {
                this.brightnessData[i] = 0;
                needsBrightnessUpdate = true;
            }
        }

        if (needsMatrixUpdate) this.mesh.instanceMatrix.needsUpdate = true;
        if (needsBrightnessUpdate) this.instanceBrightness.needsUpdate = true;
    }

    setCC(cc, value) {
        if (cc === 24) {
            for (let i = 0; i < 16; i++) {
                this.padColors[i].setHSL((i / 16 + value) % 1.0, 1.0, 0.5);
                this.padColorData[i * 3]     = this.padColors[i].r;
                this.padColorData[i * 3 + 1] = this.padColors[i].g;
                this.padColorData[i * 3 + 2] = this.padColors[i].b;
            }
            this.instancePadColor.needsUpdate = true;
        }
        if (cc === 25) {
            this.uBaseColor.setHSL(0, 0, value);
        }
        if (cc === 26) {
            this.uOpacity = 0.1 + (value * 0.9);
            this.mesh.material.opacity = this.uOpacity;
        }
    }

    setCellVol(index, vol) {
        if (index >= 0 && index < 16) {
            this.volData[index] = vol;
            this.instanceVol.needsUpdate = true;
        }
    }

    setPhysics({ springK, damping, decaySpeed, impulseForce }) {
        if (springK      !== undefined) this.springK      = springK;
        if (damping      !== undefined) this.damping      = damping;
        if (decaySpeed   !== undefined) this.decaySpeed   = decaySpeed;
        if (impulseForce !== undefined) this.impulseForce = impulseForce;
    }
}

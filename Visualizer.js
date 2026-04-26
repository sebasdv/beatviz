import * as THREE from 'three';
import { WebGPURenderer, PostProcessing } from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CubeGrid } from './CubeGrid.js';

export class Visualizer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.grid = null;
        this.gridGroup = null;
        this.postProcessing = null;
        this.clock = new THREE.Clock();
        this.bloomStrength = 1.5;

        this.rotVelocity = 0;
        this.rotDamping = 0.95;
        this.rotImpulse = 0.8;

        this.init();
    }

    async init() {
        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 8, 10);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new WebGPURenderer({ antialias: true, alpha: true });
        await this.renderer.init();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 1);
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
        dirLight.position.set(5, 10, 5);
        this.scene.add(dirLight);

        this.gridGroup = new THREE.Group();
        this.scene.add(this.gridGroup);
        this.grid = new CubeGrid(this.gridGroup, this.renderer);

        this.postProcessing = new PostProcessing(this.renderer);
        const scenePass = pass(this.scene, this.camera);
        const sceneColor = scenePass.getTextureNode('output');
        this.bloomNode = bloom(sceneColor, this.bloomStrength, 0.5, 0.5);
        this.postProcessing.outputNode = sceneColor.add(this.bloomNode);

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        this.animate();
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();

        this.controls.update();

        if (this.grid) {
            this.grid.update(delta);
        }

        if (this.gridGroup && this.rotVelocity !== 0) {
            this.gridGroup.rotation.y += this.rotVelocity * delta;
            this.rotVelocity *= this.rotDamping;
            if (Math.abs(this.rotVelocity) < 0.001) this.rotVelocity = 0;
        }

        this.postProcessing.renderAsync();
    }

    setBloomStrength(value) {
        this.bloomStrength = value;
        if (this.bloomNode) {
            this.bloomNode.strength.value = value;
        }
    }

    triggerNote(note, velocity) {
        const cellIndex = note % 16;
        const hue = (note % 12) / 12;
        if (this.grid) {
            this.grid.trigger(cellIndex, velocity, hue);
        }
        if (note === 48) {
            const sign = velocity >= 1.0 ? -1 : 1;
            this.rotVelocity += sign * velocity * this.rotImpulse;
        }
        if (note === 51) {
            this.rotDamping = 0.80 + Math.random() * 0.19; // 0.80–0.99
        }
    }

    updateCC(cc, value) {
        if (this.grid) {
            this.grid.setCC(cc, value);
        }
    }

    setPhysics(params) {
        if (this.grid) {
            this.grid.setPhysics(params);
        }
    }
}

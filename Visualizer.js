import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
// import { bloom } from 'three/addons/tsl/display/BloomNode.js'; // Optional bloom
// import { pass } from 'three/addons/display/PassNodes.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CubeGrid } from './CubeGrid.js'; // Changed from ParticleGrid

export class Visualizer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.grid = null; // Renamed from particleGrid
        this.postProcessing = null;
        this.clock = new THREE.Clock();

        this.init();
    }

    async init() {
        console.log("Visualizer: Initializing...");
        // Scene
        this.scene = new THREE.Scene();

        // Camera
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 8, 10);
        this.camera.lookAt(0, 0, 0);

        // Renderer
        this.renderer = new WebGPURenderer({ antialias: true, alpha: true });
        await this.renderer.init();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 0); // Transparent
        this.container.appendChild(this.renderer.domElement);

        // Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
        dirLight.position.set(5, 10, 5);
        this.scene.add(dirLight);

        // Init Cube Grid
        this.grid = new CubeGrid(this.scene, this.renderer);
        // this.grid.init() is called in constructor

        // Resize Handler
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // Start Loop
        this.animate();
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();
        // const time = this.clock.getElapsedTime();

        this.controls.update();

        if (this.grid) {
            this.grid.update(delta);
        }

        this.renderer.renderAsync(this.scene, this.camera);
    }

    triggerNote(note, velocity) {
        // Map 48 (C3) -> Index 0
        const cellIndex = note - 48;
        if (this.grid) {
            this.grid.trigger(cellIndex, velocity);
        }
    }

    updateCC(cc, value) {
        if (this.grid) {
            this.grid.setCC(cc, value);
        }
    }
}

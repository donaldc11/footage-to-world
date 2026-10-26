import React, { useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SceneBlueprint } from '../types/world';
import { DEFAULT_INITIAL_BLUEPRINT, executeSceneCodeAndBlueprint } from '../utils/threeBuilder';

export interface WorldViewportHandle {
  captureRenderFromVantage: (vantage?: {
    position: [number, number, number];
    target: [number, number, number];
  }) => Promise<string>;
  flyToVantage: (position: [number, number, number], target: [number, number, number]) => void;
}

interface WorldViewportProps {
  blueprint: SceneBlueprint;
  sceneCode: string;
  navigationMode: 'orbit' | 'flight';
  wireframe: boolean;
  sunlightAngleDeg: number;
  onCameraTelemetryChange?: (pos: [number, number, number]) => void;
}

// Pre-allocated vectors outside animation loop to prevent GC pressure
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

export const WorldViewport = React.forwardRef<WorldViewportHandle, WorldViewportProps>(
  ({ blueprint, sceneCode, navigationMode, wireframe, sunlightAngleDeg }, ref) => {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
    const hemiLightRef = useRef<THREE.HemisphereLight | null>(null);
    const maxAnisotropyRef = useRef<number>(4);

    const navModeRef = useRef<'orbit' | 'flight'>(navigationMode);
    navModeRef.current = navigationMode;

    const keysPressedRef = useRef<Record<string, boolean>>({});
    const cameraTransitionRef = useRef<{
      active: boolean;
      targetPos: THREE.Vector3;
      targetLook: THREE.Vector3;
    }>({
      active: false,
      targetPos: new THREE.Vector3(26, 22, 34),
      targetLook: new THREE.Vector3(0, 2, 0),
    });

    useImperativeHandle(ref, () => ({
      flyToVantage: (position: [number, number, number], target: [number, number, number]) => {
        cameraTransitionRef.current.targetPos.set(position[0], position[1], position[2]);
        cameraTransitionRef.current.targetLook.set(target[0], target[1], target[2]);
        cameraTransitionRef.current.active = true;
      },
      captureRenderFromVantage: async (vantage) => {
        // Wait up to 1.5s if renderer is in the middle of mounting
        let attempts = 0;
        while (
          (!rendererRef.current || !sceneRef.current || !cameraRef.current || !controlsRef.current) &&
          attempts < 30
        ) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          attempts++;
        }

        const renderer = rendererRef.current;
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        if (!renderer || !scene || !camera || !controls) {
          // Clean fallback canvas snapshot to guarantee no unhandled console error
          const fbCanvas = document.createElement('canvas');
          fbCanvas.width = 640;
          fbCanvas.height = 360;
          const ctx = fbCanvas.getContext('2d')!;
          ctx.fillStyle = '#0f4c5c';
          ctx.fillRect(0, 0, 640, 360);
          return fbCanvas.toDataURL('image/jpeg', 0.85);
        }

        // Stop any smooth transition and snap exactly to the reference drone camera pose for an accurate render comparison
        cameraTransitionRef.current.active = false;
        if (vantage) {
          camera.position.set(
            vantage.position[0] ?? 26,
            Math.max(2, vantage.position[1] ?? 22),
            vantage.position[2] ?? 34
          );
          controls.target.set(
            vantage.target[0] ?? 0,
            vantage.target[1] ?? 2,
            vantage.target[2] ?? 0
          );
          camera.lookAt(controls.target);
          controls.update();
        }

        // Wait one animation frame for transforms & matrices to settle
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        scene.updateMatrixWorld(true);
        renderer.render(scene, camera);

        return renderer.domElement.toDataURL('image/jpeg', 0.9);
      },
    }));

    useEffect(() => {
      const container = mountRef.current;
      if (!container) return;

      const isSoftwareGl = (() => {
        const testCanvas = document.createElement('canvas');
        const gl = testCanvas.getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      })();

      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#bae6fd');
      scene.fog = new THREE.FogExp2('#bae6fd', 0.0065);
      sceneRef.current = scene;

      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;

      const camera = new THREE.PerspectiveCamera(52, width / height, 0.25, 450);
      camera.position.set(26, 22, 34);
      cameraRef.current = camera;

      const renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      renderer.shadowMap.enabled = !isSoftwareGl;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      rendererRef.current = renderer;
      maxAnisotropyRef.current = renderer.capabilities.getMaxAnisotropy();

      container.innerHTML = '';
      container.appendChild(renderer.domElement);

      // Studio / outdoor environment reflection map
      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
      pmremGenerator.dispose();

      // 3-Point Outdoor + Architectural Lighting Rig
      const hemiLight = new THREE.HemisphereLight('#7dd3fc', '#3f6212', 0.85);
      hemiLight.position.set(0, 60, 0);
      hemiLight.userData.isPermanentLight = true;
      scene.add(hemiLight);
      hemiLightRef.current = hemiLight;

      const sunLight = new THREE.DirectionalLight('#fffbeb', 2.1);
      sunLight.position.set(42, 55, 38);
      sunLight.castShadow = !isSoftwareGl;
      sunLight.shadow.mapSize.width = 2048;
      sunLight.shadow.mapSize.height = 2048;
      const d = 48;
      sunLight.shadow.camera.left = -d;
      sunLight.shadow.camera.right = d;
      sunLight.shadow.camera.top = d;
      sunLight.shadow.camera.bottom = -d;
      sunLight.shadow.camera.near = 1;
      sunLight.shadow.camera.far = 160;
      sunLight.shadow.bias = -0.0005;
      sunLight.shadow.normalBias = 0.02;
      sunLight.userData.isPermanentLight = true;
      scene.add(sunLight);
      sunLightRef.current = sunLight;

      const rimLight = new THREE.DirectionalLight('#bae6fd', 0.55);
      rimLight.position.set(-40, 28, -35);
      rimLight.userData.isPermanentLight = true;
      scene.add(rimLight);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 2, 0);
      controls.enableDamping = !isSoftwareGl;
      controls.dampingFactor = 0.07;
      controls.maxPolarAngle = Math.PI / 2 - 0.03;
      controls.minDistance = 2.5;
      controls.maxDistance = 160;
      controls.update();
      controlsRef.current = controls;

      const onControlStart = () => {
        cameraTransitionRef.current.active = false;
      };
      controls.addEventListener('start', onControlStart);

      // Build initial world
      executeSceneCodeAndBlueprint(
        scene,
        blueprint || DEFAULT_INITIAL_BLUEPRINT,
        sceneCode,
        sunLight,
        hemiLight,
        maxAnisotropyRef.current
      );

      if (!isSoftwareGl) {
        renderer.compile(scene, camera);
      }

      const onKeyDown = (e: KeyboardEvent) => {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        keysPressedRef.current[e.code] = true;
      };

      const onKeyUp = (e: KeyboardEvent) => {
        keysPressedRef.current[e.code] = false;
      };

      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);

      const onResize = () => {
        if (!container) return;
        const w = container.clientWidth || window.innerWidth;
        const h = container.clientHeight || window.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener('resize', onResize);

      let frameId = 0;
      let disposed = false;
      let lastTime = performance.now();

      function afterDraw(cb: () => void) {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        if (!gl || !gl.fenceSync) {
          frameId = window.setTimeout(cb, 80);
          return;
        }
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          if (disposed) return;
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      }

      function tick() {
        if (disposed) return;
        const now = performance.now();
        const delta = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;

        // Smooth camera vantage interpolation
        if (cameraTransitionRef.current.active) {
          const lambda = 6.5;
          camera.position.x = THREE.MathUtils.damp(
            camera.position.x,
            cameraTransitionRef.current.targetPos.x,
            lambda,
            delta
          );
          camera.position.y = THREE.MathUtils.damp(
            camera.position.y,
            cameraTransitionRef.current.targetPos.y,
            lambda,
            delta
          );
          camera.position.z = THREE.MathUtils.damp(
            camera.position.z,
            cameraTransitionRef.current.targetPos.z,
            lambda,
            delta
          );

          controls.target.x = THREE.MathUtils.damp(
            controls.target.x,
            cameraTransitionRef.current.targetLook.x,
            lambda,
            delta
          );
          controls.target.y = THREE.MathUtils.damp(
            controls.target.y,
            cameraTransitionRef.current.targetLook.y,
            lambda,
            delta
          );
          controls.target.z = THREE.MathUtils.damp(
            controls.target.z,
            cameraTransitionRef.current.targetLook.z,
            lambda,
            delta
          );

          if (
            camera.position.distanceToSquared(cameraTransitionRef.current.targetPos) < 0.05 &&
            controls.target.distanceToSquared(cameraTransitionRef.current.targetLook) < 0.05
          ) {
            cameraTransitionRef.current.active = false;
          }
        }

        // WASD / Arrow Drone Pilot Movement
        const keys = keysPressedRef.current;
        const moveForward = keys['KeyW'] || keys['ArrowUp'];
        const moveBackward = keys['KeyS'] || keys['ArrowDown'];
        const moveLeft = keys['KeyA'] || keys['ArrowLeft'];
        const moveRight = keys['KeyD'] || keys['ArrowRight'];
        const moveUp = keys['KeyE'] || keys['Space'];
        const moveDown = keys['KeyQ'] || keys['ShiftLeft'];

        if (moveForward || moveBackward || moveLeft || moveRight || moveUp || moveDown) {
          cameraTransitionRef.current.active = false;
          const speed = (navModeRef.current === 'flight' ? 22 : 16) * delta;

          camera.getWorldDirection(_forward);
          _forward.y = 0;
          if (_forward.lengthSq() > 0.0001) _forward.normalize();

          _right.crossVectors(_forward, _worldUp).normalize();
          _move.set(0, 0, 0);

          if (moveForward) _move.addScaledVector(_forward, speed);
          if (moveBackward) _move.addScaledVector(_forward, -speed);
          if (moveRight) _move.addScaledVector(_right, speed);
          if (moveLeft) _move.addScaledVector(_right, -speed);
          if (moveUp) _move.y += speed * 0.8;
          if (moveDown) _move.y -= speed * 0.8;

          camera.position.add(_move);
          camera.position.y = Math.max(1.4, camera.position.y);
          controls.target.add(_move);
        }

        controls.update();
        renderer.render(scene, camera);

        if (isSoftwareGl) {
          afterDraw(tick);
        } else {
          frameId = requestAnimationFrame(tick);
        }
      }

      tick();

      return () => {
        disposed = true;
        cancelAnimationFrame(frameId);
        clearTimeout(frameId);
        controls.removeEventListener('start', onControlStart);
        controls.dispose();
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('resize', onResize);
        renderer.dispose();
      };
    }, []);

    // Update 3D Scene whenever blueprint or sceneCode changes
    useEffect(() => {
      const scene = sceneRef.current;
      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      if (!scene || !renderer || !camera) return;

      executeSceneCodeAndBlueprint(
        scene,
        blueprint,
        sceneCode,
        sunLightRef.current,
        hemiLightRef.current,
        maxAnisotropyRef.current
      );

      // Apply wireframe state if enabled
      if (wireframe) {
        scene.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const m = (obj as THREE.Mesh).material;
            if (Array.isArray(m)) {
              m.forEach((mat: any) => {
                if ('wireframe' in mat) mat.wireframe = true;
              });
            } else if (m && 'wireframe' in m) {
              (m as any).wireframe = true;
            }
          }
        });
      }

      // Apply current sunlightAngleDeg override
      if (sunLightRef.current) {
        const az = THREE.MathUtils.degToRad(sunlightAngleDeg ?? blueprint.sunAzimuthDeg ?? 135);
        const el = THREE.MathUtils.degToRad(
          THREE.MathUtils.clamp(blueprint.sunElevationDeg ?? 42, 12, 82)
        );
        const dist = 65;
        sunLightRef.current.position.set(
          Math.cos(el) * Math.sin(az) * dist,
          Math.sin(el) * dist,
          Math.cos(el) * Math.cos(az) * dist
        );
      }

      renderer.render(scene, camera);
    }, [blueprint, sceneCode, wireframe]);

    // Real-time Sunlight Angle rotation when user drags the Sunlight Angle slider
    useEffect(() => {
      const sunLight = sunLightRef.current;
      const scene = sceneRef.current;
      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      if (!sunLight || !scene || !renderer || !camera) return;

      const az = THREE.MathUtils.degToRad(sunlightAngleDeg);
      const baseElevation = blueprint?.sunElevationDeg ?? 42;
      // Subtle time-of-day arc modulation as the user rotates the sun around the property
      const dynamicElevation = THREE.MathUtils.clamp(
        baseElevation + Math.sin(az) * 10,
        14,
        78
      );
      const el = THREE.MathUtils.degToRad(dynamicElevation);
      const dist = 65;

      sunLight.position.set(
        Math.cos(el) * Math.sin(az) * dist,
        Math.sin(el) * dist,
        Math.cos(el) * Math.cos(az) * dist
      );
      sunLight.updateMatrixWorld();
      renderer.render(scene, camera);
    }, [sunlightAngleDeg, blueprint]);

    return (
      <div
        ref={mountRef}
        className="fixed inset-0 w-screen h-screen overflow-hidden select-none cursor-grab active:cursor-grabbing"
        aria-label="Interactive 3D Reconstructed World Viewport"
      />
    );
  }
);

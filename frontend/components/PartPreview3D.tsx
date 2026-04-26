import React, { useEffect, useRef } from 'react';
import {
    Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
    Vector3, Color4, Color3
} from '@babylonjs/core';
import { createPartMesh } from '../babylon/entityMeshes';
import { PartTemplate } from '../types';

interface Props {
    template: PartTemplate;
    width?: number;
    height?: number;
}

const SIZE_SCALE: Record<string, number> = { small: 0.6, medium: 1.0, large: 1.5 };

export const PartPreview3D: React.FC<Props> = ({ template, width = 200, height = 160 }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<Engine | null>(null);
    const sceneRef  = useRef<Scene | null>(null);

    // Full rebuild when template id or shape/holes change
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Dispose previous engine
        engineRef.current?.dispose();

        const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
        engineRef.current = engine;

        const scene = new Scene(engine);
        sceneRef.current = scene;
        scene.clearColor = new Color4(0.05, 0.07, 0.12, 1);

        // Camera – angled top-down like in game
        const cam = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3.5, 1.4, Vector3.Zero(), scene);
        cam.lowerRadiusLimit = 0.8;
        cam.upperRadiusLimit = 3;
        cam.attachControl(canvas, true);

        // Lights
        const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
        hemi.intensity = 0.7;
        const dir = new DirectionalLight('dir', new Vector3(-1, -2, -1), scene);
        dir.intensity = 0.8;
        dir.diffuse  = new Color3(1, 0.95, 0.85);

        // Build mesh
        const mesh = createPartMesh(scene, {
            shape: template.shape,
            color: template.color,
            hasCenterHole: template.hasCenterHole,
            hasIndexHole: template.hasIndexHole,
        }, false, 'preview');

        const s = SIZE_SCALE[template.size] ?? 1;
        mesh.scaling.setAll(s * (template.radiusScale ?? 1));
        if (template.heightScale) mesh.scaling.y = s * template.heightScale;

        // Slow auto-rotate
        let t = 0;
        scene.registerBeforeRender(() => {
            t += 0.012;
            mesh.rotation.y = t;
        });

        engine.runRenderLoop(() => scene.render());

        const resize = () => engine.resize();
        window.addEventListener('resize', resize);

        return () => {
            window.removeEventListener('resize', resize);
            engine.dispose();
            engineRef.current = null;
            sceneRef.current = null;
        };
    }, [template.id, template.shape, template.hasCenterHole, template.hasIndexHole]);

    // Fast material/scale update without full rebuild
    useEffect(() => {
        const scene = sceneRef.current;
        if (!scene) return;
        const mesh = scene.getMeshByName('preview_disc')
            ?? scene.getMeshByName('preview_can')
            ?? scene.getMeshByName('preview_box')
            ?? scene.getMeshByName('preview_pyramid')
            ?? scene.getMeshByName('preview_fallback')
            ?? scene.getMeshByName('preview_mesh');
        if (!mesh) return;
        const s = SIZE_SCALE[template.size] ?? 1;
        const rs = template.radiusScale ?? 1;
        const hs = template.heightScale ?? 1;
        mesh.scaling.x = s * rs * (template.scaleX ?? 1);
        mesh.scaling.z = s * rs * (template.scaleZ ?? 1);
        mesh.scaling.y = s * hs;
        // Update material color
        const mat = mesh.material as any;
        if (mat?.albedoColor) {
            mat.albedoColor = Color3.FromHexString(template.color.length === 7 ? template.color : '#94a3b8');
        }
    }, [template.color, template.size, template.radiusScale, template.heightScale, template.scaleX, template.scaleZ]);

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            style={{ width: `${width}px`, height: `${height}px`, borderRadius: 8, display: 'block' }}
        />
    );
};

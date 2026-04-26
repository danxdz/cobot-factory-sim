import React from 'react';
import { BabylonScene } from './components/BabylonScene';
import { UI } from './components/UI';

export default function App() {
    return (
        <div className="w-full h-screen relative overflow-hidden bg-gray-900">
            {/* 3D Canvas Layer */}
            <div className="absolute inset-0">
                <BabylonScene />
            </div>
            
            {/* 2D UI Overlay Layer */}
            <UI />
        </div>
    );
}

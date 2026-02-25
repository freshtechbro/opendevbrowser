"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Line, OrbitControls, useTexture } from "@react-three/drei";
import { useMemo, useRef } from "react";
import type { Group } from "three";

function NetworkCluster() {
  const groupRef = useRef<Group>(null);
  const texture = useTexture("/brand/icon-256.png");

  const points = useMemo(
    () => [
      [-1.4, 0.5, 0.3],
      [1.2, 0.8, -0.2],
      [0.2, -0.4, 0.9],
      [-0.4, -1.1, -0.6],
      [1.4, -0.7, 0.7]
    ] as const,
    []
  );

  useFrame((state) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y = state.clock.elapsedTime * 0.12;
    groupRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.2) * 0.08;
  });

  return (
    <group ref={groupRef}>
      <Line points={[points[0], points[2], points[1]]} color="#22d3ee" lineWidth={0.8} transparent opacity={0.55} />
      <Line points={[points[0], points[3], points[4]]} color="#06b6d4" lineWidth={0.8} transparent opacity={0.45} />
      <Line points={[points[2], points[4], points[1]]} color="#0d9488" lineWidth={0.8} transparent opacity={0.45} />

      {points.map((point, index) => (
        <Float key={index} speed={1 + index * 0.1} rotationIntensity={0.28} floatIntensity={0.5}>
          <sprite position={point} scale={index === 1 ? 0.95 : 0.8}>
            <spriteMaterial map={texture} transparent opacity={0.92} />
          </sprite>
        </Float>
      ))}
    </group>
  );
}

export function ThreeNodeScene() {
  return (
    <Canvas camera={{ position: [0, 0.2, 4.5], fov: 48 }} dpr={[1, 2]}>
      <ambientLight intensity={0.8} />
      <directionalLight position={[4, 4, 3]} intensity={1.1} color="#22d3ee" />
      <directionalLight position={[-3, -2, 2]} intensity={0.4} color="#0d9488" />
      <NetworkCluster />
      <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.35} />
    </Canvas>
  );
}

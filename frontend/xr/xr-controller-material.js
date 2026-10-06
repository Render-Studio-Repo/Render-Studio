/** Preserve texture/normal detail and occlusion; never flatten a controller to a white overlay. */
export function restoreControllerMaterial(mesh) {
  if(!mesh?.isMesh||mesh.userData?.xrControllerSurfaceReady||mesh.userData?.xrFallback)return;
  const style=source=>{
    if(!source?.clone)return source;
    const mat=source.clone();
    mat.emissive?.setHex(0);mat.emissiveIntensity=0;
    mat.color?.multiplyScalar(.68);
    mat.depthTest=true;mat.depthWrite=true;mat.transparent=mat.opacity<1;
    // Stable controller shading even when Draw temporarily disables CAD fill lights.
    // Reuse the GLB's diffuse/normal maps; no textures or materials are created per frame.
    mat.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight = diffuseColor.rgb * (0.26 + 0.68 * max(dot(normal, normalize(vec3(-0.4, 0.7, 0.6))), 0.0));\n#include <opaque_fragment>');};
    mat.customProgramCacheKey=()=> 'xr-controller-readable-v1';
    mat.toneMapped=false;mat.needsUpdate=true;
    return mat;
  };
  mesh.material=Array.isArray(mesh.material)?mesh.material.map(style):style(mesh.material);
  mesh.userData.xrControllerSurfaceReady=true;
}

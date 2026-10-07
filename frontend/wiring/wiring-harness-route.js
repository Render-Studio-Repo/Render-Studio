import * as THREE from 'three';
/** Tangent circular bends; never silently shrink a specified minimum bend radius. */
export function harnessCurve(points, radius) {
  const curve=new THREE.CurvePath(), issues=[];
  let last=points[0];
  const line=to=>{if(last.distanceToSquared(to)>1e-12)curve.add(new THREE.LineCurve3(last.clone(),to.clone()));last=to;};
  for(let i=1;i<points.length-1;i++) {
    const before=points[i-1],corner=points[i],after=points[i+1];
    const incoming=corner.clone().sub(before).normalize(), outgoing=after.clone().sub(corner).normalize();
    const angle=Math.acos(THREE.MathUtils.clamp(incoming.dot(outgoing),-1,1));
    if(angle<1e-5){line(corner);continue;}
    const distance=radius*Math.tan(angle/2);
    if(!(radius>0) || angle>Math.PI-1e-4 || distance>Math.min(corner.distanceTo(before),corner.distanceTo(after))*.49) {
      if(radius>0)issues.push(`Bend ${i} needs more clearance for radius ${radius.toFixed(2)}.`);
      line(corner);continue;
    }
    const start=corner.clone().addScaledVector(incoming,-distance),end=corner.clone().addScaledVector(outgoing,distance);
    const center=corner.clone().addScaledVector(outgoing.clone().sub(incoming).normalize(),radius/Math.cos(angle/2));
    const u=start.clone().sub(center).normalize(),normal=incoming.clone().cross(outgoing).normalize(),v=normal.clone().cross(u).normalize();
    line(start);
    const arc=new THREE.Curve();arc.getPoint=(t,target=new THREE.Vector3())=>target.copy(center).addScaledVector(u,radius*Math.cos(angle*t)).addScaledVector(v,radius*Math.sin(angle*t));
    curve.add(arc);last=end;
  }
  line(points.at(-1));return {curve,issues};
}

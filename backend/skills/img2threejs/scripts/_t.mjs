console.log("start");
import "./node_shims.js";
console.log("shim");
const THREE = await import("three");
console.log("three", Object.keys(THREE).slice(0,5));

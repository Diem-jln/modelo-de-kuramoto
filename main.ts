import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';

// --- 1. ENTORNO CINÉTICO DE LUZ ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000); 

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 60;

const stereoCamera = new THREE.StereoCamera();

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.innerHTML = ''; 
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.05;

// Post-Procesamiento
const renderScene = new RenderPass(scene, camera);
const afterimagePass = new AfterimagePass();
afterimagePass.uniforms['damp'].value = 0.93; 

const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 2.0, 0.2, 0.85);

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(afterimagePass);
composer.addPass(bloomPass);

// --- 2. INTERFAZ (HUD) ---
const uiContainer = document.createElement('div');
uiContainer.style.cssText = 'position:absolute; top:0; left:0; width:100vw; height:100vh; z-index:10; pointer-events:none; color:#00ffcc; font-family:monospace; user-select:none; transition: opacity 0.3s ease;';
document.body.appendChild(uiContainer);

const startBtn = document.createElement('button');
startBtn.innerText = 'INICIAR TELAR ARMÓNICO';
startBtn.style.cssText = 'position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); padding:15px 30px; background:rgba(0,0,0,0.8); color:#00ffff; border:1px solid #00ffff; cursor:pointer; pointer-events:auto; font-size:16px; letter-spacing: 3px;';
uiContainer.appendChild(startBtn);

const hud = document.createElement('div');
hud.style.cssText = 'position:absolute; bottom:30px; left:30px; display:none; background:rgba(0,0,0,0.5); padding:20px; border-left:3px solid #00ffff; backdrop-filter: blur(5px);';
hud.innerHTML = `
  <h3 style="margin:0 0 10px 0; font-weight:normal;">ESTADO: <span id="estado" style="color:#fff">CAOS (RUIDO)</span></h3>
  <p style="margin:5px 0;">COHERENCIA (R): <span id="r-val" style="color:#fff">0.00</span></p>
  <div style="margin-top:15px; font-size:11px; color:#8895a5;">
    <strong style="color:#00ffff">[MOUSE X]</strong> Tensión (K) &nbsp; | &nbsp; <strong style="color:#00ffff">[DRAG]</strong> Aislar Nodo<br>
    <strong style="color:#ff0055">[ESPACIO]</strong> Ruptura Total &nbsp; | &nbsp; <strong style="color:#00ffcc">[TECLA V]</strong> Demo VR (Split)<br>
    <strong style="color:#ffffff">[TECLA P]</strong> Ocultar Interfaz y Cursor
  </div>`;
uiContainer.appendChild(hud);

// --- 3. MODELO KURAMOTO Y PERSONALIDADES ---
const NUM_AGENTS = 22;
let K = 0.1; 
let R = 0;   
let isVRDemoMode = false;
let isCleanScreen = false; // Estado del modo pantalla limpia (Tecla P)
const agents: any[] = [];
let audioCtx: AudioContext;
let masterGain: GainNode;
let globalFilter: BiquadFilterNode;
let isRunning = false;

const sphereGeo = new THREE.SphereGeometry(0.4, 8, 8);
const tensorMaterial = new THREE.LineBasicMaterial({ color: 0xcc00ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending });
const tensorGeometry = new THREE.BufferGeometry();
const tensorPositions = new Float32Array(NUM_AGENTS * NUM_AGENTS * 3);
tensorGeometry.setAttribute('position', new THREE.BufferAttribute(tensorPositions, 3));
const tensorLines = new THREE.LineSegments(tensorGeometry, tensorMaterial);
scene.add(tensorLines);

for (let i = 0; i < NUM_AGENTS; i++) {
  let family = i % 4; 
  let col = family === 0 ? 0xff3300 : (family === 1 ? 0x00ffff : (family === 2 ? 0xffcc00 : 0xcc00ff));
  const mat = new THREE.MeshBasicMaterial({ color: col });
  const mesh = new THREE.Mesh(sphereGeo, mat);
  scene.add(mesh);

  const harmX = (family === 0) ? 1 : (family === 1 ? 3 : 2);
  const harmY = (family === 0) ? 2 : (family === 1 ? 2 : 3);
  const harmZ = (family === 0) ? 3 : (family === 1 ? 4 : 5);

  agents.push({
    id: i,
    family: family,
    mesh: mesh,
    theta: Math.random() * Math.PI * 2, 
    omega: 0.01 + Math.random() * 0.03, 
    harmonics: { x: harmX, y: harmY, z: harmZ },
    baseFreq: family === 0 ? 130.81 : (family === 1 ? 261.63 : (family === 2 ? 523.25 : 392.00)),
    isDragged: false
  });
}

startBtn.addEventListener('click', () => {
  audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  globalFilter = audioCtx.createBiquadFilter();
  globalFilter.type = 'lowpass';
  globalFilter.frequency.value = 400; 
  
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.15;
  masterGain.connect(globalFilter);
  globalFilter.connect(audioCtx.destination);

  agents.forEach(agent => {
    agent.osc = audioCtx.createOscillator();
    agent.gain = audioCtx.createGain();
    agent.osc.type = agent.family === 0 ? 'sine' : (agent.family === 1 ? 'triangle' : 'square');
    agent.osc.frequency.value = agent.baseFreq;
    agent.gain.gain.value = 0;
    agent.osc.connect(agent.gain);
    agent.gain.connect(masterGain);
    agent.osc.start();
  });

  startBtn.style.display = 'none'; hud.style.display = 'block';
  isRunning = true;
});

// --- 4. MOTOR GENERATIVO Y RENDERIZADO ---
function animate() {
  requestAnimationFrame(animate);
  
  if (isRunning) {
    let sumCos = 0; let sumSin = 0;
    let activeAgents = 0;

    for (let i = 0; i < NUM_AGENTS; i++) {
      if (agents[i].isDragged) continue;
      
      let sum = 0;
      for (let j = 0; j < NUM_AGENTS; j++) {
        if (i !== j && !agents[j].isDragged) sum += Math.sin(agents[j].theta - agents[i].theta);
      }
      agents[i].theta += agents[i].omega + (K / NUM_AGENTS) * sum;
      agents[i].theta %= (Math.PI * 2);
      sumCos += Math.cos(agents[i].theta);
      sumSin += Math.sin(agents[i].theta);
      activeAgents++;
    }
    
    R = activeAgents > 0 ? Math.sqrt(sumCos * sumCos + sumSin * sumSin) / activeAgents : 0;

    let lineIndex = 0;
    const positions = tensorLines.geometry.attributes.position.array as Float32Array;

    for (let i = 0; i < NUM_AGENTS; i++) {
      const agent = agents[i];
      const pulse = (Math.cos(agent.theta) + 1) / 2;

      if (!agent.isDragged) {
        const radius = 25 * (1 - (R * 0.3)); 
        agent.mesh.position.x = Math.sin(agent.theta * agent.harmonics.x) * radius;
        agent.mesh.position.y = Math.cos(agent.theta * agent.harmonics.y) * radius;
        agent.mesh.position.z = Math.sin(agent.theta * agent.harmonics.z) * radius;

        if (agent.family === 0) agent.mesh.scale.setScalar(1 + pulse * 2); 
        if (agent.family === 2) { 
          const jitter = (1 - R) * 4;
          agent.mesh.position.add(new THREE.Vector3((Math.random()-0.5)*jitter, (Math.random()-0.5)*jitter, 0));
        }

        agent.gain.gain.setTargetAtTime(pulse * 0.12, audioCtx.currentTime, 0.05);
        agent.osc.frequency.setTargetAtTime(agent.baseFreq + Math.sin(agent.theta)*30, audioCtx.currentTime, 0.1);
      }

      if (agent.family === 3) {
        for (let j = 0; j < NUM_AGENTS; j++) {
          if (i !== j) {
            const dist = agent.mesh.position.distanceTo(agents[j].mesh.position);
            if (dist < 20 * R) {
              positions[lineIndex++] = agent.mesh.position.x; positions[lineIndex++] = agent.mesh.position.y; positions[lineIndex++] = agent.mesh.position.z;
              positions[lineIndex++] = agents[j].mesh.position.x; positions[lineIndex++] = agents[j].mesh.position.y; positions[lineIndex++] = agents[j].mesh.position.z;
            }
          }
        }
      }
    }
    
    tensorLines.geometry.setDrawRange(0, lineIndex / 3);
    tensorLines.geometry.attributes.position.needsUpdate = true;
    tensorMaterial.opacity = R; 

    bloomPass.strength = 1.0 + (R * 2.0); 
    globalFilter.frequency.setTargetAtTime(400 + (R * 4000), audioCtx.currentTime, 0.2);

    document.getElementById('r-val')!.innerText = R.toFixed(2);
    const estadoEl = document.getElementById('estado');
    if (estadoEl) {
      if (R < 0.3) { estadoEl.innerText = "POLIRRITMIA (RUIDO)"; estadoEl.style.color = "#ff3300"; }
      else if (R < 0.8) { estadoEl.innerText = "TEJIENDO ARMÓNICOS"; estadoEl.style.color = "#ffcc00"; }
      else { estadoEl.innerText = "MANDALA ESTABLE"; estadoEl.style.color = "#00ffff"; }
    }
  }

  if (!draggedAgent) controls.update();
  scene.rotation.y += 0.002; 

  if (isVRDemoMode) {
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    stereoCamera.update(camera);

    const size = new THREE.Vector2();
    renderer.getSize(size);
    renderer.setScissorTest(true);

    renderer.setScissor(0, 0, size.width / 2, size.height);
    renderer.setViewport(0, 0, size.width / 2, size.height);
    renderScene.camera = stereoCamera.cameraL;
    composer.render();

    renderer.setScissor(size.width / 2, 0, size.width / 2, size.height);
    renderer.setViewport(size.width / 2, 0, size.width / 2, size.height);
    renderScene.camera = stereoCamera.cameraR;
    composer.render();

    renderer.setScissorTest(false);
  } else {
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    renderScene.camera = camera;
    composer.render();
  }
}

// --- 5. INTERACCIONES PERFORMATIVAS ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let draggedAgent: any = null;
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

window.addEventListener('mousemove', (e) => {
  if (!isRunning) return;
  if (!draggedAgent) {
    K = (e.clientX / window.innerWidth) * 4.5; 
  } else {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1; mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const targetPos = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlane, targetPos);
    draggedAgent.mesh.position.lerp(targetPos, 0.2);
    draggedAgent.osc.frequency.setTargetAtTime(draggedAgent.baseFreq * 2 + Math.sin(Date.now()*0.01)*100, audioCtx.currentTime, 0.1);
  }
});

window.addEventListener('mousedown', (e) => {
  if (!isRunning || e.button !== 0) return;
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1; mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children);
  
  if (intersects.length > 0 && intersects[0].object.geometry !== tensorGeometry) {
    controls.enabled = false;
    draggedAgent = agents.find(a => a.mesh === intersects[0].object);
    if (draggedAgent) {
      draggedAgent.isDragged = true;
      draggedAgent.gain.gain.setTargetAtTime(0.5, audioCtx.currentTime, 0.05); 
    }
  }
});

window.addEventListener('mouseup', () => {
  if (draggedAgent) {
    draggedAgent.isDragged = false;
    draggedAgent = null;
    controls.enabled = true;
  }
});

window.addEventListener('wheel', (e) => {
  let damp = afterimagePass.uniforms['damp'].value;
  damp -= e.deltaY * 0.0005;
  damp = Math.max(0.5, Math.min(0.99, damp)); 
  afterimagePass.uniforms['damp'].value = damp;
});

window.addEventListener('keydown', (e) => {
  // Ruptura de Kuramoto (Espacio)
  if (e.code === 'Space' && isRunning) {
    globalFilter.frequency.setValueAtTime(150, audioCtx.currentTime);
    for (let i = 0; i < NUM_AGENTS; i++) {
      agents[i].theta += Math.PI * Math.random(); 
      agents[i].omega = 0.01 + Math.random() * 0.05; 
    }
  }
  // Toggle del modo Visor Stereo (Tecla V)
  if (e.code === 'KeyV') {
    isVRDemoMode = !isVRDemoMode;
  }
  // Toggle de Pantalla Limpia / Ocultar UI y Cursor (Tecla P)
  if (e.code === 'KeyP') {
    isCleanScreen = !isCleanScreen;
    if (isCleanScreen) {
      uiContainer.style.opacity = '0';
      document.body.style.cursor = 'none'; // Oculta el cursor del mouse
    } else {
      uiContainer.style.opacity = '1';
      document.body.style.cursor = 'default'; // Restaura el cursor
    }
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight); composer.setSize(window.innerWidth, window.innerHeight);
});

animate();
import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js';

const ui = {
  poly: document.getElementById('poly'),
  buildBtn: document.getElementById('buildBtn'),
  faceList: document.getElementById('faceList'),
  faceInfo: document.getElementById('faceInfo'),
  basisBtn: document.getElementById('basisBtn'),
  basisInfo: document.getElementById('basisInfo'),
};

const canvas = document.getElementById('viewer');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
camera.position.set(6, 6, 6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const light = new THREE.DirectionalLight(0xffffff, 0.85);
light.position.set(4, 7, 8);
scene.add(light);
scene.add(new THREE.AxesHelper(2.5));

let polyGroup = new THREE.Group();
scene.add(polyGroup);

let current = {
  terms: [],
  points: [],
  faces: [],
  triangles: [],
  hoverFace: -1,
  selectedFace: -1,
};

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function resize() {
  const width = Math.max(canvas.clientWidth, 1);
  const height = Math.max(canvas.clientHeight, 1);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(canvas);
resize();

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function gcd3(a, b, c) {
  return gcd(gcd(a, b), c);
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function determinant3(a, b, c) {
  return a[0] * (b[1] * c[2] - b[2] * c[1])
       - a[1] * (b[0] * c[2] - b[2] * c[0])
       + a[2] * (b[0] * c[1] - b[1] * c[0]);
}

function primitive(v) {
  const g = gcd3(v[0], v[1], v[2]) || 1;
  let p = [v[0] / g, v[1] / g, v[2] / g];
  const firstNZ = p.find((x) => x !== 0);
  if (firstNZ && firstNZ < 0) p = p.map((x) => -x);
  return p;
}

function parsePolynomial(input) {
  const normalized = input.replace(/\s+/g, '').replace(/-/g, '+-');
  const chunks = normalized.split('+').filter(Boolean);
  const terms = [];

  for (const raw of chunks) {
    const factors = raw.split('*').filter(Boolean);
    let exp = { x: 0, y: 0, z: 0 };
    for (let factor of factors) {
      if (/^[+-]?\d+(\.\d+)?$/.test(factor)) continue;
      factor = factor.replace(/^\+/, '');
      const m = factor.match(/^([xyz])(\^(\-?\d+))?$/);
      if (!m) throw new Error(`Cannot parse factor "${factor}". Only x,y,z monomials supported.`);
      const variable = m[1];
      const p = m[3] ? parseInt(m[3], 10) : 1;
      exp[variable] += p;
    }
    terms.push({ raw, exponent: [exp.x, exp.y, exp.z] });
  }

  const seen = new Set();
  const unique = [];
  for (const t of terms) {
    const key = t.exponent.join(',');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(t);
    }
  }
  return unique;
}

function convexHullFaces(points) {
  const n = points.length;
  if (n < 4) throw new Error('Need at least 4 exponent points for a 3D polytope.');

  const planes = new Map();

  for (let i = 0; i < n - 2; i++) {
    for (let j = i + 1; j < n - 1; j++) {
      for (let k = j + 1; k < n; k++) {
        const pi = points[i], pj = points[j], pk = points[k];
        const nvec = cross(sub(pj, pi), sub(pk, pi));
        if (nvec[0] === 0 && nvec[1] === 0 && nvec[2] === 0) continue;

        let pos = 0, neg = 0;
        for (let t = 0; t < n; t++) {
          if (t === i || t === j || t === k) continue;
          const s = dot(nvec, sub(points[t], pi));
          if (s > 0) pos++;
          else if (s < 0) neg++;
          if (pos && neg) break;
        }
        if (pos && neg) continue;

        let oriented = [...nvec];
        if (pos > 0) oriented = oriented.map((x) => -x);
        const pnormal = primitive(oriented);
        const d = dot(pnormal, pi);
        const key = `${pnormal.join(',')}|${d}`;
        if (!planes.has(key)) {
          planes.set(key, { normal: pnormal, d, vertices: new Set() });
        }
        const plane = planes.get(key);
        plane.vertices.add(i); plane.vertices.add(j); plane.vertices.add(k);
      }
    }
  }

  const faces = [];
  for (const plane of planes.values()) {
    for (let idx = 0; idx < n; idx++) {
      if (dot(plane.normal, points[idx]) === plane.d) plane.vertices.add(idx);
    }
    const verts = Array.from(plane.vertices);
    if (verts.length >= 3) {
      faces.push({ normal: plane.normal, d: plane.d, verts });
    }
  }
  return faces;
}

function orderFaceVertices(points, face) {
  const verts = face.verts;
  const centroid = [0, 0, 0];
  for (const idx of verts) {
    centroid[0] += points[idx][0];
    centroid[1] += points[idx][1];
    centroid[2] += points[idx][2];
  }
  centroid[0] /= verts.length;
  centroid[1] /= verts.length;
  centroid[2] /= verts.length;

  const n = face.normal;
  const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = cross(n, ref);
  const v = cross(n, u);

  return [...verts].sort((a, b) => {
    const da = sub(points[a], centroid);
    const db = sub(points[b], centroid);
    const aa = Math.atan2(dot(da, v), dot(da, u));
    const ab = Math.atan2(dot(db, v), dot(db, u));
    return aa - ab;
  });
}

function triangulateFaces(points, faces) {
  const triangles = [];
  faces.forEach((face, fi) => {
    const ordered = orderFaceVertices(points, face);
    for (let i = 1; i < ordered.length - 1; i++) {
      triangles.push({ faceIndex: fi, idx: [ordered[0], ordered[i], ordered[i + 1]] });
    }
    face.ordered = ordered;
  });
  return triangles;
}

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children[group.children.length - 1];
    group.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    }
  }
}

function drawPolytope(points, triangles) {
  clearGroup(polyGroup);

  const vertices = [];
  triangles.forEach((t) => {
    t.idx.forEach((id) => {
      vertices.push(points[id][0], points[id][1], points[id][2]);
    });
  });

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geom.computeVertexNormals();

  const mat = new THREE.MeshPhongMaterial({
    color: 0x3e85ff,
    emissive: 0x0f1833,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.userData.kind = 'polytope';
  polyGroup.add(mesh);

  const edgeGeom = new THREE.EdgesGeometry(geom, 1);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xcde0ff, linewidth: 1 });
  polyGroup.add(new THREE.LineSegments(edgeGeom, edgeMat));

  const pointGeom = new THREE.SphereGeometry(0.07, 16, 16);
  const pointMat = new THREE.MeshBasicMaterial({ color: 0xffc857 });
  for (const p of points) {
    const s = new THREE.Mesh(pointGeom, pointMat);
    s.position.set(p[0], p[1], p[2]);
    polyGroup.add(s);
  }

  frameCameraToPoints(points);
}

function buildFaceOverlay(faceIndex, color, opacity, kind) {
  if (faceIndex < 0) return null;
  const face = current.faces[faceIndex];
  if (!face) return null;
  const triVerts = [];
  for (let i = 1; i < face.ordered.length - 1; i++) {
    [face.ordered[0], face.ordered[i], face.ordered[i + 1]].forEach((id) => {
      const p = current.points[id];
      triVerts.push(p[0], p[1], p[2]);
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(triVerts, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity });
  const overlay = new THREE.Mesh(geometry, material);
  overlay.userData.kind = kind;
  return overlay;
}

function removeOverlays() {
  const removable = [];
  scene.traverse((obj) => {
    if (obj.userData.kind === 'selected-highlight' || obj.userData.kind === 'hover-highlight') removable.push(obj);
  });
  removable.forEach((obj) => {
    scene.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  });
}

function renderHighlights() {
  removeOverlays();

  const selected = buildFaceOverlay(current.selectedFace, 0xff3366, 0.75, 'selected-highlight');
  if (selected) scene.add(selected);

  if (current.hoverFace >= 0 && current.hoverFace !== current.selectedFace) {
    const hover = buildFaceOverlay(current.hoverFace, 0x2ef59f, 0.55, 'hover-highlight');
    if (hover) scene.add(hover);
  }
}

function faceFromPointerEvent(ev) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const polyMesh = polyGroup.children.find((ch) => ch.type === 'Mesh' && ch.userData.kind === 'polytope');
  if (!polyMesh) return -1;
  const hits = raycaster.intersectObject(polyMesh, false);
  if (!hits.length) return -1;
  const triIndex = Math.floor(hits[0].faceIndex);
  const tri = current.triangles[triIndex];
  if (!tri) return -1;
  return tri.faceIndex;
}

function frameCameraToPoints(points) {
  if (!points.length) return;
  const box = new THREE.Box3();
  points.forEach((p) => box.expandByPoint(new THREE.Vector3(p[0], p[1], p[2])));
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.9 + 1.5;
  camera.position.copy(center.clone().add(new THREE.Vector3(radius, radius, radius)));
  camera.lookAt(center);
  controls.target.copy(center);
  controls.update();
}

function findUnimodularBasisWithNormal(n) {
  const limit = 6;
  for (let a = -limit; a <= limit; a++) {
    for (let b = -limit; b <= limit; b++) {
      for (let c = -limit; c <= limit; c++) {
        const u = [a, b, c];
        for (let d = -limit; d <= limit; d++) {
          for (let e = -limit; e <= limit; e++) {
            for (let f = -limit; f <= limit; f++) {
              const v = [d, e, f];
              const det = determinant3(u, v, n);
              if (Math.abs(det) === 1) {
                return { u, v, n, det };
              }
            }
          }
        }
      }
    }
  }
  throw new Error('Failed to find unimodular basis; increase search limit.');
}

function inverseIntegerMatrixColumns(u, v, w) {
  const M = [
    [u[0], v[0], w[0]],
    [u[1], v[1], w[1]],
    [u[2], v[2], w[2]],
  ];
  const det = determinant3(u, v, w);
  const cof = [
    [M[1][1] * M[2][2] - M[1][2] * M[2][1], -(M[1][0] * M[2][2] - M[1][2] * M[2][0]), M[1][0] * M[2][1] - M[1][1] * M[2][0]],
    [-(M[0][1] * M[2][2] - M[0][2] * M[2][1]), M[0][0] * M[2][2] - M[0][2] * M[2][0], -(M[0][0] * M[2][1] - M[0][1] * M[2][0])],
    [M[0][1] * M[1][2] - M[0][2] * M[1][1], -(M[0][0] * M[1][2] - M[0][2] * M[1][0]), M[0][0] * M[1][1] - M[0][1] * M[1][0]],
  ];
  const adj = [
    [cof[0][0], cof[1][0], cof[2][0]],
    [cof[0][1], cof[1][1], cof[2][1]],
    [cof[0][2], cof[1][2], cof[2][2]],
  ];
  return adj.map((row) => row.map((x) => x / det));
}

function transformExponents(terms, invM) {
  return terms.map((t) => {
    const p = t.exponent;
    const np = [
      invM[0][0] * p[0] + invM[0][1] * p[1] + invM[0][2] * p[2],
      invM[1][0] * p[0] + invM[1][1] * p[1] + invM[1][2] * p[2],
      invM[2][0] * p[0] + invM[2][1] * p[1] + invM[2][2] * p[2],
    ];
    return { ...t, transformed: np };
  });
}

function formatPolynomialTransformed(transformedTerms) {
  return transformedTerms.map((t) => {
    const [a, b, c] = t.transformed;
    const factors = [];
    if (a !== 0) factors.push(`X${a === 1 ? '' : '^' + a}`);
    if (b !== 0) factors.push(`Y${b === 1 ? '' : '^' + b}`);
    if (c !== 0) factors.push(`Z${c === 1 ? '' : '^' + c}`);
    return factors.length ? factors.join('*') : '1';
  }).join(' + ');
}

function selectFace(idx) {
  current.selectedFace = idx;
  document.querySelectorAll('.face-item').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });

  if (idx < 0) {
    ui.faceInfo.textContent = 'None selected.';
    ui.basisBtn.disabled = true;
    renderHighlights();
    return;
  }

  const face = current.faces[idx];
  ui.faceInfo.innerHTML = `
    Normal (primitive): <code>(${face.normal.join(', ')})</code><br>
    Face equation: <code>${face.normal[0]}x + ${face.normal[1]}y + ${face.normal[2]}z = ${face.d}</code><br>
    Vertices: ${face.ordered.map((v) => `(${current.points[v].join(',')})`).join(', ')}
  `;
  ui.basisBtn.disabled = false;
  renderHighlights();
}

function rebuild() {
  let terms;
  try {
    terms = parsePolynomial(ui.poly.value);
  } catch (err) {
    alert(err.message);
    return;
  }

  const points = terms.map((t) => t.exponent);
  if (new Set(points.map((p) => p.join(','))).size < 4) {
    alert('Need at least 4 distinct monomials for a 3D convex hull.');
    return;
  }

  let faces;
  try {
    faces = convexHullFaces(points);
  } catch (err) {
    alert(err.message);
    return;
  }

  const triangles = triangulateFaces(points, faces);
  current = { ...current, terms, points, faces, triangles, hoverFace: -1, selectedFace: -1 };
  drawPolytope(points, triangles);

  ui.faceList.innerHTML = '';
  faces.forEach((f, i) => {
    const item = document.createElement('div');
    item.className = 'face-item';
    item.textContent = `Face ${i + 1}: normal (${f.normal.join(',')})`;
    item.onclick = () => selectFace(i);
    ui.faceList.appendChild(item);
  });

  ui.faceInfo.textContent = 'None selected.';
  ui.basisInfo.textContent = 'No basis change computed yet.';
  ui.basisBtn.disabled = true;
  renderHighlights();
}

ui.buildBtn.onclick = rebuild;
ui.basisBtn.onclick = () => {
  if (current.selectedFace < 0) return;
  const n = current.faces[current.selectedFace].normal;

  try {
    const basis = findUnimodularBasisWithNormal(n);
    const inv = inverseIntegerMatrixColumns(basis.u, basis.v, basis.n);
    const transformed = transformExponents(current.terms, inv);

    ui.basisInfo.innerHTML = `
      Unimodular basis matrix M (columns u,v,n):<br>
      <code>[${basis.u.join(', ')}; ${basis.v.join(', ')}; ${basis.n.join(', ')}]</code><br>
      Inverse matrix M<sup>-1</sup>:<br>
      <code>[${inv[0].join(', ')}; ${inv[1].join(', ')}; ${inv[2].join(', ')}]</code><br>
      In transformed coordinates, selected face normal is <code>(0,0,1)</code>.<br>
      Transformed support polynomial (symbolic exponents):<br>
      <code>${formatPolynomialTransformed(transformed)}</code>
    `;
  } catch (err) {
    ui.basisInfo.textContent = err.message;
  }
};

canvas.addEventListener('pointerdown', (ev) => {
  const faceIndex = faceFromPointerEvent(ev);
  if (faceIndex >= 0) selectFace(faceIndex);
});

canvas.addEventListener('pointermove', (ev) => {
  const faceIndex = faceFromPointerEvent(ev);
  if (faceIndex !== current.hoverFace) {
    current.hoverFace = faceIndex;
    renderHighlights();
  }
});

canvas.addEventListener('pointerleave', () => {
  if (current.hoverFace !== -1) {
    current.hoverFace = -1;
    renderHighlights();
  }
});

function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
rebuild();

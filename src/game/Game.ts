import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { DIFFICULTIES, nextCheckDelay, noiseRadius, type Difficulty, type DifficultyId, type Movement } from "./config";

export type Pose = "stand" | "crouch" | "seated" | "lying" | "hidden";
export type ParentMode = "patrol" | "investigate" | "check" | "alarm";

export interface HudState {
  status: "playing" | "won" | "lost";
  locked: boolean;
  checkIn: number;
  warning: boolean;
  mode: ParentMode;
  noise: number; // 0..1
  prompt: string | null;
  message: string | null;
  items: string[];
  itemsTotal: number;
  pose: Pose;
  parentNear: boolean;
  endReason: string;
}

type Box = { minX: number; maxX: number; minZ: number; maxZ: number };
interface Spot { cam: THREE.Vector3; look: THREE.Vector3; exit: THREE.Vector3; pose: Pose; inRoom: boolean }
interface Interactable { x: number; z: number; r: number; prompt: () => string | null; actions: Record<string, () => void> }

// ---- Feel constants ----
const WALK = 3, RUN = 5.5, CROUCH = 1.5, JUMP_V = 4.2, GRAVITY = 12;
const EYE = 1.6, EYE_CROUCH = 1.0, RADIUS = 0.3;
const PARENT_WALK = 2.0, PARENT_RUN = 4.4, CATCH_DIST = 1.0;
const WALL_H = 2.8, WALL_T = 0.2, DOOR_W = 1.6;
const ITEMS_TOTAL = 3;

const NODES: Record<string, [number, number]> = {
  P: [4, 4.5], H1: [4, 8], H2: [12, 8], H3: [20, 8], B: [12, 4], R: [20, 4],
  L: [4, 12.5], L2: [11, 12.5], K2: [16.5, 12.5], K: [20, 12], E: [7, 14.5],
};
const EDGES: [string, string][] = [
  ["P", "H1"], ["H1", "H2"], ["H2", "H3"], ["H2", "B"], ["H3", "R"], ["H1", "L"],
  ["L", "L2"], ["L", "E"], ["L2", "E"], ["L2", "K2"], ["K2", "K"], ["K", "H3"],
];

function canvasTex(draw: (c: CanvasRenderingContext2D, s: number) => void, repeat: [number, number]) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  draw(cv.getContext("2d")!, 256);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Game {
  private d: Difficulty;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: PointerLockControls;
  private clock = new THREE.Clock();
  private raf = 0;
  private colliders: Box[] = [];
  private walls: THREE.Mesh[] = [];
  private interactables: Interactable[] = [];
  private keys = new Set<string>();
  private ray = new THREE.Raycaster();

  // player
  private pos = new THREE.Vector3(4, 0, 4);
  private velY = 0;
  private eye = EYE;
  private pose: Pose = "stand";
  private spot: Spot | null = null;
  private movement: Movement = "idle";
  private items: string[] = [];
  private itemMeshes: THREE.Object3D[] = [];

  // parent
  private parent = new THREE.Group();
  private ppos = new THREE.Vector3(20, 0, 12);
  private pmode: ParentMode = "patrol";
  private path: THREE.Vector3[] = [];
  private pwait = 2;
  private checkedSpots = new Set<Spot>();

  // timers
  private checkTimer: number;
  private warned = false;
  private message: string | null = null;
  private messageTtl = 0;
  private hudTimer = 0;
  private status: HudState["status"] = "playing";
  private endReason = "";
  private locked = false;
  private firstFrame = false;

  constructor(private container: HTMLElement, diff: DifficultyId, private onHud: (h: HudState) => void) {
    this.d = DIFFICULTIES[diff];
    this.checkTimer = nextCheckDelay(this.d);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(72, container.clientWidth / container.clientHeight, 0.05, 60);
    this.camera.position.set(4, EYE, 4);
    this.camera.lookAt(4, EYE, 8);
    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener("lock", () => { this.locked = true; this.emit(); });
    this.controls.addEventListener("unlock", () => { this.locked = false; this.emit(); });

    this.scene.background = new THREE.Color(0x1d1a22);
    this.scene.fog = new THREE.Fog(0x1d1a22, 10, 28);
    this.buildHouse();
    this.buildParent();

    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("resize", this.onResize);
    this.say("Сиди в комнате и делай уроки! Я буду проверять.");
    this.loop();
  }

  lock() { this.controls.lock(); }

  dispose() {
    cancelAnimationFrame(this.raf);
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.onResize);
    this.controls.unlock();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  // ---------------- World ----------------
  private addBox(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, collide = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    this.scene.add(m);
    if (collide) this.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    return m;
  }

  private segments(a: number, b: number, gaps: number[]) {
    const out: [number, number][] = [];
    let cur = a;
    for (const g of [...gaps].sort((p, q) => p - q)) {
      if (g - DOOR_W / 2 > cur) out.push([cur, g - DOOR_W / 2]);
      cur = g + DOOR_W / 2;
    }
    if (b > cur) out.push([cur, b]);
    return out;
  }

  private wallH(z: number, x0: number, x1: number, gaps: number[], mat: THREE.Material) {
    for (const [a, b] of this.segments(x0, x1, gaps)) this.walls.push(this.addBox(b - a, WALL_H, WALL_T, (a + b) / 2, WALL_H / 2, z, mat));
    for (const g of gaps) this.addBox(DOOR_W, WALL_H - 2.1, WALL_T, g, 2.1 + (WALL_H - 2.1) / 2, z, mat, false);
  }
  private wallV(x: number, z0: number, z1: number, gaps: number[], mat: THREE.Material) {
    for (const [a, b] of this.segments(z0, z1, gaps)) this.walls.push(this.addBox(WALL_T, WALL_H, b - a, x, WALL_H / 2, (a + b) / 2, mat));
    for (const g of gaps) this.addBox(WALL_T, WALL_H - 2.1, DOOR_W, x, 2.1 + (WALL_H - 2.1) / 2, g, mat, false);
  }

  private buildHouse() {
    const S = (c: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true, ...extra });

    const floorTex = canvasTex((c, s) => {
      for (let i = 0; i < 8; i++) {
        c.fillStyle = `hsl(28, 38%, ${34 + ((i * 37) % 11)}%)`;
        c.fillRect(0, (i * s) / 8, s, s / 8);
        c.fillStyle = "rgba(0,0,0,0.35)";
        c.fillRect(0, (i * s) / 8, s, 2);
        c.fillRect(((i * 97) % s), (i * s) / 8, 2, s / 8);
      }
    }, [8, 6]);
    const wallTex = canvasTex((c, s) => {
      c.fillStyle = "#d9cfb8"; c.fillRect(0, 0, s, s);
      c.fillStyle = "#c9bc9f";
      for (let x = 0; x < s; x += 32) c.fillRect(x, 0, 10, s);
    }, [3, 1]);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 16), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.7 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(12, 0, 8);
    this.scene.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(24, 16), S(0xeee8dc));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(12, WALL_H, 8);
    this.scene.add(ceil);

    const wall = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 });
    const wallBlue = S(0x8fa7c4);
    // exterior
    this.wallH(0, 0, 24, [], wall);
    this.wallH(16, 0, 24, [7], wall);
    this.wallV(0, 0, 16, [], wall);
    this.wallV(24, 0, 16, [], wall);
    // interior
    this.wallH(7, 0, 24, [4, 12, 20], wall);
    this.wallH(9, 0, 24, [4, 20], wall);
    this.wallV(8, 0, 7, [], wallBlue);
    this.wallV(16, 0, 7, [], wall);
    this.wallV(14, 9, 16, [12.5], wall);

    // lights
    this.scene.add(new THREE.HemisphereLight(0xfff1dc, 0x4a3b30, 1.4));
    for (const [x, z, c] of [[4, 3.5, 0xffe2b0], [12, 3.5, 0xdff0ff], [20, 3.5, 0xffd9b8], [12, 8, 0xffe8c8], [5, 12.5, 0xffe0a8], [20, 12.5, 0xfff4e0]] as const) {
      const l = new THREE.PointLight(c, 6, 11, 1.2);
      l.position.set(x, WALL_H - 0.3, z);
      this.scene.add(l);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: c }));
      bulb.position.copy(l.position);
      this.scene.add(bulb);
    }

    const wood = S(0x8a5a36), woodDark = S(0x5b3a24), white = S(0xf2efe8), blanket = S(0x3f6fb5);
    const red = S(0xb8433a), green = S(0x4f7a52), metal = S(0xb9c0c7, { metalness: 0.4, roughness: 0.4 });

    // --- Player room (x 0..8, z 0..7) ---
    this.addBox(0.7, 0.75, 1.4, 0.5, 0.375, 3.5, wood); // desk
    this.addBox(0.3, 0.05, 0.4, 0.45, 0.78, 3.3, white, false); // notebook
    this.addBox(0.08, 0.4, 0.08, 0.35, 0.95, 4.0, metal, false); // lamp
    this.addBox(0.5, 0.45, 0.5, 1.3, 0.225, 3.5, red, false); // chair
    this.addBox(1.2, 0.5, 2.2, 6.9, 0.25, 1.2, woodDark); // bed frame
    this.addBox(1.15, 0.12, 2.1, 6.9, 0.56, 1.2, blanket, false);
    this.addBox(0.6, 0.12, 0.35, 6.9, 0.68, 0.35, white, false); // pillow
    this.addBox(0.6, 2.2, 1.5, 7.6, 1.1, 5.25, wood); // wardrobe
    this.addBox(1.6, 0.02, 1.0, 4, 0.01, 4.8, red, false); // rug

    const desk: Spot = { cam: new THREE.Vector3(1.4, 1.15, 3.5), look: new THREE.Vector3(0, 0.9, 3.5), exit: new THREE.Vector3(1.8, 0, 3.5), pose: "seated", inRoom: true };
    const bed: Spot = { cam: new THREE.Vector3(6.9, 0.95, 0.8), look: new THREE.Vector3(6.9, 1.6, 4), exit: new THREE.Vector3(6.9, 0, 2.9), pose: "lying", inRoom: true };
    const underBed: Spot = { cam: new THREE.Vector3(6.9, 0.2, 1.4), look: new THREE.Vector3(6.9, 0.2, 5), exit: new THREE.Vector3(6.9, 0, 2.9), pose: "hidden", inRoom: true };
    const wardrobe1: Spot = { cam: new THREE.Vector3(7.6, 1.5, 5.25), look: new THREE.Vector3(4, 1.4, 5.25), exit: new THREE.Vector3(6.8, 0, 5.25), pose: "hidden", inRoom: true };
    this.addInteract(1.6, 3.5, 1.2, () => "E — сесть за стол", { KeyE: () => this.enterSpot(desk) });
    this.addInteract(6.9, 2.7, 1.3, () => "E — лечь на кровать · F — под кровать", { KeyE: () => this.enterSpot(bed), KeyF: () => this.enterSpot(underBed) });
    this.addInteract(6.8, 5.25, 1.1, () => "E — спрятаться в шкаф", { KeyE: () => this.enterSpot(wardrobe1) });

    // --- Bathroom (x 8..16, z 0..7) ---
    this.addBox(1.6, 0.6, 0.8, 14.9, 0.3, 1.0, white);
    this.addBox(0.5, 0.45, 0.6, 9, 0.22, 1, white);
    this.addBox(0.8, 0.8, 0.5, 11, 0.4, 0.4, white);

    // --- Parents' bedroom (x 16..24, z 0..7) ---
    this.addBox(2, 0.5, 2.2, 20, 0.25, 1.2, woodDark);
    this.addBox(1.95, 0.12, 2.1, 20, 0.56, 1.2, red, false);
    this.addBox(0.5, 0.6, 0.5, 22.3, 0.3, 0.5, wood); // nightstand
    this.addBox(0.6, 2.2, 1.5, 23.6, 1.1, 5.5, wood);
    const wardrobe2: Spot = { cam: new THREE.Vector3(23.6, 1.5, 5.5), look: new THREE.Vector3(20, 1.4, 5.5), exit: new THREE.Vector3(22.8, 0, 5.5), pose: "hidden", inRoom: false };
    this.addInteract(22.8, 5.5, 1.1, () => "E — спрятаться в шкаф", { KeyE: () => this.enterSpot(wardrobe2) });

    // --- Living room (x 0..14, z 9..16) ---
    this.addBox(3, 0.8, 0.9, 3, 0.4, 15.2, green); // sofa
    this.addBox(2, 0.5, 0.5, 3, 0.25, 9.6, woodDark); // tv stand
    this.addBox(1.4, 0.8, 0.08, 3, 0.9, 9.5, S(0x111111), false);
    this.addBox(1.1, 1.1, 1.1, 12.8, 0.55, 15.1, S(0xb08a5a)); // boxes
    this.addBox(0.7, 0.6, 0.7, 13.2, 1.4, 15.3, S(0xa07a4a), false);
    const boxes: Spot = { cam: new THREE.Vector3(12.8, 0.6, 15.1), look: new THREE.Vector3(10, 0.8, 12), exit: new THREE.Vector3(12.6, 0, 13.9), pose: "hidden", inRoom: false };
    this.addInteract(12.6, 14, 1.1, () => "E — спрятаться за коробками", { KeyE: () => this.enterSpot(boxes) });

    // --- Kitchen (x 14..24, z 9..16) ---
    this.addBox(2, 0.75, 1.2, 20, 0.375, 13, wood); // table
    this.addBox(7.5, 0.9, 0.7, 20, 0.45, 15.5, white); // counter
    this.addBox(0.9, 1.9, 0.8, 23.4, 0.95, 10, metal); // fridge

    // front door
    this.addBox(DOOR_W, 2.1, 0.12, 7, 1.05, 16, S(0x6b2f22));
    this.addInteract(7, 15.2, 1.2, () => (this.items.length >= ITEMS_TOTAL ? "E — СБЕЖАТЬ!" : `Дверь заперта. Нужно: ключи, телефон, кроссовки (${this.items.length}/${ITEMS_TOTAL})`), {
      KeyE: () => {
        if (this.items.length >= ITEMS_TOTAL) this.end("won", "Ты выбрался на свободу!");
        else this.flash("Без ключей, телефона и кроссовок не уйти.");
      },
    });

    // collectibles
    this.addItem("Ключи", 22.3, 0.7, 0.5, 0xffd34d);
    this.addItem("Телефон", 20, 0.8, 13, 0x222f44);
    this.addItem("Кроссовки", 1, 0.12, 10.5, 0xffffff);
  }

  private addInteract(x: number, z: number, r: number, prompt: () => string | null, actions: Record<string, () => void>) {
    const it = { x, z, r, prompt, actions };
    this.interactables.push(it);
    return it;
  }

  private addItem(name: string, x: number, y: number, z: number, color: number) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.32), new THREE.MeshStandardMaterial({ color, emissive: 0xffb84d, emissiveIntensity: 0.6 }));
    m.position.set(x, y, z);
    m.userData.baseY = y;
    this.scene.add(m);
    this.itemMeshes.push(m);
    const it = this.addInteract(x, z, 1.5, () => `E — взять: ${name}`, {
      KeyE: () => {
        this.items.push(name);
        this.scene.remove(m);
        this.itemMeshes = this.itemMeshes.filter((o) => o !== m);
        this.interactables = this.interactables.filter((o) => o !== it);
        this.flash(`Найдено: ${name} (${this.items.length}/${ITEMS_TOTAL})`);
      },
    });
  }

  private buildParent() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xe8b996, flatShading: true });
    const dress = new THREE.MeshStandardMaterial({ color: 0x9c2f4a, flatShading: true });
    const hair = new THREE.MeshStandardMaterial({ color: 0x3a2418, flatShading: true });
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.8, 0.25), new THREE.MeshStandardMaterial({ color: 0x2b2b3a }));
    legs.position.y = 0.4;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.38, 0.75, 7), dress);
    body.position.y = 1.15;
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.19, 0), skin);
    head.position.y = 1.7;
    const bun = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), hair);
    bun.position.set(0, 1.82, -0.12);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.08), skin);
    nose.position.set(0, 1.7, 0.19);
    this.parent.add(legs, body, head, bun, nose);
    this.parent.position.copy(this.ppos);
    this.scene.add(this.parent);
  }

  // ---------------- Helpers ----------------
  private resolve(p: THREE.Vector3, r: number) {
    for (const b of this.colliders) {
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        p.x += (dx / d) * (r - d);
        p.z += (dz / d) * (r - d);
      } else {
        const pushes = [b.maxX - p.x + r, p.x - b.minX + r, b.maxZ - p.z + r, p.z - b.minZ + r];
        const i = pushes.indexOf(Math.min(...pushes));
        if (i === 0) p.x += pushes[0]; else if (i === 1) p.x -= pushes[1]; else if (i === 2) p.z += pushes[2]; else p.z -= pushes[3];
      }
    }
  }

  private los(a: THREE.Vector3, b: THREE.Vector3) {
    const dir = b.clone().sub(a);
    const dist = dir.length();
    this.ray.set(a, dir.normalize());
    this.ray.far = dist;
    return this.ray.intersectObjects(this.walls, false).length === 0;
  }

  private nearestNode(p: THREE.Vector3) {
    let best = "H1", bestD = Infinity;
    const a = new THREE.Vector3(p.x, 1.2, p.z);
    for (const [k, [x, z]] of Object.entries(NODES)) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < bestD && this.los(a, new THREE.Vector3(x, 1.2, z))) { best = k; bestD = d; }
    }
    return best;
  }

  private pathTo(target: THREE.Vector3) {
    const start = this.nearestNode(this.ppos), goal = this.nearestNode(target);
    const prev: Record<string, string | null> = { [start]: null };
    const q = [start];
    while (q.length) {
      const n = q.shift()!;
      if (n === goal) break;
      for (const [a, b] of EDGES) {
        const m = a === n ? b : b === n ? a : null;
        if (m && !(m in prev)) { prev[m] = n; q.push(m); }
      }
    }
    const nodes: string[] = [];
    for (let n: string | null = goal; n; n = prev[n] ?? null) nodes.unshift(n);
    this.path = [...nodes.map((n) => new THREE.Vector3(NODES[n][0], 0, NODES[n][1])), target.clone().setY(0)];
  }

  private randomNode() {
    const keys = Object.keys(NODES);
    const [x, z] = NODES[keys[Math.floor(Math.random() * keys.length)]];
    return new THREE.Vector3(x, 0, z);
  }

  private inPlayerRoom() { return this.pos.x < 8 && this.pos.z < 7; }

  private canSeePlayer() {
    if (this.pose === "hidden") return false;
    const eye = this.ppos.clone().setY(1.6);
    const target = this.camera.position.clone();
    const to = target.clone().sub(eye);
    const dist = to.length();
    const range = this.d.visionRange * (this.pose === "crouch" ? 0.6 : 1) * (this.pmode === "alarm" ? 1.3 : 1);
    if (dist > range) return false;
    const facing = new THREE.Vector3(Math.sin(this.parent.rotation.y), 0, Math.cos(this.parent.rotation.y));
    const flat = to.clone().setY(0).normalize();
    const fov = this.pmode === "alarm" ? 85 : this.d.visionFovDeg;
    if (dist > 1.5 && facing.dot(flat) < Math.cos((fov * Math.PI) / 180)) return false;
    return this.los(eye, target);
  }

  private enterSpot(s: Spot) {
    this.spot = s;
    this.pose = s.pose;
    this.camera.position.copy(s.cam);
    this.camera.lookAt(s.look);
  }
  private exitSpot() {
    if (!this.spot) return;
    this.pos.copy(this.spot.exit);
    this.spot = null;
    this.pose = "stand";
    this.eye = EYE;
  }

  private flash(text: string, ttl = 3) { this.message = text; this.messageTtl = ttl; }
  private say(text: string) {
    this.flash(text, 4);
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ru-RU";
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    }
  }

  private end(status: "won" | "lost", reason: string) {
    this.status = status;
    this.endReason = reason;
    this.controls.unlock();
    this.emit();
  }

  private startAlarm(text: string) {
    if (this.pmode !== "alarm") this.say(text);
    this.pmode = "alarm";
    this.checkedSpots.clear();
  }

  // ---------------- Input ----------------
  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
    if (e.code === "Space") e.preventDefault();
    if (this.status !== "playing" || !this.locked || e.repeat) return;
    if ((e.code === "KeyE" || e.code === "KeyF") && this.spot) { this.exitSpot(); return; }
    const it = this.nearestInteract();
    if (it && it.actions[e.code]) it.actions[e.code]();
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private onResize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private nearestInteract() {
    if (this.spot) return null;
    let best: Interactable | null = null, bestD = Infinity;
    for (const it of this.interactables) {
      const d = Math.hypot(it.x - this.pos.x, it.z - this.pos.z);
      if (d < it.r && d < bestD) { best = it; bestD = d; }
    }
    return best;
  }

  // ---------------- Simulation ----------------
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.status === "playing") this.step(dt);
    this.renderer.render(this.scene, this.camera);
    if (!this.firstFrame) { this.firstFrame = true; this.container.dataset.sceneReady = "true"; }
  };

  private step(dt: number) {
    this.updatePlayer(dt);
    this.updateChecks(dt);
    this.updateParent(dt);
    const t = performance.now() / 1000;
    for (const m of this.itemMeshes) { m.rotation.y = t * 1.5; m.position.y = m.userData.baseY + Math.sin(t * 3) * 0.04 + 0.04; }
    if (this.messageTtl > 0 && (this.messageTtl -= dt) <= 0) this.message = null;
    if ((this.hudTimer -= dt) <= 0) { this.hudTimer = 0.1; this.emit(); }
  }

  private updatePlayer(dt: number) {
    if (this.spot) { this.movement = "idle"; return; }
    const k = this.keys;
    const crouch = k.has("KeyC") || k.has("ControlLeft") || k.has("ControlRight");
    const run = (k.has("ShiftLeft") || k.has("ShiftRight")) && !crouch;
    this.pose = crouch ? "crouch" : "stand";

    const fwd = new THREE.Vector3();
    this.controls.getDirection(fwd);
    fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const move = new THREE.Vector3();
    if (this.locked) {
      if (k.has("KeyW")) move.add(fwd);
      if (k.has("KeyS")) move.sub(fwd);
      if (k.has("KeyD")) move.add(right);
      if (k.has("KeyA")) move.sub(right);
    }
    const moving = move.lengthSq() > 0;
    const speed = crouch ? CROUCH : run ? RUN : WALK;
    if (moving) this.pos.addScaledVector(move.normalize(), speed * dt);
    this.movement = !moving ? "idle" : crouch ? "crouch" : run ? "run" : "walk";

    const onGround = this.pos.y <= 0.0001;
    if (onGround && k.has("Space") && this.locked && !crouch) this.velY = JUMP_V;
    this.velY -= GRAVITY * dt;
    this.pos.y = Math.max(0, this.pos.y + this.velY * dt);
    if (this.pos.y === 0) this.velY = Math.max(0, this.velY);
    if (!onGround && this.pos.y === 0) this.movement = "walk"; // landing thud

    this.resolve(this.pos, RADIUS);
    this.eye += ((crouch ? EYE_CROUCH : EYE) - this.eye) * (1 - Math.exp(-12 * dt));
    this.camera.position.set(this.pos.x, this.pos.y + this.eye, this.pos.z);
  }

  private updateChecks(dt: number) {
    if (this.pmode === "alarm" || this.pmode === "check") return;
    this.checkTimer -= dt;
    if (!this.warned && this.checkTimer <= this.d.warn) {
      this.warned = true;
      this.say("Иду проверять уроки!");
    }
    if (this.checkTimer <= 0) {
      this.pmode = "check";
      this.pathTo(new THREE.Vector3(NODES.P[0], 0, NODES.P[1]));
    }
  }

  private finishCheck() {
    if (this.pose === "seated" || this.pose === "lying") {
      this.say(this.pose === "seated" ? "Молодец, занимайся." : "Отдыхаешь? Ладно, только недолго.");
      this.pmode = "patrol";
      this.path = [];
      this.pwait = 2;
      this.checkTimer = nextCheckDelay(this.d);
      this.warned = false;
      return;
    }
    if (this.spot && this.spot.inRoom && Math.random() < this.d.hideCheckChance) {
      this.end("lost", this.spot === null ? "" : "Родители заглянули в укрытие и нашли тебя!");
      return;
    }
    this.startAlarm("Где он?! Ну я тебе сейчас покажу!");
  }

  private updateParent(dt: number) {
    const sees = this.canSeePlayer();
    const dist = Math.hypot(this.pos.x - this.ppos.x, this.pos.z - this.ppos.z);

    // Spotting outside own room triggers the alarm
    if (sees && this.pmode !== "alarm" && !this.inPlayerRoom()) this.startAlarm("Ага! Ты почему не в комнате?!");

    // Hearing
    const heard = dist < noiseRadius(this.movement, this.d.hearingMul) && !this.inPlayerRoom();
    if (heard && this.pmode === "patrol") { this.pmode = "investigate"; this.pathTo(this.pos); }

    let speed = PARENT_WALK;
    if (this.pmode === "alarm") {
      speed = PARENT_RUN;
      if (sees || heard) this.path = [this.pos.clone().setY(0)];
      if (sees && dist < CATCH_DIST) { this.end("lost", "Тебя поймали! Домашний арест на месяц."); return; }
      // search hiding spots nearby
      if (this.spot && !this.checkedSpots.has(this.spot) && Math.hypot(this.spot.exit.x - this.ppos.x, this.spot.exit.z - this.ppos.z) < 1.4) {
        this.checkedSpots.add(this.spot);
        if (Math.random() < 0.2 + this.d.hideCheckChance) { this.end("lost", "Тебя нашли в укрытии!"); return; }
      }
      if (!this.path.length) this.pathTo(this.randomNode());
    }

    if (this.path.length) {
      const target = this.path[0];
      const dx = target.x - this.ppos.x, dz = target.z - this.ppos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.25) {
        this.path.shift();
        if (!this.path.length) {
          if (this.pmode === "check") this.finishCheck();
          else if (this.pmode === "investigate") { this.pmode = "patrol"; this.pwait = 2.5; }
          else if (this.pmode === "patrol") this.pwait = 1 + Math.random() * 3;
        }
      } else {
        const s = Math.min(d, speed * dt);
        this.ppos.x += (dx / d) * s;
        this.ppos.z += (dz / d) * s;
        this.resolve(this.ppos, 0.3);
        const targetRot = Math.atan2(dx, dz);
        let diff = targetRot - this.parent.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.parent.rotation.y += diff * (1 - Math.exp(-10 * dt));
      }
    } else if (this.pmode === "patrol" && (this.pwait -= dt) <= 0) {
      this.pathTo(this.randomNode());
    }

    this.parent.position.set(this.ppos.x, Math.abs(Math.sin(performance.now() / (this.pmode === "alarm" ? 90 : 160))) * 0.05, this.ppos.z);
  }

  private emit() {
    const it = this.nearestInteract();
    const dist = Math.hypot(this.pos.x - this.ppos.x, this.pos.z - this.ppos.z);
    this.onHud({
      status: this.status,
      locked: this.locked,
      checkIn: Math.max(0, this.checkTimer),
      warning: this.warned && this.pmode !== "alarm",
      mode: this.pmode,
      noise: { idle: 0, crouch: 0, walk: 0.5, run: 1 }[this.movement],
      prompt: this.spot ? "E — выйти" : it ? it.prompt() : null,
      message: this.message,
      items: [...this.items],
      itemsTotal: ITEMS_TOTAL,
      pose: this.pose,
      parentNear: !this.d.silentParentSteps && dist < 7,
      endReason: this.endReason,
    });
  }
}

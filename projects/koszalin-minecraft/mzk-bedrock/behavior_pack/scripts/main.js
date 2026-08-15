import { system, world } from "@minecraft/server";
import { LANDMARKS, META, ROUTES, STOPS } from "./data.js";

const DIMENSION = world.getDimension("overworld");
const GROUND_Y = 64;
const BUILD_RADIUS_CHUNKS = 3;
const COMMANDS_PER_TICK = 70;
const BUS_INTERVAL_TICKS = 4;
const BUS_STEP = 0.72;
const BUS_RENDER_DISTANCE = 120;

const generatedChunks = new Set();
const builtStops = new Set();
const builtLandmarks = new Set();
const commandQueue = [];
let commandQueueHead = 0;
const roadSegmentsByChunk = new Map();
const waterSegmentsByChunk = new Map();
const stopsByChunk = new Map();
const landmarksByChunk = new Map();
const stopDirections = new Map();
const busStates = [];

const LINE_EVENT = {
  "1S": "mzk:line_1s", "1": "mzk:line_1", "2": "mzk:line_2", "3": "mzk:line_3",
  "4": "mzk:line_4", "6": "mzk:line_6", "8": "mzk:line_8", "9": "mzk:line_9",
  "10": "mzk:line_10", "11": "mzk:line_11", "12": "mzk:line_12", "13": "mzk:line_13",
  "14": "mzk:line_14", "15": "mzk:line_15", "16": "mzk:line_16", "17": "mzk:line_17",
  "18": "mzk:line_18", "20": "mzk:line_20", "21S": "mzk:line_21s", "23S": "mzk:line_23s"
};

function chunkOf(value) {
  return Math.floor(value / 16);
}

function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

function clampInteger(value) {
  return Math.round(Number.isFinite(value) ? value : 0);
}

function queue(command) {
  commandQueue.push(command);
}

function setBlock(x, y, z, block) {
  queue(`setblock ${clampInteger(x)} ${clampInteger(y)} ${clampInteger(z)} ${block}`);
}

function fill(x1, y1, z1, x2, y2, z2, block, mode = "") {
  const suffix = mode ? ` ${mode}` : "";
  queue(`fill ${clampInteger(x1)} ${clampInteger(y1)} ${clampInteger(z1)} ${clampInteger(x2)} ${clampInteger(y2)} ${clampInteger(z2)} ${block}${suffix}`);
}

function hollow(x1, y1, z1, x2, y2, z2, block) {
  fill(x1, y1, z1, x2, y2, z2, block, "hollow");
}

function bresenham(x0, z0, x1, z1, visitor) {
  x0 = Math.round(x0); z0 = Math.round(z0); x1 = Math.round(x1); z1 = Math.round(z1);
  let dx = Math.abs(x1 - x0);
  let sx = x0 < x1 ? 1 : -1;
  let dz = -Math.abs(z1 - z0);
  let sz = z0 < z1 ? 1 : -1;
  let error = dx + dz;
  for (;;) {
    visitor(x0, z0);
    if (x0 === x1 && z0 === z1) break;
    const twice = 2 * error;
    if (twice >= dz) { error += dz; x0 += sx; }
    if (twice <= dx) { error += dx; z0 += sz; }
  }
}

function addToIndex(index, key, value) {
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(value);
}

function indexTransitData() {
  const segmentFingerprints = new Set();
  ROUTES.forEach((route) => {
    route.patterns.forEach((pattern) => {
      for (let position = 0; position + 1 < pattern.stops.length; position++) {
        const aIndex = pattern.stops[position];
        const bIndex = pattern.stops[position + 1];
        const a = STOPS[aIndex];
        const b = STOPS[bIndex];
        if (!a || !b || (a.x === b.x && a.z === b.z)) continue;
        if (!stopDirections.has(aIndex)) stopDirections.set(aIndex, { dx: b.x - a.x, dz: b.z - a.z });
        if (!stopDirections.has(bIndex)) stopDirections.set(bIndex, { dx: b.x - a.x, dz: b.z - a.z });
        const prefix = route.vehicle === "ferry" ? "water" : "road";
        const forward = `${prefix}:${a.x},${a.z}:${b.x},${b.z}`;
        const reverse = `${prefix}:${b.x},${b.z}:${a.x},${a.z}`;
        if (segmentFingerprints.has(forward) || segmentFingerprints.has(reverse)) continue;
        segmentFingerprints.add(forward);
        const segment = { x1: a.x, z1: a.z, x2: b.x, z2: b.z };
        const padding = route.vehicle === "ferry" ? 6 : 2;
        const minCx = chunkOf(Math.min(a.x, b.x) - padding);
        const maxCx = chunkOf(Math.max(a.x, b.x) + padding);
        const minCz = chunkOf(Math.min(a.z, b.z) - padding);
        const maxCz = chunkOf(Math.max(a.z, b.z) + padding);
        const targetIndex = route.vehicle === "ferry" ? waterSegmentsByChunk : roadSegmentsByChunk;
        for (let cx = minCx; cx <= maxCx; cx++) {
          for (let cz = minCz; cz <= maxCz; cz++) addToIndex(targetIndex, chunkKey(cx, cz), segment);
        }
      }
    });
  });
  STOPS.forEach((stop, index) => addToIndex(stopsByChunk, chunkKey(chunkOf(stop.x), chunkOf(stop.z)), index));
  LANDMARKS.forEach((landmark, index) => addToIndex(landmarksByChunk, chunkKey(chunkOf(landmark.x), chunkOf(landmark.z)), index));
}

function createBusStates() {
  ROUTES.forEach((route) => {
    route.patterns.forEach((pattern, patternIndex) => {
      const points = pattern.stops.map((stopIndex) => STOPS[stopIndex]).filter(Boolean);
      if (points.length < 2) return;
      const cumulative = [0];
      for (let index = 1; index < points.length; index++) {
        cumulative.push(cumulative[index - 1] + Math.hypot(points[index].x - points[index - 1].x, points[index].z - points[index - 1].z));
      }
      const total = cumulative[cumulative.length - 1];
      if (total < 2) return;
      busStates.push({
        line: route.line,
        vehicle: route.vehicle || "bus",
        headsign: pattern.headsign,
        pattern,
        points,
        cumulative,
        total,
        distance: total * (pattern.phase || (patternIndex * 0.37)),
        entity: undefined,
        lastAnnouncement: -1
      });
    });
  });
}

function processCommandQueue() {
  let remaining = COMMANDS_PER_TICK;
  while (remaining-- > 0 && commandQueueHead < commandQueue.length) {
    const command = commandQueue[commandQueueHead++];
    try { DIMENSION.runCommand(command); } catch (error) { /* A chunk may unload; nearby generation retries on revisit. */ }
  }
  if (commandQueueHead > 4096 && commandQueueHead * 2 > commandQueue.length) {
    commandQueue.splice(0, commandQueueHead);
    commandQueueHead = 0;
  }
}

function buildGroundChunk(cx, cz) {
  const x1 = cx * 16;
  const z1 = cz * 16;
  fill(x1, GROUND_Y - 4, z1, x1 + 15, GROUND_Y - 1, z1 + 15, "minecraft:stone");
  fill(x1, GROUND_Y, z1, x1 + 15, GROUND_Y, z1 + 15, "minecraft:grass_block");
}

function buildRoadsForChunk(cx, cz) {
  const key = chunkKey(cx, cz);
  const segments = roadSegmentsByChunk.get(key) || [];
  const minX = cx * 16;
  const maxX = minX + 15;
  const minZ = cz * 16;
  const maxZ = minZ + 15;
  const blocks = new Set();
  segments.forEach((segment) => {
    bresenham(segment.x1, segment.z1, segment.x2, segment.z2, (x, z) => {
      if (x < minX - 2 || x > maxX + 2 || z < minZ - 2 || z > maxZ + 2) return;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const bx = x + ox;
          const bz = z + oz;
          if (bx >= minX && bx <= maxX && bz >= minZ && bz <= maxZ) blocks.add(`${bx},${bz}`);
        }
      }
    });
  });
  blocks.forEach((entry) => {
    const [x, z] = entry.split(",").map(Number);
    setBlock(x, GROUND_Y, z, "minecraft:gray_concrete");
  });
}

function buildWaterForChunk(cx, cz) {
  const key = chunkKey(cx, cz);
  const segments = waterSegmentsByChunk.get(key) || [];
  const minX = cx * 16;
  const maxX = minX + 15;
  const minZ = cz * 16;
  const maxZ = minZ + 15;
  const blocks = new Set();
  segments.forEach((segment) => {
    bresenham(segment.x1, segment.z1, segment.x2, segment.z2, (x, z) => {
      if (x < minX - 6 || x > maxX + 6 || z < minZ - 6 || z > maxZ + 6) return;
      for (let ox = -5; ox <= 5; ox++) {
        for (let oz = -5; oz <= 5; oz++) {
          if (ox * ox + oz * oz > 31) continue;
          const bx = x + ox;
          const bz = z + oz;
          if (bx >= minX && bx <= maxX && bz >= minZ && bz <= maxZ) blocks.add(`${bx},${bz}`);
        }
      }
    });
  });
  blocks.forEach((entry) => {
    const [x, z] = entry.split(",").map(Number);
    setBlock(x, GROUND_Y - 1, z, "minecraft:sand");
    setBlock(x, GROUND_Y, z, "minecraft:water");
  });
}

function markerExists(tag, x, y, z) {
  try {
    return DIMENSION.getEntities({ type: "mzk:marker", tags: [tag], location: { x, y, z }, maxDistance: 24 }).length > 0;
  } catch (error) {
    return false;
  }
}

function spawnMarker(tag, label, x, y, z) {
  system.runTimeout(() => {
    try {
      if (markerExists(tag, x, y, z)) return;
      const marker = DIMENSION.spawnEntity("mzk:marker", { x: x + 0.5, y, z: z + 0.5 });
      marker.nameTag = label;
      marker.addTag(tag);
    } catch (error) { /* Marker will be retried after the next world load. */ }
  }, 30);
}

function stopShelterPosition(index) {
  const stop = STOPS[index];
  const direction = stopDirections.get(index) || { dx: 1, dz: 0 };
  const length = Math.max(1, Math.hypot(direction.dx, direction.dz));
  const side = /\s02$/.test(stop.name) ? -1 : 1;
  return {
    x: stop.x + Math.round((-direction.dz / length) * 3 * side),
    z: stop.z + Math.round((direction.dx / length) * 3 * side),
    alongX: Math.abs(direction.dx) >= Math.abs(direction.dz)
  };
}

function buildStop(index) {
  if (builtStops.has(index)) return;
  builtStops.add(index);
  const stop = STOPS[index];
  const shelter = stopShelterPosition(index);
  const x = shelter.x;
  const z = shelter.z;
  if (stop.lines.length === 1 && stop.lines[0] === "1S") {
    fill(x - 3, GROUND_Y, z - 5, x + 3, GROUND_Y, z + 5, "minecraft:oak_planks");
    fill(x - 3, GROUND_Y + 1, z - 5, x - 3, GROUND_Y + 2, z + 5, "minecraft:oak_fence");
    fill(x + 3, GROUND_Y + 1, z - 5, x + 3, GROUND_Y + 2, z + 5, "minecraft:oak_fence");
    fill(x, GROUND_Y + 1, z - 4, x, GROUND_Y + 4, z - 4, "minecraft:yellow_concrete");
    setBlock(x, GROUND_Y + 5, z - 4, "minecraft:blue_concrete");
    spawnMarker(`mzk_stop_${index}`, `§b${stop.name}§r\n§eLinia 1S • statek Julek`, x, GROUND_Y + 6.3, z);
    return;
  }
  if (shelter.alongX) {
    fill(x - 2, GROUND_Y, z - 1, x + 2, GROUND_Y, z + 1, "minecraft:smooth_stone");
    fill(x - 2, GROUND_Y + 1, z + 1, x + 2, GROUND_Y + 3, z + 1, "minecraft:glass");
    fill(x - 2, GROUND_Y + 4, z - 1, x + 2, GROUND_Y + 4, z + 1, "minecraft:green_concrete");
    fill(x - 1, GROUND_Y + 1, z, x + 1, GROUND_Y + 1, z, "minecraft:oak_slab");
    fill(x - 3, GROUND_Y + 1, z, x - 3, GROUND_Y + 4, z, "minecraft:yellow_concrete");
    setBlock(x - 3, GROUND_Y + 5, z, "minecraft:green_concrete");
  } else {
    fill(x - 1, GROUND_Y, z - 2, x + 1, GROUND_Y, z + 2, "minecraft:smooth_stone");
    fill(x + 1, GROUND_Y + 1, z - 2, x + 1, GROUND_Y + 3, z + 2, "minecraft:glass");
    fill(x - 1, GROUND_Y + 4, z - 2, x + 1, GROUND_Y + 4, z + 2, "minecraft:green_concrete");
    fill(x, GROUND_Y + 1, z - 1, x, GROUND_Y + 1, z + 1, "minecraft:oak_slab");
    fill(x, GROUND_Y + 1, z - 3, x, GROUND_Y + 4, z - 3, "minecraft:yellow_concrete");
    setBlock(x, GROUND_Y + 5, z - 3, "minecraft:green_concrete");
  }
  const lines = stop.lines.length ? stop.lines.join("  ") : "—";
  spawnMarker(`mzk_stop_${index}`, `§a${stop.name}§r\n§eLinie: ${lines}`, x, GROUND_Y + 6.3, z);
}

function labelLandmark(index, y = GROUND_Y + 10) {
  const item = LANDMARKS[index];
  spawnMarker(`mzk_landmark_${index}`, `§6${item.name}`, item.x, y, item.z);
}

function buildTownHall(item) {
  const x = item.x, z = item.z;
  fill(x - 17, GROUND_Y, z - 15, x + 17, GROUND_Y, z + 15, "minecraft:smooth_stone");
  fill(x - 3, GROUND_Y + 1, z - 3, x + 3, GROUND_Y + 1, z + 3, "minecraft:light_blue_concrete");
  hollow(x - 15, GROUND_Y + 1, z + 8, x + 15, GROUND_Y + 9, z + 15, "minecraft:quartz_block");
  fill(x - 15, GROUND_Y + 10, z + 8, x + 15, GROUND_Y + 10, z + 15, "minecraft:smooth_quartz");
  for (let wx = x - 12; wx <= x + 12; wx += 4) fill(wx, GROUND_Y + 3, z + 7, wx + 1, GROUND_Y + 6, z + 7, "minecraft:light_blue_stained_glass");
  hollow(x - 3, GROUND_Y + 10, z + 10, x + 3, GROUND_Y + 17, z + 14, "minecraft:quartz_block");
  fill(x - 4, GROUND_Y + 18, z + 9, x + 4, GROUND_Y + 18, z + 15, "minecraft:smooth_quartz");
  setBlock(x, GROUND_Y + 15, z + 9, "minecraft:gold_block");
  fill(x - 1, GROUND_Y + 1, z + 7, x + 1, GROUND_Y + 4, z + 8, "minecraft:air");
}

function buildCathedral(item) {
  const x = item.x, z = item.z;
  hollow(x - 6, GROUND_Y + 1, z - 12, x + 6, GROUND_Y + 10, z + 9, "minecraft:bricks");
  fill(x - 7, GROUND_Y + 11, z - 13, x + 7, GROUND_Y + 11, z + 10, "minecraft:deepslate_tiles");
  for (let y = 12; y <= 16; y++) fill(x - (17 - y), GROUND_Y + y, z - 12, x + (17 - y), GROUND_Y + y, z + 9, "minecraft:deepslate_tiles");
  hollow(x - 4, GROUND_Y + 1, z + 7, x + 4, GROUND_Y + 23, z + 13, "minecraft:bricks");
  for (let y = 24; y <= 30; y++) fill(x - Math.max(0, 30 - y), GROUND_Y + y, z + 8, x + Math.max(0, 30 - y), GROUND_Y + y, z + 12, "minecraft:deepslate_tiles");
  fill(x, GROUND_Y + 31, z + 10, x, GROUND_Y + 34, z + 10, "minecraft:gold_block");
  fill(x - 2, GROUND_Y + 33, z + 10, x + 2, GROUND_Y + 33, z + 10, "minecraft:gold_block");
  for (let wz = z - 9; wz <= z + 4; wz += 5) {
    setBlock(x - 7, GROUND_Y + 6, wz, "minecraft:yellow_stained_glass");
    setBlock(x + 7, GROUND_Y + 6, wz, "minecraft:yellow_stained_glass");
  }
  fill(x - 1, GROUND_Y + 1, z + 6, x + 1, GROUND_Y + 4, z + 7, "minecraft:air");
}

function buildStation(item) {
  const x = item.x, z = item.z;
  hollow(x - 18, GROUND_Y + 1, z - 5, x + 18, GROUND_Y + 8, z + 5, "minecraft:smooth_sandstone");
  fill(x - 19, GROUND_Y + 9, z - 6, x + 19, GROUND_Y + 9, z + 6, "minecraft:light_gray_concrete");
  fill(x - 14, GROUND_Y + 3, z - 6, x + 14, GROUND_Y + 7, z - 6, "minecraft:light_blue_stained_glass");
  fill(x - 2, GROUND_Y + 1, z - 6, x + 2, GROUND_Y + 5, z - 5, "minecraft:air");
  for (let track = 0; track < 3; track++) {
    const tz = z + 10 + track * 4;
    fill(x - 30, GROUND_Y, tz, x + 30, GROUND_Y, tz, "minecraft:iron_block");
    fill(x - 30, GROUND_Y, tz + 1, x + 30, GROUND_Y, tz + 1, "minecraft:polished_andesite");
  }
}

function buildAmphitheatre(item) {
  const x = item.x, z = item.z;
  fill(x - 14, GROUND_Y, z - 10, x + 14, GROUND_Y, z + 13, "minecraft:smooth_stone");
  for (let row = 0; row < 8; row++) {
    const half = 5 + row;
    fill(x - half, GROUND_Y + Math.floor(row / 2) + 1, z + 3 + row, x + half, GROUND_Y + Math.floor(row / 2) + 1, z + 3 + row, "minecraft:stone_brick_stairs");
  }
  fill(x - 8, GROUND_Y + 1, z - 8, x + 8, GROUND_Y + 1, z - 2, "minecraft:black_concrete");
  for (let y = 2; y <= 13; y++) {
    const half = Math.max(3, 10 - Math.floor(y / 2));
    fill(x - half, GROUND_Y + y, z - 9, x + half, GROUND_Y + y, z - 9, "minecraft:quartz_block");
  }
  fill(x - 10, GROUND_Y + 2, z - 10, x - 10, GROUND_Y + 12, z - 2, "minecraft:iron_block");
  fill(x + 10, GROUND_Y + 2, z - 10, x + 10, GROUND_Y + 12, z - 2, "minecraft:iron_block");
}

function buildPhilharmonic(item) {
  const x = item.x, z = item.z;
  hollow(x - 10, GROUND_Y + 1, z - 7, x + 10, GROUND_Y + 12, z + 7, "minecraft:white_concrete");
  fill(x - 8, GROUND_Y + 2, z - 8, x + 8, GROUND_Y + 10, z - 8, "minecraft:tinted_glass");
  for (let rib = -8; rib <= 8; rib += 4) fill(x + rib, GROUND_Y + 1, z - 9, x + rib, GROUND_Y + 13, z + 8, "minecraft:quartz_pillar");
  fill(x - 11, GROUND_Y + 13, z - 8, x + 11, GROUND_Y + 13, z + 8, "minecraft:smooth_quartz");
}

function buildMuseum(item) {
  const x = item.x, z = item.z;
  hollow(x - 9, GROUND_Y + 1, z - 8, x + 9, GROUND_Y + 9, z + 8, "minecraft:bricks");
  fill(x - 10, GROUND_Y + 10, z - 9, x + 10, GROUND_Y + 10, z + 9, "minecraft:dark_oak_planks");
  for (let wx = -6; wx <= 6; wx += 4) {
    fill(x + wx, GROUND_Y + 3, z - 9, x + wx + 1, GROUND_Y + 6, z - 9, "minecraft:light_blue_stained_glass");
    fill(x + wx, GROUND_Y + 3, z + 9, x + wx + 1, GROUND_Y + 6, z + 9, "minecraft:light_blue_stained_glass");
  }
  fill(x + 11, GROUND_Y + 1, z - 4, x + 11, GROUND_Y + 9, z + 4, "minecraft:oak_log");
  for (let blade = -4; blade <= 4; blade++) {
    setBlock(x + 11, GROUND_Y + 6 + blade, z + blade, "minecraft:oak_planks");
    setBlock(x + 11, GROUND_Y + 6 + blade, z - blade, "minecraft:oak_planks");
  }
}

function buildTheatre(item) {
  const x = item.x, z = item.z;
  hollow(x - 11, GROUND_Y + 1, z - 7, x + 11, GROUND_Y + 10, z + 7, "minecraft:calcite");
  fill(x - 12, GROUND_Y + 11, z - 8, x + 12, GROUND_Y + 11, z + 8, "minecraft:light_gray_concrete");
  fill(x - 5, GROUND_Y + 2, z - 8, x + 5, GROUND_Y + 8, z - 8, "minecraft:red_stained_glass");
  for (let column = -9; column <= 9; column += 3) fill(x + column, GROUND_Y + 1, z - 9, x + column, GROUND_Y + 10, z - 9, "minecraft:quartz_pillar");
}

function buildWaterPark(item) {
  const x = item.x, z = item.z;
  hollow(x - 13, GROUND_Y + 1, z - 9, x + 13, GROUND_Y + 9, z + 9, "minecraft:cyan_concrete");
  fill(x - 11, GROUND_Y + 2, z - 10, x + 11, GROUND_Y + 7, z - 10, "minecraft:light_blue_stained_glass");
  for (let wave = -12; wave <= 12; wave += 4) {
    fill(x + wave, GROUND_Y + 10, z - 8, x + wave + 3, GROUND_Y + 12, z + 8, "minecraft:blue_concrete");
  }
  fill(x - 9, GROUND_Y + 1, z + 12, x + 9, GROUND_Y + 1, z + 22, "minecraft:water");
}

function buildSportsHall(item) {
  const x = item.x, z = item.z;
  for (let level = 0; level < 10; level++) {
    const inset = Math.floor(level / 3);
    fill(x - 14 + inset, GROUND_Y + 1 + level, z - 9 + inset, x + 14 - inset, GROUND_Y + 1 + level, z + 9 - inset, level % 3 === 0 ? "minecraft:cyan_stained_glass" : "minecraft:light_gray_concrete");
  }
  fill(x - 10, GROUND_Y + 2, z - 10, x + 10, GROUND_Y + 7, z - 10, "minecraft:cyan_stained_glass");
}

function buildUniversity(item) {
  const x = item.x, z = item.z;
  hollow(x - 14, GROUND_Y + 1, z - 5, x + 14, GROUND_Y + 10, z + 5, "minecraft:white_concrete");
  for (let wx = -11; wx <= 11; wx += 4) fill(x + wx, GROUND_Y + 3, z - 6, x + wx + 1, GROUND_Y + 7, z - 6, "minecraft:blue_stained_glass");
  fill(x - 15, GROUND_Y + 11, z - 6, x + 15, GROUND_Y + 11, z + 6, "minecraft:light_gray_concrete");
  fill(x - 2, GROUND_Y + 1, z - 7, x + 2, GROUND_Y + 5, z - 5, "minecraft:air");
}

function buildMall(item) {
  const x = item.x, z = item.z;
  hollow(x - 17, GROUND_Y + 1, z - 11, x + 17, GROUND_Y + 9, z + 11, "minecraft:smooth_quartz");
  fill(x - 15, GROUND_Y + 2, z - 12, x + 15, GROUND_Y + 7, z - 12, "minecraft:blue_stained_glass");
  fill(x - 18, GROUND_Y + 10, z - 12, x + 18, GROUND_Y + 10, z + 12, "minecraft:green_concrete");
  fill(x - 4, GROUND_Y + 1, z - 13, x + 4, GROUND_Y + 6, z - 11, "minecraft:air");
}

function buildDepot(item) {
  const x = item.x, z = item.z;
  hollow(x - 18, GROUND_Y + 1, z - 9, x + 18, GROUND_Y + 8, z + 9, "minecraft:yellow_concrete");
  for (let gate = -14; gate <= 14; gate += 7) fill(x + gate, GROUND_Y + 1, z - 10, x + gate + 4, GROUND_Y + 5, z - 9, "minecraft:gray_concrete");
  fill(x - 20, GROUND_Y, z - 22, x + 20, GROUND_Y, z - 11, "minecraft:gray_concrete");
  for (let lane = -16; lane <= 16; lane += 8) fill(x + lane, GROUND_Y + 1, z - 21, x + lane, GROUND_Y + 1, z - 12, "minecraft:yellow_concrete");
}

function buildChelm(item) {
  const x = item.x, z = item.z;
  for (let level = 0; level < 12; level++) {
    const radius = 22 - level;
    fill(x - radius, GROUND_Y + level, z - radius, x + radius, GROUND_Y + level, z + radius, level > 8 ? "minecraft:stone" : "minecraft:grass_block");
  }
  fill(x - 3, GROUND_Y + 12, z - 3, x + 3, GROUND_Y + 28, z + 3, "minecraft:stone_bricks", "hollow");
  for (let y = GROUND_Y + 16; y <= GROUND_Y + 27; y += 4) fill(x - 4, y, z - 4, x + 4, y, z + 4, "minecraft:iron_bars");
  fill(x - 5, GROUND_Y + 29, z - 5, x + 5, GROUND_Y + 29, z + 5, "minecraft:dark_oak_planks");
  fill(x, GROUND_Y + 30, z, x, GROUND_Y + 35, z, "minecraft:gold_block");
  fill(x - 2, GROUND_Y + 33, z, x + 2, GROUND_Y + 33, z, "minecraft:gold_block");
}

function buildLandmark(index) {
  if (builtLandmarks.has(index)) return;
  builtLandmarks.add(index);
  const item = LANDMARKS[index];
  const builders = {
    town_hall: buildTownHall, cathedral: buildCathedral, station: buildStation,
    amphitheatre: buildAmphitheatre, philharmonic: buildPhilharmonic, museum: buildMuseum,
    theatre: buildTheatre, water_park: buildWaterPark, sports_hall: buildSportsHall,
    university: buildUniversity, mall: buildMall, depot: buildDepot, chelm: buildChelm
  };
  const builder = builders[item.kind];
  if (builder) builder(item);
  labelLandmark(index, GROUND_Y + (item.kind === "cathedral" || item.kind === "chelm" ? 37 : 15));
}

function generateChunk(cx, cz) {
  const key = chunkKey(cx, cz);
  if (generatedChunks.has(key)) return;
  generatedChunks.add(key);
  buildGroundChunk(cx, cz);
  buildRoadsForChunk(cx, cz);
  buildWaterForChunk(cx, cz);
  (stopsByChunk.get(key) || []).forEach(buildStop);
  (landmarksByChunk.get(key) || []).forEach(buildLandmark);
}

function generateAroundPlayers() {
  for (const player of world.getAllPlayers()) {
    const cx = chunkOf(player.location.x);
    const cz = chunkOf(player.location.z);
    for (let dx = -BUILD_RADIUS_CHUNKS; dx <= BUILD_RADIUS_CHUNKS; dx++) {
      for (let dz = -BUILD_RADIUS_CHUNKS; dz <= BUILD_RADIUS_CHUNKS; dz++) generateChunk(cx + dx, cz + dz);
    }
  }
}

function stateLocation(state) {
  let segment = 0;
  while (segment + 1 < state.cumulative.length && state.cumulative[segment + 1] < state.distance) segment++;
  segment = Math.min(segment, state.points.length - 2);
  const a = state.points[segment];
  const b = state.points[segment + 1];
  const start = state.cumulative[segment];
  const length = Math.max(0.001, state.cumulative[segment + 1] - start);
  const t = Math.max(0, Math.min(1, (state.distance - start) / length));
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    yaw: Math.atan2(-(b.x - a.x), b.z - a.z) * 180 / Math.PI,
    segment
  };
}

function entityValid(entity) {
  try { return Boolean(entity && entity.isValid); } catch (error) { return false; }
}

function playersNear(location, distance) {
  const distanceSquared = distance * distance;
  return world.getAllPlayers().filter((player) => {
    const dx = player.location.x - location.x;
    const dz = player.location.z - location.z;
    return dx * dx + dz * dz <= distanceSquared;
  });
}

function announceNextStop(state, nextIndex, location) {
  const stop = state.points[nextIndex];
  if (!stop || state.lastAnnouncement === nextIndex || !entityValid(state.entity)) return;
  state.lastAnnouncement = nextIndex;
  try {
    DIMENSION.playSound(`mzk.stop.${stop.sound}`, { x: location.x, y: GROUND_Y + 2, z: location.z }, { volume: 1.1, pitch: 1.0 });
  } catch (error) {
    try { DIMENSION.runCommand(`playsound mzk.stop.${stop.sound} @a[x=${Math.round(location.x)},y=${GROUND_Y},z=${Math.round(location.z)},r=24] ${location.x} ${GROUND_Y + 2} ${location.z} 1.1 1.0`); } catch (ignored) {}
  }
  playersNear(location, 16).forEach((player) => {
    try { player.onScreenDisplay.setActionBar(`§eLinia ${state.line}§r  •  Następny: §a${stop.name}`); } catch (error) {}
  });
}

function updateBuses() {
  const players = world.getAllPlayers();
  if (players.length === 0) return;
  busStates.forEach((state) => {
    const previous = state.distance;
    state.distance = (state.distance + BUS_STEP) % state.total;
    const location = stateLocation(state);
    const nearby = playersNear(location, BUS_RENDER_DISTANCE).length > 0;
    if (!nearby) {
      if (entityValid(state.entity)) {
        try { state.entity.remove(); } catch (error) {}
      }
      state.entity = undefined;
      return;
    }
    if (!entityValid(state.entity)) {
      try {
        const entityType = state.vehicle === "ferry" ? "mzk:ferry" : "mzk:bus";
        const vehicleY = state.vehicle === "ferry" ? GROUND_Y + 0.35 : GROUND_Y + 1.05;
        state.entity = DIMENSION.spawnEntity(entityType, { x: location.x, y: vehicleY, z: location.z });
        if (state.vehicle !== "ferry") state.entity.triggerEvent(LINE_EVENT[state.line]);
        state.entity.nameTag = state.vehicle === "ferry"
          ? `§e1S§r  §bStatek Julek§r • ${state.headsign}`
          : `§e${state.line}§r  ${state.headsign}`;
        state.entity.addTag("mzk_runtime_bus");
      } catch (error) {
        state.entity = undefined;
        return;
      }
    }
    try {
      state.entity.teleport(
        { x: location.x, y: state.vehicle === "ferry" ? GROUND_Y + 0.35 : GROUND_Y + 1.05, z: location.z },
        { dimension: DIMENSION, rotation: { x: 0, y: location.yaw }, keepVelocity: false }
      );
    } catch (error) {
      state.entity = undefined;
      return;
    }
    const nextIndex = Math.min(location.segment + 1, state.points.length - 1);
    const threshold = state.cumulative[location.segment] + Math.min(4, (state.cumulative[nextIndex] - state.cumulative[location.segment]) * 0.35);
    const crossed = previous <= state.distance
      ? previous < threshold && state.distance >= threshold
      : threshold > previous || threshold <= state.distance;
    if (crossed) announceNextStop(state, nextIndex, location);
    if (location.segment === 0 && state.distance < 2) state.lastAnnouncement = -1;
  });
}

function preparePlayer(player) {
  try {
    if (!player.hasTag("mzk_welcome_v2")) {
      // Make a safe plaza synchronously before moving a first-time player out of the void spawn.
      DIMENSION.runCommand(`fill -18 ${GROUND_Y - 4} -18 18 ${GROUND_Y} 18 minecraft:stone`);
      DIMENSION.runCommand(`fill -17 ${GROUND_Y} -17 17 ${GROUND_Y} 17 minecraft:smooth_stone`);
      player.teleport({ x: 0.5, y: GROUND_Y + 2, z: 0.5 }, { dimension: DIMENSION });
      try { player.setSpawnPoint({ dimension: DIMENSION, x: 0, y: GROUND_Y + 2, z: 0 }); } catch (error) {}
      player.addTag("mzk_welcome_v2");
      player.sendMessage("§6Koszalin MZK – główne obiekty i pełna sieć przystanków");
      player.sendMessage(`§a${META.lines} linii • ${META.activeDirectionalStops} aktywnych przystanków kierunkowych • polskie zapowiedzi`);
      player.sendMessage("§7Miasto dobudowuje teren, drogi i wiaty w pobliżu gracza. Dotknij autobusu, aby wsiąść.");
      try { player.onScreenDisplay.setTitle("§eKOSZALIN MZK", { subtitle: "§aRynek Staromiejski", fadeInDuration: 10, stayDuration: 80, fadeOutDuration: 20 }); } catch (error) {}
    }
  } catch (error) {}
}

function removeStaleBuses() {
  try {
    for (const bus of DIMENSION.getEntities({ type: "mzk:bus", tags: ["mzk_runtime_bus"] })) bus.remove();
    for (const ferry of DIMENSION.getEntities({ type: "mzk:ferry", tags: ["mzk_runtime_bus"] })) ferry.remove();
  } catch (error) {}
}

indexTransitData();
createBusStates();
system.runTimeout(removeStaleBuses, 10);
world.afterEvents.playerSpawn.subscribe((event) => system.runTimeout(() => preparePlayer(event.player), 5));
system.runInterval(processCommandQueue, 1);
system.runInterval(generateAroundPlayers, 35);
system.runInterval(updateBuses, BUS_INTERVAL_TICKS);
system.runTimeout(() => world.getAllPlayers().forEach(preparePlayer), 20);

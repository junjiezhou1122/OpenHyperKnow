/**
 * Simple JSON-file course store. Zero-dependency persistence so courses
 * survive backend restarts (upgradeable to Supabase later).
 */
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const DATA_DIR = join(process.cwd(), "data");
const COURSES_FILE = join(DATA_DIR, "courses.json");

export interface StoredCourse {
  id: string;
  createdAt: number;
  updatedAt: number;
  topic: string;
  course: unknown;
  progress?: Record<string, string>; // lessonKey → status
}

async function ensureFile(): Promise<Map<string, StoredCourse>> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(COURSES_FILE, "utf8");
    const arr = JSON.parse(raw) as StoredCourse[];
    return new Map(arr.map((c) => [c.id, c]));
  } catch {
    return new Map();
  }
}

async function writeAll(map: Map<string, StoredCourse>) {
  const arr = [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
  await fs.writeFile(COURSES_FILE, JSON.stringify(arr, null, 2));
}

export async function listCourses(): Promise<StoredCourse[]> {
  const map = await ensureFile();
  return [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export async function getCourse(id: string): Promise<StoredCourse | null> {
  const map = await ensureFile();
  return map.get(id) ?? null;
}

export async function saveCourse(topic: string, course: unknown, id?: string): Promise<StoredCourse> {
  const map = await ensureFile();
  const now = Date.now();
  const existing = id ? map.get(id) : undefined;
  const stored: StoredCourse = {
    id: existing?.id ?? randomUUID(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    topic: existing?.topic ?? topic,
    course: course as any,
    progress: existing?.progress ?? {},
  };
  map.set(stored.id, stored);
  await writeAll(map);
  return stored;
}

export async function updateProgress(id: string, key: string, status: string): Promise<StoredCourse | null> {
  const map = await ensureFile();
  const c = map.get(id);
  if (!c) return null;
  c.progress = { ...c.progress, [key]: status };
  c.updatedAt = Date.now();
  map.set(id, c);
  await writeAll(map);
  return c;
}

export async function deleteCourse(id: string): Promise<boolean> {
  const map = await ensureFile();
  const had = map.delete(id);
  if (had) await writeAll(map);
  return had;
}

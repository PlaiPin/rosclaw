/**
 * Sample distance (meters) from a ROS2 depth image topic (e.g. RealSense).
 * Supports 16UC1 (depth in mm) and 32FC1 (depth in m).
 */

import type { RosTransport } from "./transport/transport.js";

const IMAGE_TYPE = "sensor_msgs/msg/Image";
const DEFAULT_TIMEOUT_MS = 5000;

function toByteArray(data: unknown): Uint8Array {
  if (data == null) throw new Error("Depth image has no data");
  if (typeof data === "string") {
    return new Uint8Array(Buffer.from(data, "base64"));
  }
  if (Array.isArray(data)) {
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = Number(data[i]) & 0xff;
    return out;
  }
  throw new Error("Depth data must be string (base64) or array of bytes");
}

/**
 * Sample center region of a depth image and return median distance in meters.
 * - 16UC1: values in mm (RealSense typical) → divide by 1000
 * - 32FC1: values in m → use as-is
 * Invalid/zero pixels are skipped.
 */
export function sampleDepthMeters(
  width: number,
  height: number,
  step: number,
  encoding: string,
  data: Uint8Array,
  centerFraction = 0.3,
): number[] {
  const values: number[] = [];
  const isBigEndian = false; // ROS often sends LE; step is in bytes
  const cx = width / 2;
  const cy = height / 2;
  const halfW = Math.max(1, Math.floor((width * centerFraction) / 2));
  const halfH = Math.max(1, Math.floor((height * centerFraction) / 2));
  const x0 = Math.max(0, Math.floor(cx - halfW));
  const x1 = Math.min(width, Math.floor(cx + halfW));
  const y0 = Math.max(0, Math.floor(cy - halfH));
  const y1 = Math.min(height, Math.floor(cy + halfH));

  if (encoding === "16UC1" || encoding === "16uC1") {
    // 2 bytes per pixel, row stride = step
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const off = y * step + x * 2;
        if (off + 2 > data.length) continue;
        const lo = data[off];
        const hi = data[off + 1];
        const v = isBigEndian ? (lo << 8) | hi : (hi << 8) | lo;
        if (v > 0) values.push(v / 1000); // mm -> m
      }
    }
  } else if (encoding === "32FC1" || encoding === "32fC1") {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const off = y * step + x * 4;
        if (off + 4 > data.length) continue;
        const v = new DataView(data.buffer, data.byteOffset + off, 4).getFloat32(0, !isBigEndian);
        if (Number.isFinite(v) && v > 0) values.push(v);
      }
    }
  } else {
    throw new Error(`Unsupported depth encoding: ${encoding}. Use 16UC1 (mm) or 32FC1 (m).`);
  }
  return values;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return NaN;
  const m = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[m];
  return (sorted[m - 1] + sorted[m]) / 2;
}

export interface DepthSampleResult {
  distance_m: number;
  valid: boolean;
  topic: string;
  encoding: string;
  width: number;
  height: number;
  sample_count: number;
  min_m: number;
  max_m: number;
}

/**
 * Subscribe to a depth topic, get one message, sample center region, return median distance in meters.
 */
export async function getDepthDistance(
  transport: RosTransport,
  topic: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<DepthSampleResult> {
  const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const sub = transport.subscribe(
      { topic, type: IMAGE_TYPE },
      (msg: Record<string, unknown>) => {
        clearTimeout(timer);
        sub.unsubscribe();
        resolve(msg);
      },
    );
    const timer = setTimeout(() => {
      sub.unsubscribe();
      reject(new Error(`Depth snapshot timeout on ${topic}`));
    }, timeoutMs);
  });

  const width = Number(result.width) || 0;
  const height = Number(result.height) || 0;
  const step = Number(result.step) || width * 2; // 16UC1 default
  const encoding = (result.encoding as string) ?? "16UC1";
  const data = toByteArray(result.data);

  const values = sampleDepthMeters(width, height, step, encoding, data);
  const sorted = values.slice().sort((a, b) => a - b);
  const distance_m = median(sorted);
  const min_m = sorted.length ? sorted[0] : NaN;
  const max_m = sorted.length ? sorted[sorted.length - 1] : NaN;

  return {
    distance_m: Math.round(distance_m * 1000) / 1000,
    valid: sorted.length > 0 && Number.isFinite(distance_m),
    topic,
    encoding,
    width,
    height,
    sample_count: sorted.length,
    min_m: Math.round(min_m * 1000) / 1000,
    max_m: Math.round(max_m * 1000) / 1000,
  };
}

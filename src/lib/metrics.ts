// src/lib/metrics.ts
// Simple metrics helpers with console-based structured logging

/**
 * Increment a counter metric
 * Outputs structured log: [metrics] counter_name{label1="value1"} 1
 */
export function incrementCounter(name: string, labels: Record<string, string> = {}): void {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(',')

  const metricLine = labelStr
    ? `${name}{${labelStr}} 1`
    : `${name} 1`

  console.log(`[metrics] ${metricLine}`)
}

/**
 * Record a latency/duration metric in milliseconds
 * Outputs structured log: [metrics] latency_name{label1="value1"} 123ms
 */
export function recordLatency(name: string, labels: Record<string, string> = {}, durationMs: number): void {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(',')

  const metricLine = labelStr
    ? `${name}{${labelStr}} ${durationMs}ms`
    : `${name} ${durationMs}ms`

  console.log(`[metrics] ${metricLine}`)
}

/**
 * Record a gauge metric (current value)
 * Outputs structured log: [metrics] gauge_name{label1="value1"} 42
 */
export function recordGauge(name: string, labels: Record<string, string> = {}, value: number): void {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(',')

  const metricLine = labelStr
    ? `${name}{${labelStr}} ${value}`
    : `${name} ${value}`

  console.log(`[metrics] ${metricLine}`)
}

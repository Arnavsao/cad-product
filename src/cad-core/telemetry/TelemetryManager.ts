export interface ExportMetrics {
    exportId: string;
    format: string;
    entityCount: number;
    startTime: number;
    endTime: number;
    durationMs: number;
    payloadSizeBytes: number;
    outputSizeBytes: number;
    memoryUsageMB: number;
    status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
    error?: string;
}

export class TelemetryManager {
    private static metricsLog: ExportMetrics[] = [];

    public static startExportTracking(format: string, entityCount: number, payloadSize: number): Partial<ExportMetrics> {
        return {
            exportId: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(7),
            format,
            entityCount,
            startTime: performance.now(),
            payloadSizeBytes: payloadSize
        };
    }

    public static finalizeTracking(metrics: Partial<ExportMetrics>, outputSize: number, status: 'SUCCESS' | 'FAILED' | 'PARTIAL', errorMsg?: string) {
        const endTime = performance.now();
        const durationMs = endTime - metrics.startTime!;
        
        let memory = 0;
        // @ts-ignore
        if (performance.memory) {
            // @ts-ignore
            memory = performance.memory.usedJSHeapSize / (1024 * 1024);
        }

        const finalMetrics: ExportMetrics = {
            ...metrics,
            endTime,
            durationMs,
            outputSizeBytes: outputSize,
            memoryUsageMB: memory,
            status,
            error: errorMsg
        } as ExportMetrics;

        this.metricsLog.push(finalMetrics);
        this.logStructured(finalMetrics);
        
        return finalMetrics;
    }

    private static logStructured(metrics: ExportMetrics) {
        if (metrics.status === 'SUCCESS') {
            
        } else {
            console.error(`[CAD Telemetry] Export FAILED | Format: ${metrics.format} | Time: ${metrics.durationMs.toFixed(2)}ms | Error: ${metrics.error}`);
        }
    }

    public static getMetrics() {
        return this.metricsLog;
    }
}

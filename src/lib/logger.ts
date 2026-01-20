/**
 * Central In-Memory Logger for Pipeline Observability
 * 
 * Features:
 * - Log levels: INFO | WARN | ERROR | DEBUG
 * - Timestamped entries
 * - Structured metadata support
 * - Exportable log history
 */

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    stage: string;
    message: string;
    metadata?: Record<string, unknown>;
}

class PipelineLogger {
    private logs: LogEntry[] = [];
    private debugEnabled: boolean = process.env.NODE_ENV === 'development';

    /**
     * Clear all logs (use between requests)
     */
    clear(): void {
        this.logs = [];
    }

    /**
     * Get all log entries
     */
    getLogs(): LogEntry[] {
        return [...this.logs];
    }

    /**
     * Get logs as formatted string
     */
    getFormattedLogs(): string {
        return this.logs
            .map(entry => {
                const meta = entry.metadata ? ` | ${JSON.stringify(entry.metadata)}` : '';
                return `[${entry.timestamp}] [${entry.level}] [${entry.stage}] ${entry.message}${meta}`;
            })
            .join('\n');
    }

    /**
     * Enable or disable debug logging
     */
    setDebugEnabled(enabled: boolean): void {
        this.debugEnabled = enabled;
    }

    /**
     * Internal log method
     */
    private log(level: LogLevel, stage: string, message: string, metadata?: Record<string, unknown>): void {
        // Skip DEBUG logs if not enabled
        if (level === 'DEBUG' && !this.debugEnabled) {
            return;
        }

        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            stage,
            message,
            ...(metadata && { metadata })
        };

        this.logs.push(entry);

        // Also log to console for development
        const consoleMethod = level === 'ERROR' ? console.error :
            level === 'WARN' ? console.warn :
                console.log;
        const metaStr = metadata ? ` ${JSON.stringify(metadata)}` : '';
        consoleMethod(`[${entry.level}] [${stage}] ${message}${metaStr}`);
    }

    /**
     * Log INFO level message
     */
    info(stage: string, message: string, metadata?: Record<string, unknown>): void {
        this.log('INFO', stage, message, metadata);
    }

    /**
     * Log WARN level message
     */
    warn(stage: string, message: string, metadata?: Record<string, unknown>): void {
        this.log('WARN', stage, message, metadata);
    }

    /**
     * Log ERROR level message
     */
    error(stage: string, message: string, metadata?: Record<string, unknown>): void {
        this.log('ERROR', stage, message, metadata);
    }

    /**
     * Log DEBUG level message
     */
    debug(stage: string, message: string, metadata?: Record<string, unknown>): void {
        this.log('DEBUG', stage, message, metadata);
    }

    /**
     * Create a scoped logger for a specific stage
     */
    scoped(stage: string): ScopedLogger {
        return new ScopedLogger(this, stage);
    }
}

/**
 * Scoped logger that pre-fills the stage name
 */
class ScopedLogger {
    constructor(
        private parent: PipelineLogger,
        private stage: string
    ) { }

    info(message: string, metadata?: Record<string, unknown>): void {
        this.parent.info(this.stage, message, metadata);
    }

    warn(message: string, metadata?: Record<string, unknown>): void {
        this.parent.warn(this.stage, message, metadata);
    }

    error(message: string, metadata?: Record<string, unknown>): void {
        this.parent.error(this.stage, message, metadata);
    }

    debug(message: string, metadata?: Record<string, unknown>): void {
        this.parent.debug(this.stage, message, metadata);
    }
}

// Export singleton instance
export const logger = new PipelineLogger();

// Export class for testing
export { PipelineLogger, ScopedLogger };

"use client";

import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import {
  Globe,
  Loader2,
  Copy,
  Check,
  AlertCircle,
  CheckCircle,
  Info,
  AlertTriangle,
  Bug,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface LogEntry {
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  stage: string;
  message: string;
  metadata?: Record<string, unknown>;
}

interface PipelineResult {
  success: boolean;
  jsonLd?: object;
  detectedType?: string;
  repairs?: string[];
  logs: LogEntry[];
  stats?: {
    ingestionTimeMs: number;
    cleaningTimeMs: number;
    extractionTimeMs: number;
    validationTimeMs: number;
    totalTimeMs: number;
    tokenUsage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  };
  stage?: string;
  reason?: string;
}

function LogLevelIcon({ level }: { level: LogEntry["level"] }) {
  switch (level) {
    case "INFO":
      return <Info className="w-4 h-4 text-blue-400" />;
    case "WARN":
      return <AlertTriangle className="w-4 h-4 text-amber-400" />;
    case "ERROR":
      return <AlertCircle className="w-4 h-4 text-red-400" />;
    case "DEBUG":
      return <Bug className="w-4 h-4 text-gray-500" />;
  }
}

function LogConsole({ logs }: { logs: LogEntry[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    if (containerRef.current && isExpanded) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, isExpanded]);

  if (logs.length === 0) return null;

  return (
    <div className="glass rounded-xl overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted">Pipeline Logs</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">
            {logs.length}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-muted" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted" />
        )}
      </button>

      {isExpanded && (
        <div
          ref={containerRef}
          className="max-h-80 overflow-y-auto p-4 pt-0 font-mono text-xs space-y-1"
        >
          {logs.map((log, index) => (
            <div
              key={index}
              className={`flex items-start gap-2 py-1 ${log.level === "ERROR"
                  ? "bg-red-500/10 -mx-4 px-4"
                  : log.level === "WARN"
                    ? "bg-amber-500/10 -mx-4 px-4"
                    : ""
                }`}
            >
              <LogLevelIcon level={log.level} />
              <span className="text-muted shrink-0">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span className="text-primary shrink-0">[{log.stage}]</span>
              <span className="text-foreground">{log.message}</span>
              {log.metadata && (
                <span className="text-muted">
                  {JSON.stringify(log.metadata)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JsonLdOutput({
  jsonLd,
  detectedType,
}: {
  jsonLd: object;
  detectedType: string;
}) {
  const [copied, setCopied] = useState(false);

  const jsonString = JSON.stringify(jsonLd, null, 2);
  const scriptTag = `<script type="application/ld+json">\n${jsonString}\n</script>`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(scriptTag);
      setCopied(true);
      toast.success("Copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-card-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-success/20 flex items-center justify-center">
            <CheckCircle className="w-4 h-4 text-success" />
          </div>
          <div>
            <h3 className="font-semibold">Generated JSON-LD</h3>
            <p className="text-sm text-muted">Schema Type: {detectedType}</p>
          </div>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover transition-colors text-white font-medium"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" />
              Copy
            </>
          )}
        </button>
      </div>

      <div className="p-4 overflow-x-auto">
        <pre className="text-sm">
          <code>
            <span className="text-muted">&lt;script type=&quot;application/ld+json&quot;&gt;</span>
            {"\n"}
            {jsonString.split("\n").map((line, i) => (
              <span key={i}>
                {line
                  .replace(/"([^"]+)":/g, '<span class="text-purple-400">"$1"</span>:')
                  .replace(/: "([^"]+)"/g, ': <span class="text-green-400">"$1"</span>')
                  .replace(/: (\d+)/g, ': <span class="text-amber-400">$1</span>')
                  .split(/(<span[^>]*>.*?<\/span>)/)
                  .map((part, j) =>
                    part.startsWith("<span") ? (
                      <span key={j} dangerouslySetInnerHTML={{ __html: part }} />
                    ) : (
                      part
                    )
                  )}
                {"\n"}
              </span>
            ))}
            <span className="text-muted">&lt;/script&gt;</span>
          </code>
        </pre>
      </div>
    </div>
  );
}

function StatsDisplay({ stats }: { stats: NonNullable<PipelineResult["stats"]> }) {
  return (
    <div className="glass rounded-xl p-4">
      <h3 className="text-sm font-medium text-muted mb-3">Pipeline Stats</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <p className="text-2xl font-bold text-primary">
            {(stats.totalTimeMs / 1000).toFixed(1)}s
          </p>
          <p className="text-xs text-muted">Total Time</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-info">
            {stats.tokenUsage.totalTokens.toLocaleString()}
          </p>
          <p className="text-xs text-muted">Tokens Used</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-success">
            {(stats.ingestionTimeMs / 1000).toFixed(1)}s
          </p>
          <p className="text-xs text-muted">Ingestion</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-warning">
            {(stats.extractionTimeMs / 1000).toFixed(1)}s
          </p>
          <p className="text-xs text-muted">Extraction</p>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PipelineResult | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!url.trim()) {
      toast.error("Please enter a URL");
      return;
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      toast.error("Please enter a valid URL");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();
      setResult(data);

      if (data.success) {
        toast.success(`Generated ${data.detectedType} schema!`);
      } else {
        toast.error(`Failed at ${data.stage}: ${data.reason}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network error";
      toast.error(message);
      setResult({
        success: false,
        stage: "network",
        reason: message,
        logs: [],
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm text-primary font-medium">
              Powered by Claude 3.5 Haiku
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold gradient-text">
            SEO Structured Data Generator
          </h1>
          <p className="text-lg text-muted max-w-2xl mx-auto">
            Generate Schema.org-compliant JSON-LD from any URL. Built for
            accuracy, optimized for Google Rich Results.
          </p>
        </div>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="glass rounded-xl p-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" />
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/product-page"
                className="w-full pl-12 pr-4 py-4 rounded-xl bg-secondary border border-card-border focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none text-foreground placeholder:text-muted"
                disabled={loading}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className={`px-8 py-4 rounded-xl font-semibold text-white transition-all flex items-center justify-center gap-2 min-w-[160px] ${loading
                  ? "bg-primary/50 cursor-not-allowed"
                  : "bg-primary hover:bg-primary-hover pulse-glow"
                }`}
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Generate
                </>
              )}
            </button>
          </div>
        </form>

        {/* Results */}
        {result && (
          <div className="space-y-6">
            {/* Stats */}
            {result.success && result.stats && <StatsDisplay stats={result.stats} />}

            {/* Error Display */}
            {!result.success && (
              <div className="glass rounded-xl p-6 border border-error/30">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-error/20 flex items-center justify-center shrink-0">
                    <AlertCircle className="w-5 h-5 text-error" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-error">
                      Pipeline Failed at {result.stage}
                    </h3>
                    <p className="text-muted mt-1">{result.reason}</p>
                  </div>
                </div>
              </div>
            )}

            {/* JSON-LD Output */}
            {result.success && result.jsonLd && result.detectedType && (
              <JsonLdOutput jsonLd={result.jsonLd} detectedType={result.detectedType} />
            )}

            {/* Repairs */}
            {result.repairs && result.repairs.length > 0 && (
              <div className="glass rounded-xl p-4">
                <h3 className="text-sm font-medium text-muted mb-2">
                  Repairs Applied
                </h3>
                <ul className="text-sm space-y-1">
                  {result.repairs.map((repair, i) => (
                    <li key={i} className="text-warning flex items-center gap-2">
                      <AlertTriangle className="w-3 h-3" />
                      {repair}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Logs */}
            <LogConsole logs={result.logs} />
          </div>
        )}

        {/* Supported Types */}
        {!result && (
          <div className="glass rounded-xl p-6">
            <h3 className="text-sm font-medium text-muted mb-4">
              Supported Schema Types
            </h3>
            <div className="flex flex-wrap gap-2">
              {[
                "Product",
                "Recipe",
                "Event",
                "LocalBusiness",
                "Article",
                "BlogPosting",
                "FAQPage",
                "HowTo",
                "WebPage",
              ].map((type) => (
                <span
                  key={type}
                  className="px-3 py-1.5 rounded-lg bg-secondary text-sm text-muted"
                >
                  {type}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

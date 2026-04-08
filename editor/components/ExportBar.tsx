'use client';

import { useState } from 'react';

interface ExportBarProps {
  projectDir: string;
  onSave: () => Promise<void>;
  onRender: () => Promise<void>;
  onExportXML: () => Promise<void>;
  onExportAE: () => Promise<void>;
}

type OperationKey = 'save' | 'render' | 'xml' | 'ae';

interface StatusState {
  message: string;
  kind: 'idle' | 'busy' | 'success' | 'error';
}

const OPERATION_LABELS: Record<OperationKey, { busy: string; success: string }> = {
  save:   { busy: 'Saving timeline…',         success: 'Timeline saved.' },
  render: { busy: 'Rendering MP4…',           success: 'Render complete.' },
  xml:    { busy: 'Exporting Premiere XML…',  success: 'Premiere XML exported.' },
  ae:     { busy: 'Exporting AE script…',     success: 'AE script exported.' },
};

export default function ExportBar({
  projectDir,
  onSave,
  onRender,
  onExportXML,
  onExportAE,
}: ExportBarProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusState>({ message: '', kind: 'idle' });

  async function run(key: OperationKey, handler: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setStatus({ message: OPERATION_LABELS[key].busy, kind: 'busy' });
    try {
      await handler();
      setStatus({ message: OPERATION_LABELS[key].success, kind: 'success' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ message: `Error: ${msg}`, kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const statusColor =
    status.kind === 'error'
      ? 'text-red-400'
      : status.kind === 'success'
      ? 'text-emerald-400'
      : status.kind === 'busy'
      ? 'text-zinc-300'
      : 'text-zinc-500';

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-zinc-800 border-t border-zinc-700 flex-wrap">
      {/* Save */}
      <button
        onClick={() => run('save', onSave)}
        disabled={busy}
        className="px-3 py-1.5 text-sm rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Save Timeline
      </button>

      {/* Render */}
      <button
        onClick={() => run('render', onRender)}
        disabled={busy}
        className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Render MP4
      </button>

      {/* Export Premiere XML */}
      <button
        onClick={() => run('xml', onExportXML)}
        disabled={busy}
        className="px-3 py-1.5 text-sm rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Export Premiere XML
      </button>

      {/* Export AE Script */}
      <button
        onClick={() => run('ae', onExportAE)}
        disabled={busy}
        className="px-3 py-1.5 text-sm rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Export AE Script
      </button>

      {/* Spinner + status */}
      <div className="flex items-center gap-2 ml-auto min-w-0">
        {status.kind === 'busy' && (
          <svg
            className="animate-spin h-4 w-4 text-zinc-300 shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12" cy="12" r="10"
              stroke="currentColor" strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {status.message && (
          <span className={`text-sm truncate ${statusColor}`} title={status.message}>
            {status.message}
          </span>
        )}
      </div>
    </div>
  );
}

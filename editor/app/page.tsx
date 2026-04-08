'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ProjectData } from '@/lib/types';
import EditorLayout from '@/components/EditorLayout';

function EditorContent() {
  const searchParams = useSearchParams();
  const projectDir = searchParams.get('project');

  const [data, setData] = useState<ProjectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectDir) {
      setError('No project directory specified. Add ?project=<path> to the URL.');
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    fetch(`/api/load-project?dir=${encodeURIComponent(projectDir)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText);
          throw new Error(`${res.status} ${text}`);
        }
        return res.json() as Promise<ProjectData>;
      })
      .then((projectData) => {
        setData(projectData);
        setLoading(false);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => controller.abort();
  }, [projectDir]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <div className="flex items-center gap-3 text-zinc-400">
          <svg
            className="animate-spin h-5 w-5 shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">Loading project...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <div className="max-w-md text-center px-6">
          <p className="text-red-400 text-sm font-semibold mb-2">Failed to load project</p>
          <p className="text-zinc-500 text-xs font-mono break-all">{error}</p>
        </div>
      </div>
    );
  }

  return <EditorLayout project={data!} />;
}

export default function EditorPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen bg-zinc-950">
          <span className="text-zinc-400 text-sm animate-pulse">Loading...</span>
        </div>
      }
    >
      <EditorContent />
    </Suspense>
  );
}

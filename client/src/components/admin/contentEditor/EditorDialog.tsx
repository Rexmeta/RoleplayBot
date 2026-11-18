import type React from 'react';
import { Dialog } from '@/components/ui/dialog';
import { ContentEditor, type ContentEditorProps } from './ContentEditor';

/**
 * Modal host for a ContentEditor used by small record forms (company, organization, language, ...).
 * The editor only mounts while open, keyed by `editorKey`, so its clean baseline is always taken
 * from the initialized form, never from a previous record.
 */
export function EditorDialog({ open, editorKey, ...editor }: ContentEditorProps & { open: boolean; editorKey: string }) {
  return <Dialog open={open} onOpenChange={next => { if (!next && !editor.pending) editor.onClose(); }}>
    {open && <ContentEditor key={editorKey} {...editor} />}
  </Dialog>;
}

/** Shared submit handler: ContentEditor's form must never navigate. */
export const submitWith = (action: () => void) => (event: React.FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  action();
};

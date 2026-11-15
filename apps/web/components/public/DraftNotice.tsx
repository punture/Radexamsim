/** Prominent banner for policy pages that are drafts and not yet in effect. */
export function DraftNotice({ document }: { document: string }) {
  return (
    <div className="alert alert-warning draft-banner" role="note" aria-label={`${document} status`}>
      <strong>DRAFT — pending owner and legal review; not yet in effect</strong>
      This {document.toLowerCase()} describes what the current build does and what we propose for launch. It may change before it takes effect, and it is not a binding commitment in its current form.
    </div>
  );
}

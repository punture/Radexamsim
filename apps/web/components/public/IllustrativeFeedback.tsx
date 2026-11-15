/**
 * A clearly labelled, fictional excerpt showing the FORMAT of evidence-linked feedback.
 * It is not drawn from a real learner, a real assessment or an owner-approved case.
 */
export function IllustrativeFeedback() {
  return (
    <div className="card illustrative stack" role="group" aria-labelledby="illustrative-title" aria-describedby="illustrative-note">
      <div className="row-between">
        <h3 id="illustrative-title" style={{ margin: 0 }}>Debrief excerpt</h3>
        <span className="badge badge-warning">Illustrative example</span>
      </div>
      <p id="illustrative-note" className="muted text-sm" style={{ margin: 0 }}>
        Written to show the format of the feedback only. It is not from a real learner, a real assessment or an owner-approved case.
      </p>
      <p style={{ margin: 0 }}>
        <strong>Case:</strong> sudden left-sided weakness; non-contrast CT of the head.
      </p>

      <div className="stack" style={{ gap: 6 }}>
        <p style={{ margin: 0 }}>
          <strong>Strength:</strong> you identified the key finding early and committed to it.
        </p>
        <blockquote className="evidence">
          “There’s a hyperdense right middle cerebral artery, which I think represents acute thrombus.” <span className="muted">— 0:48</span>
        </blockquote>
      </div>

      <div className="issue important stack" style={{ gap: 6 }}>
        <div className="row">
          <strong>Issue 1</strong>
          <span className="badge badge-warning">Important</span>
          <span className="muted text-sm">Not demonstrated · after a standard question</span>
        </div>
        <p style={{ margin: 0 }}>
          <strong>What you said or omitted:</strong> asked what you would do next, you described the finding again but did not recommend vascular imaging or say who you would contact.
        </p>
        <blockquote className="evidence">
          “I’d want to correlate clinically and look at the rest of the brain.” <span className="muted">— 1:42</span>
        </blockquote>
        <p style={{ margin: 0 }}>
          <strong>Why it mattered:</strong> a suspected large-vessel occlusion is time-critical, so the urgent next step and who you would notify are part of a safe answer.
        </p>
        <p style={{ margin: 0 }}>
          <strong>A stronger response:</strong> “This suggests an acute right MCA occlusion. I would recommend an urgent CT angiogram from the aortic arch to the vertex and contact the stroke team now.”
        </p>
        <p style={{ margin: 0 }}>
          <strong>How to practise:</strong> in your next three acute cases, end each key finding with one sentence on the next step and who you would tell.
        </p>
      </div>

      <p className="muted text-sm" style={{ margin: 0 }}>
        <strong>Not assessable:</strong> extent of early ischemic change — the second axial image failed to load, so this element was not judged. Technical limitations are never counted against you.
      </p>
    </div>
  );
}

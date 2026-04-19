export function ExploreEmptyResultBoard() {
  return (
    <section className="analysis-studio-surface analysis-studio-surface--empty">
      <div className="analysis-studio-heading">
        <p className="analysis-studio-label">Result board</p>
        <h3 className="analysis-studio-title">No analysis selected</h3>
        <p className="analysis-studio-description">Run a corridor analysis or load a prior run to review metrics, narrative output, and comparisons.</p>
      </div>
      <div className="analysis-studio-inline-meta">
        <p className="analysis-studio-inline-meta-label">Next step</p>
        <p className="analysis-studio-inline-meta-value">Upload a corridor, enter the planning question, and run the study to populate this board.</p>
      </div>
    </section>
  );
}

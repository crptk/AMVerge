export default function PreviewContainer () {
  return (
    <main className="preview-container">
      <div className="preview-window">
        <p>Preview</p>
      </div>
      <div className="preview-export">
        <div className="checkbox-row">
          <input className="checkbox" type="checkbox"></input>
          <p>Merge clips</p>
        </div>
        <button className="buttons">Export</button>
      </div>
    </main>
  )
}
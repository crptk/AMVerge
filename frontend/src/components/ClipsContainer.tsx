import Thumb from "../assets/thumb_test.png"

const clips = [Thumb, Thumb, Thumb, Thumb, Thumb, Thumb];

export default function ClipsContainer() {
    return (
      <main className="clips-container">
        <div className="clips-import">
          <div className="import-buttons">
            <button className="buttons">Import</button>
            <button className="buttons">Select All</button>
          </div>
          <div className="grid-checkboxes">
            <div className="checkbox-row">
              <input type="checkbox" className="checkbox"></input>
              <span>Grid preview</span>    
            </div>
            <div className="checkbox-row">
              <input type="checkbox" className="checkbox"></input>
              <span>20 selected</span>    
            </div>
          </div>
        </div>
        <div className="clips-grid">
          {
            clips.map((_, i) => (
              <div className="clip-wrapper">
                <img className="clip" src={clips[i]}></img>
              </div>
            ))
          }
        </div>
      </main>
    )
}
import ReactMarkdown from "react-markdown";
import changelog from "../../data/CHANGELOG.md?raw";

export default function PatchNotes() {
    return (
        <div className="panel menu-panel">
            <div className="patchnotes-header">
                <h3>Patch notes</h3>
                <p>Check here for the latest patch notes!</p>
            </div>

            <div className="patchnotes-content">
                <ReactMarkdown>{changelog}</ReactMarkdown>
            </div>
        </div>
    )
}
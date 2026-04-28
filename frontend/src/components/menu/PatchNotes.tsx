import ReactMarkdown from "react-markdown";
import changelog from "../../data/CHANGELOG.md?raw";

export default function PatchNotes() {
    return (
        <div className="settings-section">
            <div className="patchnotes-header">
                <h3>Patch notes</h3>
                <p>Check here for the latest patch notes!</p>
            </div>

            <div className="patchnotes-wrapper">
                <ReactMarkdown>{changelog}</ReactMarkdown>
            </div>
        </div>
    )
}
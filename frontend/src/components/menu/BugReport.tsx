import { invoke } from "@tauri-apps/api/core"
import { useEffect, useMemo, useState, type SubmitEvent } from "react"
import {
    getConsoleLogsSnapshot,
    serializeConsoleLogs,
    subscribeToConsoleLogs,
    type ConsoleEntry,
} from "../../utils/appConsole"

const ENABLE_SUBMIT_COOLDOWN = false
const BUG_REPORT_COOLDOWN_MS = 60 * 60 * 1000
const BUG_REPORT_COOLDOWN_STORAGE_KEY = "amverge_bug_report_last_submitted_at"
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024

function readLastSubmittedAt(): number | null {
    if (typeof window === "undefined") return null

    try {
        const raw = window.localStorage.getItem(BUG_REPORT_COOLDOWN_STORAGE_KEY)
        if (!raw) return null
        const parsed = Number.parseInt(raw, 10)
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null
    } catch {
        return null
    }
}

function formatCooldown(remainingMs: number): string {
    const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

async function fileToBase64Data(file: File): Promise<string> {
    return await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const result = reader.result
            if (typeof result !== "string") {
                reject(new Error(`Failed to read ${file.name}`))
                return
            }

            const commaIndex = result.indexOf(",")
            if (commaIndex === -1) {
                reject(new Error(`Invalid data URL for ${file.name}`))
                return
            }

            resolve(result.slice(commaIndex + 1))
        }

        reader.onerror = () => {
            reject(reader.error ?? new Error(`Failed to read ${file.name}`))
        }

        reader.readAsDataURL(file)
    })
}

type ScreenshotAttachment = {
    name: string;
    mimeType: string;
    sizeBytes: number;
    dataBase64: string;
};

type BugReportRequest = {
    bugType: string;
    issueText: string;
    pcSpecs?: string | null;
    contact?: string | null;
    videoReference?: string | null;
    screenshotNames: string[];
    screenshots: ScreenshotAttachment[];
    consoleLogs: string;
    consoleLogCount: number;
    redactionApplied: boolean;
};

type BugReportResponse = {
    ok: boolean;
    message: string;
    reportId?: string;
}

export default function BugReport() {
    const [bugType, setBugType] = useState("Issue with video")
    const [issueText, setIssueText] = useState("")
    const [PCSpecs, setPCSpecs] = useState("")
    const [contact, setContact] = useState("")
    const [screenShots, setScreenshots] = useState<FileList | null>(null)
    const [videoReference, setVideoReference] = useState("")
    const [logs, setLogs] = useState<ConsoleEntry[]>(() => getConsoleLogsSnapshot())
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [submitSuccess, setSubmitSuccess] = useState<string | null>(null)
    const [lastSubmittedAt, setLastSubmittedAt] = useState<number | null>(() => readLastSubmittedAt())
    const [nowTs, setNowTs] = useState(() => Date.now())

    useEffect(() => {
        return subscribeToConsoleLogs(setLogs)
    }, [])

    useEffect(() => {
        if (!ENABLE_SUBMIT_COOLDOWN || !lastSubmittedAt) return

        const interval = window.setInterval(() => {
            setNowTs(Date.now())
        }, 1000)

        return () => {
            window.clearInterval(interval)
        }
    }, [lastSubmittedAt])

    const redactedConsoleLogs = useMemo(() => {
        const serialized = serializeConsoleLogs(logs)
        if (!serialized) return ""

        return serialized
            .replace(/[A-Za-z]:\\[^\r\n\t]*/g, "[REDACTED_PATH]")
            .replace(/\/(Users|home)\/[^/\s]+\/[^\r\n]*/g, "[REDACTED_PATH]")
    }, [logs])

    const cooldownRemainingMs = useMemo(() => {
        if (!ENABLE_SUBMIT_COOLDOWN || !lastSubmittedAt) return 0
        return Math.max(0, (lastSubmittedAt + BUG_REPORT_COOLDOWN_MS) - nowTs)
    }, [lastSubmittedAt, nowTs])

    const isCooldownActive = cooldownRemainingMs > 0

    async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
        e.preventDefault()
        setSubmitError(null)
        setSubmitSuccess(null)

        if (!issueText.trim()) {
            setSubmitError("Please describe the issue before submitting.")
            return
        }

        if (isCooldownActive) {
            setSubmitError(`Please wait ${formatCooldown(cooldownRemainingMs)} before submitting another report.`)
            return
        }

        const screenshotFiles = screenShots ? Array.from(screenShots) : []
        if (screenshotFiles.some((file) => !file.type.startsWith("image/"))) {
            setSubmitError("Only image files are allowed for screenshots.")
            return
        }

        if (screenshotFiles.some((file) => file.size > MAX_SCREENSHOT_BYTES)) {
            setSubmitError("One or more screenshots exceed the 8MB limit.")
            return
        }

        const screenshotPayload = await Promise.all(
            screenshotFiles.map(async (file) => ({
                name: file.name,
                mimeType: file.type || "application/octet-stream",
                sizeBytes: file.size,
                dataBase64: await fileToBase64Data(file),
            }))
        )

        const request: BugReportRequest = {
            bugType,
            issueText: issueText.trim(),
            pcSpecs: PCSpecs.trim() || null,
            contact: contact.trim() || null,
            videoReference: videoReference.trim() || null,
            screenshotNames: screenshotFiles.map((file) => file.name),
            screenshots: screenshotPayload,
            consoleLogs: redactedConsoleLogs,
            consoleLogCount: logs.length,
            redactionApplied: true,
        }

        try {
            setIsSubmitting(true)
            const res = await invoke<BugReportResponse>("submit_bug_report", { request })
            if (!res.ok) {
                setSubmitError(res.message || "Failed to submit bug report.")
                return
            }

            setSubmitSuccess(res.message || "Bug report submitted.")
            setIssueText("")
            setPCSpecs("")
            setContact("")
            setScreenshots(null)
            setVideoReference("")
            if (ENABLE_SUBMIT_COOLDOWN) {
                const submittedAt = Date.now()
                setLastSubmittedAt(submittedAt)
                setNowTs(submittedAt)
                try {
                    window.localStorage.setItem(BUG_REPORT_COOLDOWN_STORAGE_KEY, submittedAt.toString())
                } catch {
                    // Ignore storage errors; cooldown still applies for this session.
                }
            }
        } catch (err) {
            console.error(err)
            setSubmitError("Could not submit bug report. Please try again.")
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <section className="panel menu-panel">
            <h3>Report a bug</h3>
            <div className="bugreport-wrapper">
                <form onSubmit={onSubmit}>
                    <div className="bugreport-row">
                        <label htmlFor="bug-type">Select the type of bug you have</label>
                        <select
                         id="bug-type"
                         value={bugType}
                         onChange={(e) => setBugType(e.target.value)}
                        >
                            <option value="Issue with video">Issue with video</option>
                            <option value="Issue with app">Issue with app</option>
                        </select>
                    </div>
                    <div className="bugreport-row">
                        <label htmlFor="issue-text">Please describe your issue in as much detail as possible</label>
                        <input
                         type="text"
                         value={issueText}
                         placeholder="My issue is with.."
                         onChange={(e) => setIssueText(e.target.value)}
                        />
                    </div>
                    <div className="bugreport-row">
                        <label htmlFor="video-reference">
                             Video source details (OPTIONAL, highly encouraged)
                        </label>
                        <small>
                            Sharing a downloadable link helps us reproduce and fix issues much more accurately.
                            You can delete the link after 2 days. If you do not want to share a link, provide
                            directions for where to find the source or torrent (site, anime title, and episode).
                        </small>
                        <textarea
                         id="video-reference"
                         value={videoReference}
                         rows={4}
                         placeholder="Example: Kayoanime > anime title > Season 2 > Episode 07, or open a download link to the video for 2 days for us to download"
                         onChange={(e) => setVideoReference(e.target.value)}
                        />
                    </div>
                    <div className="bugreport-row">
                        <label htmlFor="pc-specs">Please provide your PC specifications (OPTIONAL)</label>
                        <input
                         type="text"
                         value={PCSpecs}
                         placeholder="e.g RTX 3060, Ryzen 5600X, 32GB RAM"
                         onChange={(e) => setPCSpecs(e.target.value)}
                        />
                    </div>
                    <div className="bugreport-row">
                        <label htmlFor="contact-info">Please type in your discord in case we need more details (OPTIONAL)</label>
                        <input
                         type="text"
                         value={contact}
                         placeholder="e.g @onepathonly"
                         onChange={(e) => setContact(e.target.value)}
                         />
                    </div>
                    <div className="bugreport-row">
                        <label htmlFor="screenshots">Please attach any screenshots if relevant (OPTIONAL)</label>
                        <input
                         id="screenshots"
                         type="file"
                         multiple
                         accept="image/*"
                         onChange={(e) => setScreenshots(e.target.files)}
                        />
                    </div>
                    <div className="bugreport-row">
                        <label>Console logs attached automatically ({logs.length} log entries)</label>
                        <small>
                            Local paths and usernames are redacted before sending.
                        </small>
                    </div>
                    <div className="bugreport-row">
                        <button type="submit" disabled={isSubmitting || isCooldownActive}>
                            {isSubmitting
                                ? "Submitting..."
                                : isCooldownActive
                                    ? `Submit available in ${formatCooldown(cooldownRemainingMs)}`
                                    : "Submit Report"}
                        </button>
                        {submitError && (
                            <div className="bugreport-row">
                                <p role="alert">{submitError}</p>
                            </div>
                        )}
                        {submitSuccess && (
                            <div className="bugreport-row">
                                <p>{submitSuccess}</p>
                            </div>
                        )}
                    </div>
                </form>
            </div>
        </section>
    )
}